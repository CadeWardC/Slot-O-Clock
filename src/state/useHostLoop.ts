import { useEffect, useRef } from 'react';
import {
  get,
  onChildAdded,
  onValue,
  push,
  ref,
  runTransaction,
  set,
  update,
  type Database,
} from 'firebase/database';
import { db } from '../firebase';
import { serverNow } from './serverTime';
import { ROOM_TTL_MS } from './gc';
import {
  actorFromOrder,
  livePlayers,
  notReady,
  pacingOf,
  playerList,
  readyResetPaths,
  turnOrderForRoom,
  type GameInputEntry,
  type RoomData,
} from '../types';
import { allGames, gameById } from '../games';
import { mulberry32, shuffled } from '../engine/rng';
import type { Effect, GameContext, GameEvent, PlayerInfo } from '../engine/types';

function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * The authoritative game loop. Runs only on the room owner's device —
 * GitHub Pages can't host a server, so the host phone IS the server:
 * it owns phase transitions, dispatches player inputs + timer events
 * into the current game's reducer, and applies the resulting effects.
 *
 * Everything is driven from RTDB snapshots + self-healing interval
 * checks, so a backgrounded/reloaded host phone recovers on its own.
 */
export function useHostLoop(room: RoomData | null, uid: string | null, isAuthority: boolean) {
  const roomRef = useRef(room);
  roomRef.current = room;

  const active = !!room?.meta && room.meta.phase !== 'lobby' && room.meta.phase !== 'ended';

  useEffect(() => {
    const rdb: Database = db!; // guarded by early return below
    if (!rdb || !uid || !isAuthority || !room?.meta || !active) return;
    const code = room.meta.code;

    // ---- per-game local state (rebuilt safely on host reload) ----
    let stateMirror: any = null;
    const processedInputs = new Set<string>();
    const inputQueue: { id: string; val: GameInputEntry }[] = [];
    let inputsSeeded = false;
    let timerSeen: number | null = null;
    let ended = false;
    /** round number whose game we already launched out of the splash */
    let launchedRound: number | null = null;
    let queue: Promise<void> = Promise.resolve();

    // A timer that is already past due on startup was almost certainly
    // handled before a host reload — don't fire TIME_UP twice.
    {
      const curT = room.game?.timerEndsAt;
      if (typeof curT === 'number' && serverNow() >= curT) timerSeen = curT;
    }

    const meta = () => roomRef.current?.meta;
    const game = () => roomRef.current?.game;
    const currentDef = () => {
      const m = meta();
      if (!m) return undefined;
      const id = m.rotation[m.gameIndex];
      return id ? gameById.get(id) : undefined;
    };

    /**
     * Who is playing the round on screen. The host snapshots the roster when it
     * launches a round (`meta.roundUids`) and keeps it for the whole round, so:
     *  - a phone that dies mid-round keeps its seat instead of vanishing from
     *    the game (its teammates finish the round around it), and
     *  - somebody who joins mid-round is out of this one and plays from the next.
     * Mirroring the roster locally covers the moment between writing it and the
     * snapshot coming back (e.g. the BEGIN event that immediately follows).
     */
    let roundUids: string[] | null = room.meta.roundUids ?? null;
    const rosterPlayers = (): PlayerInfo[] => {
      const all = playerList(roomRef.current);
      if (!roundUids || roundUids.length === 0) return all.filter((p) => p.left !== true);
      const byUid = new Map(all.map((p) => [p.uid, p] as const));
      return roundUids
        .map((uid) => byUid.get(uid))
        .filter((p): p is PlayerInfo => p != null);
    };

    const buildCtx = (playersIn?: PlayerInfo[]): GameContext | null => {
      const m = meta();
      if (!m) return null;
      const players = playersIn ?? rosterPlayers();
      if (players.length === 0) return null;
      return {
        players,
        actorUid: m.actorUid,
        turnOrder: m.turnOrder ?? [],
        settings: m.settings,
        rng: mulberry32(hashSeed(`${code}:${m.round}`)),
        now: serverNow(),
      };
    };

    const pushEvent = (text: string) =>
      push(ref(rdb, `rooms/${code}/events`), { at: serverNow(), text }).catch(() => {});

    const applyDrinks = async (assignments: { uid: string; sips: number; reason: string }[]) => {
      const m = meta();
      const mult = m && !m.settings.pointsMode ? m.settings.sipMultiplier ?? 1 : 1;
      const players = roomRef.current?.players ?? {};
      for (const a of assignments) {
        if (a.sips <= 0) continue;
        const n = Math.max(1, Math.round(a.sips * mult));
        await runTransaction(
          ref(rdb, `rooms/${code}/players/${a.uid}/drinkCount`),
          (cur) => (typeof cur === 'number' ? cur : 0) + n,
        ).catch(() => {});
        const who = players[a.uid];
        if (who) pushEvent(`${who.emoji} ${who.name} +${n} — ${a.reason}`);
      }
    };

    const applyEffects = async (effects?: Effect[]) => {
      if (!effects) return;
      for (const fx of effects) {
        if (fx.type === 'TIMER') {
          await set(ref(rdb, `rooms/${code}/game/timerEndsAt`), serverNow() + fx.ms).catch(() => {});
        } else if (fx.type === 'CLEAR_INPUTS') {
          // multi-phase games restart the shared-phone pass-around per phase
          await set(ref(rdb, `rooms/${code}/game/inputs`), null).catch(() => {});
        } else if (fx.type === 'DRINKS') {
          await applyDrinks(fx.assignments);
        } else if (fx.type === 'SCORE') {
          await runTransaction(
            ref(rdb, `rooms/${code}/players/${fx.uid}/score`),
            (cur) => (typeof cur === 'number' ? cur : 0) + fx.delta,
          ).catch(() => {});
        }
        // END is handled by the dispatcher
      }
    };

    const dispatch = (event: GameEvent) => {
      queue = queue.then(async () => {
        const d = currentDef();
        if (!d || ended) return;
        const cur = stateMirror ?? game()?.state;
        const ctx = buildCtx();
        if (cur == null || !ctx) return;
        const res = d.reduce(cur, event, ctx);
        stateMirror = res.state;
        await set(ref(rdb, `rooms/${code}/game/state`), res.state).catch(() => {});
        for (const fx of res.effects ?? []) {
          if (fx.type === 'END') {
            ended = true;
            const dNow = currentDef();
            await applyDrinks(fx.assignments ?? []);
            // The outcome screen is where the ready gate lives: everybody's
            // flag is cleared as we enter it, in the same write that flips
            // the phase, so no stale flag can skip the wait.
            await update(ref(rdb, `rooms/${code}`), {
              'meta/phase': 'outcome',
              'meta/outcome': {
                gameId: dNow?.id ?? '',
                gameName: dNow?.name ?? '',
                gameEmoji: dNow?.emoji ?? '',
                assignments: fx.assignments ?? [],
                note: fx.note ?? null,
                recap: fx.recap ?? null,
              },
              // no deadline: the round ends when the players say so
              'meta/outcomeEndsAt': null,
              'meta/forceNext': false,
              ...readyResetPaths(roomRef.current),
            }).catch(() => {});
          } else {
            await applyEffects([fx]);
          }
        }
      });
    };

    const drainInputs = () => {
      if (!inputsSeeded) return;
      while (inputQueue.length > 0) {
        const item = inputQueue.shift()!;
        if (processedInputs.has(item.id)) continue;
        processedInputs.add(item.id);
        dispatch({ type: 'INPUT', uid: item.val.forUid ?? item.val.uid, input: item.val.input });
      }
    };

    // ---- input subscription with replay-safe seeding ----
    const unsubInputs = onChildAdded(ref(rdb, `rooms/${code}/game/inputs`), (snap) => {
      if (snap.key) inputQueue.push({ id: snap.key, val: snap.val() as GameInputEntry });
      drainInputs();
    });
    get(ref(rdb, `rooms/${code}/game/inputs`)).then((snap) => {
      snap.forEach((child) => {
        if (child.key) processedInputs.add(child.key);
      });
      inputsSeeded = true;
      drainInputs();
    });

    // ---- the phase machine (idempotent; re-checked on every signal) ----
    const advance = async () => {
      const m = meta();
      if (!m) return;
      const now = serverNow();

      if (m.phase === 'claim') {
        // One-time ordering ceremony: each claim appends the claimant to
        // turnOrder. When everyone has a slot (or the host forces it),
        // round 1 begins and the order runs the whole game. Only phones that
        // are awake have to claim: a dark screen can't tap, and it doesn't
        // block the table — it gets a slot when it comes back (see the
        // outcome branch, which grows the order with the room).
        let order = [...(m.turnOrder ?? [])];
        const claim = roomRef.current?.turnClaim?.[order.length];
        if (claim?.uid && !order.includes(claim.uid)) {
          order = [...order, claim.uid];
          // set() (not multi-path update): an array is only legal as a VALUE,
          // never as update()'s path map — update(ref, array) throws.
          await set(ref(rdb, `rooms/${code}/meta/turnOrder`), order).catch(() => {});
        }
        const players = livePlayers(roomRef.current);
        const complete =
          order.length > 0 &&
          (order.length >= Math.max(1, players.length) || m.forceStart === true);
        if (complete) {
          await update(ref(rdb, `rooms/${code}`), {
            'meta/phase': 'intro',
            'meta/round': 1,
            // whoever claimed spot 1 opens — unless their phone is the one
            // that's asleep, in which case the next awake claimer goes first
            'meta/actorUid': actorFromOrder(order, players, 1),
            // the splash opens the ready gate from a clean slate
            'meta/forceNext': false,
            ...readyResetPaths(roomRef.current),
          }).catch(() => {});
        }
        return;
      }

      if (m.phase === 'intro') {
        // The splash explains the game and then hands the table the floor:
        // nothing starts until every *awake* phone taps ready ('manual' pacing
        // hands that job to the host instead). A phone that's asleep sits the
        // count out instead of freezing the room; it plays the next round it's
        // awake for.
        const ready =
          m.forceNext === true ||
          (pacingOf(m.settings) === 'ready' && notReady(roomRef.current).length === 0);
        if (!ready) return;
        // Unlike a countdown, a satisfied ready gate stays satisfied until the
        // snapshot comes back — so launch each round exactly once per host
        // session (a reload clears this and re-launches if it must).
        if (launchedRound === m.round) return;
        const d = currentDef();
        // Snapshot the roster for this round: exactly the phones that are here
        // right now. That's what makes "phone died mid-round" survivable and
        // "joined mid-match" land on the *next* game instead of this one.
        const roster = livePlayers(roomRef.current);
        const ctx = buildCtx(roster);
        if (d && ctx) {
          const s0 = d.createInitialState(ctx);
          stateMirror = s0;
          processedInputs.clear();
          timerSeen = null;
          ended = false;
          roundUids = roster.map((p) => p.uid);
          await update(ref(rdb, `rooms/${code}`), {
            game: { type: d.id, state: s0, timerEndsAt: null, inputs: null },
            'meta/phase': 'playing',
            'meta/roundUids': roundUids,
          }).catch(() => {});
          launchedRound = m.round;
          dispatch({ type: 'BEGIN' }); // games arm their initial timers here
        }
        return;
      }

      if (m.phase === 'playing') {
        // self-heal: a game whose entire state was dropped by RTDB
        // (empty objects/arrays vanish) gets re-initialized fresh
        if (game()?.state == null) {
          const d = currentDef();
          const ctx = buildCtx();
          if (d && ctx && game()) {
            const s0 = d.createInitialState(ctx);
            stateMirror = s0;
            await update(ref(rdb, `rooms/${code}`), {
              'game/state': s0,
              'game/inputs': null,
            }).catch(() => {});
            dispatch({ type: 'BEGIN' });
          }
          return;
        }
        const t = game()?.timerEndsAt;
        if (typeof t === 'number' && now >= t && timerSeen !== t) {
          timerSeen = t;
          dispatch({ type: 'TIME_UP', now });
        }
        drainInputs();
        return;
      }

      if (m.phase === 'outcome') {
        // 'manual' pacing: parked until the host taps continue (forceNext).
        // 'ready' pacing: parked until every awake phone has tapped Ready —
        // a player whose screen went dark can't tap, so they neither hold the
        // table up nor lose their seat. The host can always force it through.
        if (pacingOf(m.settings) === 'manual') {
          if (!m.forceNext) return;
        } else if (!m.forceNext && notReady(roomRef.current).length > 0) {
          return;
        }
        const endsAt = m.outcomeEndsAt ?? now;
        if (now >= endsAt) {
          const enabled = (m.settings.enabledGames ?? []).filter((id) => gameById.has(id));
          const pool = enabled.length > 0 ? enabled : allGames.map((g) => g.id);
          let rotation = m.rotation;
          let gameIndex = m.gameIndex + 1;
          if (gameIndex >= rotation.length) {
            rotation = shuffled(pool, Math.random);
            gameIndex = 0;
          }
          // next round runs straight into the intro — the claimed order
          // cycles automatically, no claiming between rounds
          const nextRoundNum = m.round + 1;

          // The order follows the room: everyone who still has a seat keeps
          // their slot (a sleeping phone resumes its own when it wakes), anyone
          // who joined mid-match is appended, and only departures drop out.
          const order = turnOrderForRoom(roomRef.current);
          if (JSON.stringify(order) !== JSON.stringify(m.turnOrder ?? [])) {
            await set(ref(rdb, `rooms/${code}/meta/turnOrder`), order).catch(() => {});
          }
          // ...and the actor is whoever's turn it is *and* is around to take it
          const nextActor = actorFromOrder(order, livePlayers(roomRef.current), nextRoundNum);

          stateMirror = null;
          roundUids = null; // the next round snapshots its own roster at launch
          await update(ref(rdb, `rooms/${code}`), {
            game: null,
            'meta/phase': 'intro',
            'meta/round': nextRoundNum,
            'meta/rotation': rotation,
            'meta/gameIndex': gameIndex,
            'meta/actorUid': nextActor,
            'meta/roundUids': null,
            'meta/outcome': null,
            'meta/forceNext': false,
            'meta/outcomeEndsAt': null,
            ...readyResetPaths(roomRef.current),
          }).catch(() => {});
        }
      }
    };

    const unsubRoom = onValue(ref(rdb, `rooms/${code}`), () => void advance());
    const iv = window.setInterval(() => void advance(), 400);
    // keep the room's TTL ahead of a live session so GC never collects it
    // (1 min under the 24h rules cap to absorb clock/latency skew)
    const refreshTtl = () => {
      const until = serverNow() + ROOM_TTL_MS - 60000;
      set(ref(rdb, `rooms/${code}/meta/expiresAt`), until).catch(() => {});
      set(ref(rdb, `roomIndex/${code}`), until).catch(() => {});
    };
    const ttlIv = window.setInterval(refreshTtl, 10 * 60 * 1000);
    refreshTtl();
    const onVis = () => document.visibilityState === 'visible' && void advance();
    document.addEventListener('visibilitychange', onVis);

    void advance();

    return () => {
      unsubRoom();
      unsubInputs();
      window.clearInterval(iv);
      window.clearInterval(ttlIv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [uid, isAuthority, room?.meta?.code, active]);
}
