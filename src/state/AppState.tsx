import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onDisconnect,
  onValue,
  ref,
  runTransaction,
  set,
  get,
  update,
  remove,
} from 'firebase/database';
import { db, ensureAuth } from '../firebase';
import { serverNow } from './serverTime';
import { ROOM_TTL_MS, sweepExpiredRooms } from './gc';
import { PROTOCOL_VERSION, shortId } from './protocol';
import { initialEngine } from './room';
import { tabInstanceId } from './instance';
import { sendEngineCommand } from './useHostLoop';
import type { EngineCommand } from './engine';
import type {
  GameInputEntry,
  HostLease,
  InputStatus,
  RoomData,
  Session,
} from '../types';
import type { PlayerInfo, RoomMode, RoomSettings } from '../engine/types';
import { allGames } from '../games';
import { triviaTopics } from '../games/Trivia/definition';
import { engineOf, playerList, randomRoomCode, stageInputs } from '../types';

const SESSION_KEY = 'soc.session';
const PROFILE_KEY = 'soc.profile';

interface Profile {
  name: string;
  emoji: string;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as Profile;
  } catch {
    /* fall through */
  }
  return { name: '', emoji: '' };
}

function newPlayer(
  uid: string,
  name: string,
  emoji: string,
  opts: { isHost?: boolean; local?: boolean } = {},
): PlayerInfo {
  return {
    uid,
    name: name.trim().slice(0, 20),
    emoji,
    isHost: opts.isHost ?? false,
    local: opts.local ?? false,
    connected: true,
    drinkCount: 0,
    score: 0,
    joinedAt: serverNow(),
  };
}

/**
 * The room's engine node as it exists the moment a room is created — see
 * state/room.ts for why it is born with a lease, a revision and identities.
 */

