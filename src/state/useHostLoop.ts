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
import { activePlayers, INTRO_MS, OUTCOME_MS, type GameInputEntry, type RoomData } from '../types';
import { allGames, gameById } from '../games';
import { mulberry32, shuffled } from '../engine/rng';
import type { Effect, GameContext, GameEvent } from '../engine/types';

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

    const buildCtx = (): GameContext | null => {
      const m = meta();
      if (!m) return null;
      const players = activePlayers(roomRef.current);
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
            await update(ref(rdb, `rooms/${code}/meta`), {
              phase: 'outcome',
              outcome: {
                gameId: dNow?.id ?? '',
                gameName: dNow?.name ?? '',
                gameEmoji: dNow?.emoji ?? '',
                assignments: fx.assignments ?? [],
                note: fx.note ?? null,
              },
              outcomeEndsAt: serverNow() + OUTCOME_MS,
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
        // round 1 begins and the order runs the whole game.
        let order = [...(m.turnOrder ?? [])];
        const claim = roomRef.current?.turnClaim?.[order.length];
        if (claim?.uid && !order.includes(claim.uid)) {
          order = [...order, claim.uid];
          // set() (not multi-path update): an array is only legal as a VALUE,
          // never as update()'s path map — update(ref, array) throws.
          await set(ref(rdb, `rooms/${code}/meta/turnOrder`), order).catch(() => {});
        }
        const players = activePlayers(roomRef.current);
        const complete =
          order.length > 0 &&
          (order.length >= Math.max(1, players.length) || m.forceStart === true);
        if (complete) {
          await update(ref(rdb, `rooms/${code}/meta`), {
            phase: 'intro',
            round: 1,
            actorUid: order[0],
            introEndsAt: now + INTRO_MS,
          }).catch(() => {});
        }
        return;
      }

      if (m.phase === 'intro') {
        const endsAt = m.introEndsAt ?? now + INTRO_MS;
        if (now >= endsAt) {
          const d = currentDef();
          const ctx = buildCtx();
          if (d && ctx) {
            const s0 = d.createInitialState(ctx);
            stateMirror = s0;
            processedInputs.clear();
            timerSeen = null;
            ended = false;
            await update(ref(rdb, `rooms/${code}`), {
              game: { type: d.id, state: s0, timerEndsAt: null, inputs: null },
              'meta/phase': 'playing',
            }).catch(() => {});
            dispatch({ type: 'BEGIN' }); // games arm their initial timers here
          }
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
          const order = m.turnOrder ?? [];
          const nextRoundNum = m.round + 1;
          const nextActor = order.length > 0 ? order[(nextRoundNum - 1) % order.length] : null;
          stateMirror = null;
          await update(ref(rdb, `rooms/${code}`), {
            game: null,
            'meta/phase': 'intro',
            'meta/round': nextRoundNum,
            'meta/rotation': rotation,
            'meta/gameIndex': gameIndex,
            'meta/actorUid': nextActor,
            'meta/introEndsAt': now + INTRO_MS,
            'meta/outcome': null,
          }).catch(() => {});
        }
      }
    };

    const unsubRoom = onValue(ref(rdb, `rooms/${code}`), () => void advance());
    const iv = window.setInterval(() => void advance(), 400);
    const onVis = () => document.visibilityState === 'visible' && void advance();
    document.addEventListener('visibilitychange', onVis);

    void advance();

    return () => {
      unsubRoom();
      unsubInputs();
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [uid, isAuthority, room?.meta?.code, active]);
}
