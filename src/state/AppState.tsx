import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onDisconnect,
  onValue,
  push,
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
import type { PlayerInfo, RoomMode, RoomSettings } from '../engine/types';
import { allGames, gameById } from '../games';
import { triviaTopics } from '../games/Trivia/definition';
import {
  activePlayers,
  randomRoomCode,
  type RoomData,
  type Session,
} from '../types';
import { shuffled } from '../engine/rng';

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

interface AppStateValue {
  uid: string | null;
  authReady: boolean;
  room: RoomData | null;
  roomLoaded: boolean;
  session: Session | null;
  profile: Profile;
  notice: string | null;
  notify: (text: string) => void;
  isAuthority: boolean;
  me: PlayerInfo | null;
  createRoom: (opts: { mode: RoomMode; name: string; emoji: string }) => Promise<void>;
  joinRoom: (opts: { code: string; name: string; emoji: string }) => Promise<void>;
  addLocalPlayer: (name: string, emoji: string) => Promise<void>;
  removePlayer: (uid: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
  renameMe: (name: string, emoji: string) => Promise<void>;
  claimTurn: (forUid?: string) => Promise<void>;
  submitInput: (input: unknown, forUid?: string) => Promise<void>;
  updateSettings: (partial: Partial<RoomSettings>) => Promise<void>;
  startGame: () => Promise<void>;
  hostSkipRound: () => Promise<void>;
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
        // lazy GC: every app open sweeps abandoned rooms past their TTL
        if (!swept) {
          swept = true;
          void sweepExpiredRooms(db!);
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

  // ---- presence heartbeat for my own player node ----
  const meExists = !!(session && room?.players?.[session.uid]);
  useEffect(() => {
    if (!db || !session || !meExists) return;
    const r = ref(db, `rooms/${session.code}/players/${session.uid}/connected`);
    set(r, true).catch(() => {});
    const od = onDisconnect(r);
    od.set(false).catch(() => {});
    return () => {
      od.cancel().catch(() => {});
      set(r, false).catch(() => {});
    };
  }, [db, session?.code, session?.uid, meExists]);

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
      saveProfile({ name: opts.name, emoji: opts.emoji });
      for (let attempt = 0; attempt < 25; attempt++) {
        const code = randomRoomCode();
        const roomRef = ref(db, `rooms/${code}`);
        const existing = await get(roomRef);
        if (existing.exists()) continue;
        try {
          // root-level multi-path update: rules grant creation per-leaf
          // (meta creation window + own player node + roomIndex entry);
          // a racing creator loses on rules. roomIndex lists the room for
          // TTL garbage collection (see state/gc.ts).
          const expiresAt = serverNow() + ROOM_TTL_MS;
          await update(ref(db), {
            [`rooms/${code}/meta`]: {
              code,
              createdAt: serverNow(),
              expiresAt,
              ownerUid: myUid,
              mode: opts.mode,
              phase: 'lobby',
              round: 0,
              rotation: [],
              gameIndex: 0,
              settings: {
                mode: opts.mode,
                pointsMode: false,
                sipMultiplier: 1,
                enabledGames: allGames.map((g) => g.id),
                roundPacing: 'auto',
                triviaTopics: triviaTopics.map((t) => t.id),
              },
            },
            [`roomIndex/${code}`]: expiresAt,
            ...(opts.mode === 'party'
              ? { [`rooms/${code}/players/${myUid}`]: newPlayer(myUid, opts.name, opts.emoji, { isHost: true }) }
              : {}),
          });
          saveSession({ code, uid: myUid });
          return;
        } catch (e) {
          const code = (typeof e === 'object' && e && 'code' in e) ? (e as { code?: string }).code : undefined;
          if (code === 'permission-denied' || code === 'PERMISSION_DENIED') {
            continue; // someone claimed this code mid-flight — try another
          }
          throw e;
        }
      }
      throw new Error("Couldn't allocate a room code — try again");
    },
    [db, saveProfile, saveSession],
  );