interface AppStateValue {
  uid: string | null;
  authReady: boolean;
  room: RoomData | null;
  roomLoaded: boolean;
  session: Session | null;
  profile: Profile;
  notice: string | null;
  notify: (text: string) => void;
  /** this tab holds the room's engine lease (a second host tab is a viewer) */
  isAuthority: boolean;
  me: PlayerInfo | null;
  /** how my latest submission for the stage on screen is doing */
  inputStatus: (stageKey?: string | null, forUid?: string) => InputStatus;
  createRoom: (opts: { mode: RoomMode; name: string; emoji: string }) => Promise<void>;
  joinRoom: (opts: { code: string; name: string; emoji: string }) => Promise<void>;
  addLocalPlayer: (name: string, emoji: string) => Promise<void>;
  removePlayer: (uid: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  renameMe: (name: string, emoji: string) => Promise<void>;
  claimTurn: (forUid?: string) => Promise<void>;
  submitInput: (input: unknown, forUid?: string) => Promise<void>;
  /** ready gate: acknowledge *this* gate, or (shared phone) every listed uid */
  setReady: (ready: boolean, uids?: string[]) => Promise<void>;
  updateSettings: (partial: Partial<RoomSettings>) => Promise<void>;
  startGame: () => Promise<void>;
  hostSkipRound: () => Promise<void>;
  /** resume after a recovery pause, retry after a failed commit */
  engineCommand: (command: EngineCommand) => void;
  endGame: () => Promise<void>;
  resetDrinks: () => Promise<void>;
  takeOverHost: () => Promise<void>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [uid, setUid] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [session, setSession] = useState<Session | null>(loadSession);
  const [room, setRoom] = useState<RoomData | null>(null);
  const [roomLoaded, setRoomLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  /** this tab's identity: the unit of "one authority" and of presence */
  const instanceId = useMemo(() => tabInstanceId(), []);

  // ---- anonymous auth ----
  useEffect(() => {
    if (!db) {
      setAuthReady(true);
      return;
    }
    let swept = false;
    ensureAuth()
      .then((uid) => {
        setUid(uid);
        // Cleanup only a remembered room; the global room index is private.
        if (!swept) {
          swept = true;
          void sweepExpiredRooms(db!, loadSession()?.code);
        }
      })
      .catch((e) => {
        console.error(e);
        setNotice('Sign-in failed — is your Firebase project set up? (see README)');
      })
      .finally(() => setAuthReady(true));
    return () => {
      swept = true;
    };
  }, []);

  const notify = useCallback((text: string) => {
    setNotice(text);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3200);
  }, []);

  // ---- room subscription ----
  useEffect(() => {
    if (!db || !session) {
      setRoom(null);
      setRoomLoaded(true);
      return;
    }
    setRoomLoaded(false);
    const r = ref(db, `rooms/${session.code}`);
    const unsub = onValue(
      r,
      (snap) => {
        const val = snap.val() as RoomData | null;
        // a fragment without meta (e.g. a write racing room deletion) is not a room
        setRoom(val && val.meta ? val : null);
        setRoomLoaded(true);
      },
      (err) => {
        console.error(err);
        setRoom(null);
        setRoomLoaded(true);
        notify(`Can't read room ${session.code} — check database rules (README)`);
      },
    );
    return unsub;
  }, [session?.code, notify]);

  // ---- my seat: presence, and the difference between asleep and gone ----
  // Presence is tracked *per connection*, not per player: every tab writes its
  // own `players/{uid}/connections/{instanceId}` and arms an onDisconnect for
  // that one child. A second tab closing — or a phone's browser unloading one
  // page to reclaim memory — therefore cannot mark a player who is still there
  // as gone, which is what used to release a Ready gate early.
  const meExists = !!(session && room?.players?.[session.uid]);
  const leavingRef = useRef(false);
  useEffect(() => {
    if (!db || !session || !meExists) return;
    const playerRef = ref(db, `rooms/${session.code}/players/${session.uid}`);
    const connRef = ref(db, `rooms/${session.code}/players/${session.uid}/connections/${instanceId}`);
    leavingRef.current = false;

    /** I'm here, and I never left — clears a stale marker on the way back in */
    const mine = () => {
      onDisconnect(connRef).remove().catch(() => {});
      set(connRef, { at: serverNow(), tab: instanceId }).catch(() => {});
      update(playerRef, { connected: true, left: null, leftAt: null }).catch(() => {});
    };

    const unsubConn = onValue(ref(db, '.info/connected'), (snap) => {
      if (snap.val() !== true) return;
      // re-armed on every reconnect: a drop with no page exit only means "away"
      onDisconnect(playerRef).update({ connected: false }).catch(() => {});
      void mine();
    });
    // A seat marked `left` while this page is alive is stale — a second tab of
    // mine could have closed, or a phone that unloaded the page while locked
    // has just come back. My page being alive is the proof I haven't left.
    const unsubMine = onValue(playerRef, (snap) => {
      const val = snap.val() as PlayerInfo | null;
      if (!leavingRef.current && val && val.left === true) void mine();
    });

    // back from a locked screen / another app / a lost connection
    const awake = () => {
      if (document.visibilityState !== 'visible') return;
      leavingRef.current = false;
      void mine();
    };
    document.addEventListener('visibilitychange', awake);
    window.addEventListener('pageshow', awake);
    window.addEventListener('online', awake);

    // Leaving the page. The seat is marked `left` (the room drops it) and the
    // onDisconnect payload is re-armed with the same marker, so the room drops
    // this player even if the direct write loses the race with the socket
    // coming down. A refresh lands here too — the new page clears the flag.
    const leave = () => {
      leavingRef.current = true;
      const marker = { connected: false, left: true, leftAt: serverNow() };
      onDisconnect(playerRef).update(marker).catch(() => {});
      update(playerRef, { ...marker, [`connections/${instanceId}`]: null }).catch(() => {});
    };
    window.addEventListener('pagehide', leave);
    window.addEventListener('beforeunload', leave);

    return () => {
      unsubConn();
      unsubMine();
      document.removeEventListener('visibilitychange', awake);
      window.removeEventListener('pageshow', awake);
      window.removeEventListener('online', awake);
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('beforeunload', leave);
    };
  }, [db, session?.code, session?.uid, instanceId, meExists]);

  // ---- a stored session that lost its seat gets it back ----
  // A phone that reopens the site walks back into the room it was in (the host
  // may also have cleared a seat that was long gone): it takes a fresh seat and
  // plays from the next minigame, exactly like anyone else joining mid-match.
  // Checked once per page load, so a host removing a live player still sticks —
  // and never in a shared-phone room, where the host phone is not a player.
  const seatChecked = useRef(false);
  useEffect(() => {
    if (!db || !session || !room || seatChecked.current) return;
    if (room.meta.mode !== 'party') return;
    seatChecked.current = true;
    if (room.players?.[session.uid]) return;
    const name = profile.name.trim();
    if (!name) return;
    set(
      ref(db, `rooms/${session.code}/players/${session.uid}`),
      newPlayer(session.uid, name, profile.emoji),
    ).catch(() => {});
  }, [db, session, room, profile.name, profile.emoji]);

  const saveSession = useCallback((s: Session | null) => {
    setSession(s);
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  }, []);

  const saveProfile = useCallback((p: Profile) => {
    setProfile(p);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  }, []);

  const rpath = (path: string) => `rooms/${session!.code}/${path}`;

  // ---- actions ----
  const createRoom = useCallback(
    async (opts: { mode: RoomMode; name: string; emoji: string }) => {
      if (!db) throw new Error('Firebase not configured');
      const myUid = await ensureAuth();
      const myInstance = instanceId;
      saveProfile({ name: opts.name, emoji: opts.emoji });
      for (let attempt = 0; attempt < 25; attempt++) {
        const code = randomRoomCode();
        const roomRef = ref(db, `rooms/${code}`);
        await sweepExpiredRooms(db, code);
        const existing = await get(roomRef);
        if (existing.exists()) continue;
        try {
          // Root-level multi-path update: rules validate the new room and
          // its owner together, and a racing creator loses on rules. The room is born
          // with its protocol stamp and its first host lease, so the engine
          // has a revision to increment from the very first commit.
          const now = serverNow();
          const expiresAt = now + ROOM_TTL_MS;
          await update(ref(db), {
            [`rooms/${code}/meta`]: {
              code,
              createdAt: now,
              expiresAt,
              ownerUid: myUid,
              mode: opts.mode,
              protocol: PROTOCOL_VERSION,
              settings: {
                mode: opts.mode,
                pointsMode: false,
                sipMultiplier: 1,
                enabledGames: allGames.map((g) => g.id),
                roundPacing: 'ready',
                triviaTopics: triviaTopics.map((t) => t.id),
              },
            },
            [`rooms/${code}/engine`]: initialEngine(myUid, myInstance, now),
            [`roomIndex/${code}`]: expiresAt,
            ...(opts.mode === 'party'
              ? {
                  [`rooms/${code}/players/${myUid}`]: newPlayer(myUid, opts.name, opts.emoji, {
                    isHost: true,
                  }),
                }
              : {}),
          });
          saveSession({ code, uid: myUid });
          return;
        } catch (e) {
          const code = ((typeof e === 'object' && e && 'code' in e
            ? (e as { code?: string }).code
            : undefined) ?? '') as string;
          if (code === 'permission-denied' || code === 'PERMISSION_DENIED') {
            continue; // someone claimed this code mid-flight — try another
          }
          throw e;
        }
      }
      throw new Error("Couldn't allocate a room code — try again");
    },
    [db, saveProfile, saveSession, instanceId],
  );

  /**
   * Join a room by code — any time, including mid-match. A player who arrives
   * while a round is running is in the room straight away (their phone shows
   * "you're up next game") and the engine puts them in the next round's roster.
   * Coming back to a room you were already in keeps your seat, score and
   * drinks; only a seat the host cleared starts from scratch.
   */
  const joinRoom = useCallback(
    async (opts: { code: string; name: string; emoji: string }) => {
      if (!db) throw new Error('Firebase not configured');
      const myUid = await ensureAuth();
      saveProfile({ name: opts.name, emoji: opts.emoji });
      const code = opts.code.trim().toUpperCase();
      await sweepExpiredRooms(db, code);
      const existing = await get(ref(db, `rooms/${code}`));
      if (!existing.exists()) throw new Error(`No room "${code}" — double-check the code`);
      const seat = ref(db, `rooms/${code}/players/${myUid}`);
      if (existing.child(`players/${myUid}`).exists()) {
        // my own seat: keep joinedAt/drinks/score, just come back online
        await update(seat, {
          name: opts.name.trim().slice(0, 20),
          emoji: opts.emoji,
          connected: true,
          left: null,
          leftAt: null,
        });
      } else {
        await set(seat, newPlayer(myUid, opts.name, opts.emoji));
      }
      saveSession({ code, uid: myUid });
    },
    [db, saveProfile, saveSession],
  );

  const addLocalPlayer = useCallback(
    async (name: string, emoji: string) => {
      if (!db || !session) return;
      const key = `local_${Math.random().toString(36).slice(2, 10)}`;
      await set(ref(db, rpath(`players/${key}`)), newPlayer(key, name, emoji, { local: true }));
    },
    [db, session],
  );

  const removePlayer = useCallback(
    async (targetUid: string) => {
      if (!db || !session) return;
      await remove(ref(db, rpath(`players/${targetUid}`)));
    },
    [db, session],
  );

  /** Leave for good: hand the seat back and forget the room. */
  const leaveRoom = useCallback(async () => {
    if (db && session && room?.players?.[session.uid]) {
      // same marker the page-exit handler writes — the room drops the seat, the
      // player node survives so the host can still see who walked off.
      // `leavingRef` stops this page's own heartbeat from clearing it again.
      leavingRef.current = true;
      const marker = { connected: false, left: true, leftAt: serverNow() };
      await update(ref(db, `rooms/${session.code}/players/${session.uid}`), {
        ...marker,
        [`connections/${instanceId}`]: null,
      }).catch(() => {});
    }
    saveSession(null);
  }, [db, session, room, instanceId, saveSession]);

  const renameMe = useCallback(
    async (name: string, emoji: string) => {
      if (!db || !session || !room?.players?.[session.uid]) return;
      saveProfile({ name, emoji });
      await update(ref(db, rpath(`players/${session.uid}`)), {
        name: name.trim().slice(0, 20),
        emoji,
      });
    },
    [db, session, room, saveProfile],
  );

  /**
   * First-write-wins claim of an order slot during the opening ceremony:
   * "I'll Start" claims slot 0, each "I'm Next" claims the next slot.
   * Each player claims exactly once; the engine folds the claims into the
   * turn order and opens round 1 (see state/engine.ts).
   */
  const claimTurn = useCallback(
    async (forUid?: string) => {
      if (!db || !session || !room) return;
      const target = forUid ?? session.uid;
      const engine = engineOf(room);
      if (!engine || engine.phase !== 'claim') return;
      if ((engine.turnOrder ?? []).includes(target)) return; // already ordered
      const slot = Object.keys(engine.claims ?? {}).length;
      await runTransaction(
        ref(db, `rooms/${session.code}/engine/claims/${slot}`),
        (cur) => (cur ? undefined : { uid: target, at: serverNow() }),
      );
    },
    [db, session, room],
  );

  /**
   * Submit an action for the stage on screen.
   *
   * The payload carries the round, the phase and the stage key, and the key in
   * the database *is* the input id — so a delayed tap cannot reach a later
   * phase that accepts the same action (the engine refuses it), and a retry
   * with the same id can only ever apply once. The database rules enforce the
   * same stage match, which is what makes a submission that races a transition
   * fail loudly instead of landing in the wrong round.
   */
  const submitInput = useCallback(
    async (input: unknown, forUid?: string) => {
      if (!db || !session || !room) return;
      const engine = engineOf(room);
      if (!engine || engine.phase !== 'playing') return;
      if (!engine.roundId || !engine.phaseId || !engine.stageKey) return;
      const inputId = shortId();
      const entry: GameInputEntry = {
        inputId,
        uid: session.uid,
        forUid: forUid ?? null,
        at: serverNow(),
        roundId: engine.roundId,
        phaseId: engine.phaseId,
        stageKey: engine.stageKey,
        input,
      };
      try {
        await set(ref(db, `rooms/${session.code}/engine/game/inputs/${inputId}`), entry);
      } catch (e) {
        const text = String(e);
        notify(
          /permission|denied/i.test(text)
            ? 'That round just moved on — your tap did not count'
            : "Couldn't send that — check your connection",
        );
      }
    },
    [db, session, room, notify],
  );

  /**
   * Ready gate between rounds. Party mode: each phone flags its own player
   * (rules allow self-writes). Shared phone: one device, so the holder
   * acknowledges for everyone at once (the lease holder may write any of them).
   *
   * A ready flag names the *gate* it belongs to: a `true` from a previous gate
   * can never release the next one.
   */
  const setReady = useCallback(
    async (ready: boolean, uids?: string[]) => {
      if (!db || !session || !room) return;
      const gateId = engineOf(room)?.gate?.id ?? null;
      if (!gateId) return;
      const targets = (uids && uids.length > 0 ? uids : [session.uid]).filter(
        (uid) => room.players?.[uid] != null,
      );
      if (targets.length === 0) return;
      const updates: Record<string, unknown> = {};
      for (const uid of targets) updates[`engine/ready/${uid}`] = ready ? gateId : null;
      await update(ref(db, rpath('')), updates).catch(() => {});
    },
    [db, session, room],
  );

  const updateSettings = useCallback(
    async (partial: Partial<RoomSettings>) => {
      if (!db || !session || !room) return;
      await update(ref(db, rpath('meta/settings')), partial);
    },
    [db, session, room],
  );

  /** Host actions are *commands into the engine queue*, never direct writes. */
  const engineCommand = useCallback(
    (command: EngineCommand) => {
      const sent = sendEngineCommand(session?.code, command);
      if (!sent) notify('Only the active host can do that');
      return sent;
    },
    [session?.code, notify],
  );

  const startGame = useCallback(async () => {
    engineCommand({ type: 'start' });
  }, [engineCommand]);

  const hostSkipRound = useCallback(async () => {
    engineCommand({ type: 'skip' });
  }, [engineCommand]);

  const endGame = useCallback(async () => {
    if (!db || !session) return;
    await remove(ref(db, `rooms/${session.code}`)).catch(() => {});
    // index entry is removable once the room itself is gone (rules)
    await remove(ref(db, `roomIndex/${session.code}`)).catch(() => {});
    saveSession(null);
  }, [db, session, saveSession]);

  const resetDrinks = useCallback(async () => {
    engineCommand({ type: 'reset-awards' });
  }, [engineCommand]);

  /**
   * Take the room over. The lease is a transaction, so two players tapping 👑
   * at the same moment cannot both win: the generation increments once and the
   * loser's commit is refused.
   */
  const takeOverHost = useCallback(async () => {
    if (!db || !session || !room) return;
    const next: HostLease = {
      uid: session.uid,
      instanceId,
      generation: 0,
      renewedAt: serverNow(),
    };
    const res = await runTransaction(ref(db, rpath('engine/lease')), (cur) => {
      const lease = cur as HostLease | null;
      if (lease && lease.uid === session.uid && lease.instanceId === instanceId) return lease;
      next.generation = (lease?.generation ?? 0) + 1;
      return next;
    });
    if (!res.committed) {
      notify("Couldn't take over the room — try again");
      return;
    }
    await set(ref(db, rpath(`players/${session.uid}/isHost`)), true).catch(() => {});
    notify('You are the host now 🍺');
  }, [db, session, room, instanceId, notify]);

  const lease = room?.engine?.lease ?? null;
  const isAuthority = !!(
    session &&
    room &&
    (lease
      ? lease.uid === session.uid && lease.instanceId === instanceId
      : room.meta.ownerUid === session.uid) // online-only fallback: meta.ownerUid <= lease.uid
  );
  // my seat, with the engine's ledger folded in (drinks and points are the
  // ledger's to say, not the player node's)
  const me = session ? (playerList(room).find((p) => p.uid === session.uid) ?? null) : null;

  /**
   * How the latest submission for a stage is doing, read straight from the
   * room: in the database but not acknowledged = sending, acknowledged =
   * accepted (and whether it actually changed anything), refused = rejected.
   */
  const inputStatus = useCallback(
    (stageKey?: string | null, forUid?: string): InputStatus => {
      if (!room) return 'idle';
      const current = stageKey ?? engineOf(room)?.stageKey ?? null;
      if (!current) return 'idle';
      const mine = stageInputs(room).filter(
        (entry) => (entry.forUid ?? entry.uid) === (forUid ?? session?.uid ?? ''),
      );
      const last = mine[mine.length - 1];
      if (!last) return 'idle';
      if (last.rejected) return 'rejected';
      if (last.ack) return 'accepted';
      return 'sending';
    },
    [room, session?.uid],
  );

  const value: AppStateValue = {
    uid,
    authReady,
    room,
    roomLoaded,
    session,
    profile,
    notice,
    notify,
    isAuthority,
    me,
    inputStatus,
    createRoom,
    joinRoom,
    addLocalPlayer,
    removePlayer,
    leaveRoom,
    renameMe,
    claimTurn,
    submitInput,
    setReady,
    updateSettings,
    startGame,
    hostSkipRound,
    engineCommand,
    endGame,
    resetDrinks,
    takeOverHost,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useApp(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useApp must be used inside <AppStateProvider>');
  return ctx;
}
