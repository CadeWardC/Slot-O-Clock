import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

/** the "wait for green" window (party mode): a random floor + jitter */
const WAIT_MIN_MS = 1500;
const WAIT_JITTER_MS = 2500;
/**
 * Party mode doesn't *react* to green the moment the phase write lands —
 * that would time each phone's network lag, not its finger. Instead the host
 * announces the server-time instant green lights up (`goAt`), far enough
 * ahead that every phone has heard about it, and each device starts its own
 * stopwatch when its own clock reaches it. Everyone sees green at the same
 * real-world moment; nobody's number depends on how fast their signal is.
 */
const SYNC_LEAD_MS = 700;
/** how long after green the taps are still accepted */
const GO_WINDOW_MS = 3000;
/**
 * Shared mode has no shared clock — the one phone lights green for whoever is
 * holding it and times them locally. This is only a safety net for a phone
 * that walks off; the host can always skip the round instead.
 */
const SHARED_WINDOW_MS = 120_000;

interface Tap {
  /** reaction time in ms, measured on the player's own device; null = early/never */
  ms: number | null;
  early: boolean;
}

export interface RxState {
  phase: 'ready' | 'go' | 'done';
  /**
   * Party mode: the server-time instant every phone shows green. Null in
   * shared mode, where each holder gets a private green on the one phone.
   */
  goAt: number | null;
  taps: Record<string, Tap>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface RxInput {
  /**
   * The player's own stopwatch reading, in ms: green → tap, measured with
   * `performance.now()` on the device that was tapped. This is what the
   * whole round is scored on — network lag never enters the number.
   */
  reactionMs?: number;
  early?: boolean;
  /** legacy (pre on-device timing) party taps: server-time of the tap */
  at?: number;
}

function finish(state: RxState, ctx: GameContext): ReduceResult<RxState> {
  const taps: Record<string, Tap> = { ...state.taps };
  for (const p of ctx.players) {
    if (!taps[p.uid]) taps[p.uid] = { ms: null, early: false };
  }

  const assignments: DrinkAssignment[] = [];
  const earlyUids = Object.entries(taps)
    .filter(([, t]) => t.early)
    .map(([uid]) => uid);
  const valid = Object.entries(taps).filter(([, t]) => !t.early && t.ms != null);

  for (const uid of earlyUids) {
    assignments.push({ uid, sips: 2, reason: 'Jumped the gun 🚨' });
  }

  if (valid.length >= 2) {
    const slowest = valid.reduce((a, b) => ((b[1].ms as number) > (a[1].ms as number) ? b : a));
    assignments.push({ uid: slowest[0], sips: 2, reason: 'Slowest finger 🐌' });
  }

  const effects: Effect[] = [{ type: 'TIMER', ms: 2600 }];
  let note: string | null = null;
  if (valid.length > 0) {
    const fastest = valid.reduce((a, b) => ((b[1].ms as number) < (a[1].ms as number) ? b : a));
    const who = ctx.players.find((p) => p.uid === fastest[0]);
    note = `⚡ Fastest: ${who?.name ?? '?'} — ${((fastest[1].ms as number) / 1000).toFixed(2)}s`;
    effects.push({ type: 'SCORE', uid: fastest[0], delta: 1 });
  } else {
    note = earlyUids.length > 0 ? 'Everyone jumped the gun 🚨' : 'Nobody tapped 🤷';
  }

  return {
    state: { ...state, phase: 'done', taps, assignments, note },
    effects,
  };
}

export const definition: GameDefinition<RxState, RxInput> = {
  id: 'reaction',
  name: 'Reaction Duel',
  emoji: '⚡',
  rules:
    'Wait for GREEN, then tap as fast as you can — your own phone holds the stopwatch, so lag and slow Wi-Fi can\'t cost you time. Tap early and you drink 2. When everyone plays, the slowest finger drinks 2.',
  minPlayers: 2,

  createInitialState(): RxState {
    return { phase: 'ready', goAt: null, taps: {}, assignments: [], note: null };
  },

  reduce(state, event: GameEvent<RxInput>, ctx: GameContext): ReduceResult<RxState> {
    const shared = ctx.settings.mode === 'shared';

    if (event.type === 'BEGIN') {
      // shared phone: each holder is timed on-device from their own green, so
      // there is nothing to synchronise — only a safety net for a lost phone
      if (shared) return { state, effects: [{ type: 'TIMER', ms: SHARED_WINDOW_MS }] };
      // random wait so nobody can pretime the green
      return {
        state,
        effects: [{ type: 'TIMER', ms: WAIT_MIN_MS + Math.floor(ctx.rng() * WAIT_JITTER_MS) }],
      };
    }

    if (event.type === 'INPUT') {
      if (state.phase === 'done') return { state };
      const input = event.input ?? {};
      let tap: Tap;
      if (input.reactionMs != null) {
        // on-device stopwatch: green → tap, measured on the phone that tapped
        tap = { ms: Math.max(0, Math.min(9999, input.reactionMs)), early: !!input.early };
        // shared mode arms no green at all; party mode's green is only real
        // once the host has moved the round to 'go'
        if (!shared && state.phase !== 'go') tap = { ms: null, early: true };
      } else {
        // legacy input (a phone still running the old bundle)
        const early = !!input.early || state.phase === 'ready';
        tap = { ms: early ? null : Math.max(0, (input.at ?? ctx.now) - (state.goAt ?? ctx.now)), early };
      }
      const taps = { ...state.taps, [event.uid]: tap };
      const next: RxState = { ...state, taps };
      if (Object.keys(taps).length >= ctx.players.length) return finish(next, ctx);
      return { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'ready') {
        // shared mode: the safety net expired — resolve with whoever tapped
        if (shared) return finish(state, ctx);
        // announce green a moment in the future so every phone can line up
        const goAt = ctx.now + SYNC_LEAD_MS;
        return {
          state: { ...state, phase: 'go', goAt },
          effects: [{ type: 'TIMER', ms: SYNC_LEAD_MS + GO_WINDOW_MS }],
        };
      }
      if (state.phase === 'go') {
        return finish(state, ctx); // stragglers never tapped
      }
      if (state.phase === 'done') {
        return { state, effects: [{ type: 'END', assignments: state.assignments, note: state.note }] };
      }
    }

    return { state };
  },

  View,
};

export default definition;
