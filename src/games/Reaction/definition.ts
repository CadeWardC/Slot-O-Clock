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

/** what a disqualification costs — more than merely being slow */
export const DQ_SIPS = 3;
export const SLOW_SIPS = 2;
/** how long the results ladder stays up before the round closes */
export const RESULTS_MS = 6000;

function finish(state: RxState, ctx: GameContext): ReduceResult<RxState> {
  const taps: Record<string, Tap> = { ...(state.taps ?? {}) };
  for (const p of ctx.players) {
    if (!taps[p.uid]) taps[p.uid] = { ms: null, early: false };
  }

  const assignments: DrinkAssignment[] = [];
  const inRound = Object.entries(taps).filter(([uid]) => ctx.players.some((p) => p.uid === uid));
  const dq = inRound.filter(([, t]) => t.early).map(([uid]) => uid);
  const valid = inRound.filter(([, t]) => !t.early && t.ms != null);
  const asleep = inRound.filter(([, t]) => !t.early && t.ms == null).map(([uid]) => uid);

  if (dq.length > 0) {
    // A false start IS the loss: whoever jumped takes the loser's drinks, and
    // the slowest honest finger walks away clean.
    for (const uid of dq) {
      assignments.push({ uid, sips: DQ_SIPS, reason: 'Tapped before green' });
    }
  } else if (asleep.length > 0 && valid.length > 0) {
    // nobody cheated, but somebody never tapped at all: slower than slow
    for (const uid of asleep) {
      assignments.push({ uid, sips: SLOW_SIPS, reason: 'Never tapped' });
    }
  } else if (valid.length >= 2) {
    const slowest = valid.reduce((a, b) => ((b[1].ms as number) > (a[1].ms as number) ? b : a));
    assignments.push({ uid: slowest[0], sips: SLOW_SIPS, reason: 'Slowest finger' });
  }

  const effects: Effect[] = [{ type: 'TIMER', ms: RESULTS_MS }];
  let note: string | null = null;
  if (valid.length > 0) {
    const fastest = valid.reduce((a, b) => ((b[1].ms as number) < (a[1].ms as number) ? b : a));
    const who = ctx.players.find((p) => p.uid === fastest[0]);
    note = `Fastest: ${who?.name ?? '?'}, ${Math.round(fastest[1].ms as number)} ms`;
    effects.push({ type: 'SCORE', uid: fastest[0], delta: 1 });
  } else {
    note = dq.length > 0 ? 'Everyone tapped early.' : 'Nobody tapped.';
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
    'Wait for green, then tap as fast as you can. Tap before green and you are disqualified and drink 3. If nobody jumps, the slowest finger drinks 2.',
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
      // one tap per player, and a disqualification is final
      if ((state.taps ?? {})[event.uid]) return { state };
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
      const taps = { ...(state.taps ?? {}), [event.uid]: tap };
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