  const joinRoom = useCallback(
    async (opts: { code: string; name: string; emoji: string }) => {
      if (!db) throw new Error('Firebase not configured');
      const myUid = await ensureAuth();
      saveProfile({ name: opts.name, emoji: opts.emoji });
      const code = opts.code.trim().toUpperCase();
      const existing = await get(ref(db, `rooms/${code}`));
      if (!existing.exists()) throw new Error(`No room "${code}" — double-check the code`);
      await set(ref(db, `rooms/${code}/players/${myUid}`), newPlayer(myUid, opts.name, opts.emoji));
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

  const leaveRoom = useCallback(async () => {
    if (db && session) {
      await set(ref(db, `rooms/${session.code}/players/${session.uid}/connected`), false).catch(
        () => {},
      );
    }
    saveSession(null);
  }, [db, session, saveSession]);

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
   * Each player claims exactly once; the order then runs the whole game.
   */
  const claimTurn = useCallback(
    async (forUid?: string) => {
      if (!db || !session || !room) return;
      const target = forUid ?? session.uid;
      const slot = room.meta.turnOrder?.length ?? 0;
      if (room.meta.turnOrder?.includes(target)) return; // already ordered
      await runTransaction(
        ref(db, `rooms/${session.code}/turnClaim/${slot}`),
        (cur) => (cur ? undefined : { uid: target, at: serverNow() }),
      );
    },
    [db, session, room],
  );

  const submitInput = useCallback(
    async (input: unknown, forUid?: string) => {
      if (!db || !session || !room || room.meta.phase !== 'playing') return;
      await push(ref(db, rpath('game/inputs')), {
        uid: session.uid,
        forUid: forUid ?? null,
        at: serverNow(),
        input,
      });
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

  const startGame = useCallback(async () => {
    if (!db || !session || !room) return;
    const enabled = (room.meta.settings.enabledGames ?? []).filter((id) => gameById.has(id));
    const pool = enabled.length > 0 ? enabled : allGames.map((g) => g.id);
    const rotation = shuffled(pool, Math.random);
    await update(ref(db, rpath('meta')), {
      phase: 'claim',
      round: 0,
      rotation,
      gameIndex: 0,
      actorUid: null,
      turnOrder: null,
      forceStart: false,
      outcome: null,
    });
  }, [db, session, room]);

  /** Host escape hatch: fast-forward the current phase (also un-sticks a round). */
  const hostSkipRound = useCallback(async () => {
    if (!db || !session || !room) return;
    const m = room.meta;
    const now = serverNow();
    if (m.phase === 'claim') {
      // lock in the ceremony with whoever has claimed (seed the first player if nobody has)
      const order = m.turnOrder ?? [];
      const finalOrder =
        order.length > 0 ? order : activePlayers(room).slice(0, 1).map((p) => p.uid);
      if (finalOrder.length === 0) return;
      await update(ref(db, rpath('meta')), { turnOrder: finalOrder, forceStart: true }).catch(() => {});
    } else if (m.phase === 'intro') {
      await update(ref(db, rpath('meta')), { introEndsAt: now }).catch(() => {});
    } else if (m.phase === 'outcome') {
      // works for both pacings: auto short-circuits the deadline,
      // manual requires the explicit forceNext flag
      await update(ref(db, rpath('meta')), { outcomeEndsAt: now, forceNext: true }).catch(() => {});
    } else if (m.phase === 'playing') {
      const gid = m.rotation[m.gameIndex] ?? '';
      const g = gameById.get(gid);
      await update(ref(db, rpath('meta')), {
        phase: 'outcome',
        outcome: {
          gameId: gid,
          gameName: g?.name ?? '',
          gameEmoji: g?.emoji ?? '',
          assignments: [],
          note: 'Round skipped',
        },
        outcomeEndsAt: now + 2500,
      }).catch(() => {});
    }
  }, [db, session, room]);

  const endGame = useCallback(async () => {
    if (!db || !session) return;
    await remove(ref(db, `rooms/${session.code}`)).catch(() => {});
    // index entry is removable once the room itself is gone (rules)
    await remove(ref(db, `roomIndex/${session.code}`)).catch(() => {});
    saveSession(null);
  }, [db, session, saveSession]);

  const resetDrinks = useCallback(async () => {
    if (!db || !session || !room) return;
    const updates: Record<string, unknown> = {};
    for (const p of Object.values(room.players)) {
      updates[`players/${p.uid}/drinkCount`] = 0;
      updates[`players/${p.uid}/score`] = 0;
    }
    await update(ref(db, rpath('')), updates);
  }, [db, session, room]);

  const takeOverHost = useCallback(async () => {
    if (!db || !session || !room) return;
    await set(ref(db, rpath('meta/ownerUid')), session.uid);
    await set(ref(db, rpath(`players/${session.uid}/isHost`)), true);
    notify('You are the host now 🍻');
  }, [db, session, room, notify]);

  const isAuthority = !!(session && room && room.meta.ownerUid === session.uid);
  const me = session ? (room?.players?.[session.uid] ?? null) : null;

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
    createRoom,
    joinRoom,
    addLocalPlayer,
    removePlayer,
    leaveRoom,
    renameMe,
    claimTurn,
    submitInput,
    updateSettings,
    startGame,
    hostSkipRound,
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
