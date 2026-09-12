import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

/** The 8-symbol reel, exported so the View can render the spinning strip. */
export const SYMBOLS = ['🍺', '🍻', '🥃', '🍷', '🍹', '🍒', '🎰', '💀'] as const;
const WILD = 6;
const SKULL = 7;

/** how long players have to spin before the round ends */
const SPIN_WINDOW_MS = 30000;
/**
 * After the last lever is pulled the reels HOLD on screen for this long
 * before the round closes — otherwise the final spin (and, on a shared
 * phone, the only spin) ends the round the instant it lands and nobody
 * ever gets to read what they actually got.
 */
export const HOLD_MS = 10000;

export interface SpinResult {
  reels: number[];
  line: string;
  sips: number;
}

export interface SlotsState {
  /** 'spin' while levers are live, then 'hold' while everyone reads their result */
  phase: 'spin' | 'hold';
  /** server-time the round began — scalar anchor so the state node
   *  survives RTDB dropping the empty `spins` map */
  startedAt: number;
  /** per-player results, keyed by uid (RTDB drops empty maps — read with ?? {}) */
  spins: Record<string, SpinResult>;
}

export interface SlotsInput {
  action: 'spin';
}

/** Per-player paytable — your reels decide YOUR fate. */
function spinFor(rng: () => number): SpinResult {
  const reels = [-1, -1, -1].map(() => Math.floor(rng() * SYMBOLS.length));
  const wilds = reels.filter((s) => s === WILD).length;
  const nonWild = reels.filter((s) => s !== WILD);

  let bestSym = -1;
  let bestCount = 0;
  for (const s of nonWild) {
    const c = nonWild.filter((x) => x === s).length;
    if (c > bestCount) {
      bestCount = c;
      bestSym = s;
    }
  }
  const effective = bestCount + wilds;
  const e = bestSym >= 0 ? SYMBOLS[bestSym] : '🎰';

  if (nonWild.length === 0) {
    return { reels, line: '🎰🎰🎰 JACKPOT — safe!', sips: 0 };
  }
  if (effective >= 3) {
    if (bestSym === SKULL) {
      return { reels, line: '💀💀💀 FINISH YOUR DRINK!', sips: 5 };
    }
    return { reels, line: `${e}${e}${e} TRIPLE — safe!`, sips: 0 };
  }
  if (effective >= 2) {
    return { reels, line: `Pair of ${e} — drink 2`, sips: 2 };
  }
  return { reels, line: 'No match — drink 1', sips: 1 };
}

/**
 * Close the lever window and let the reels sit still. This is the phase
 * that gives everyone a proper look at their own result.
 */
function toHold(state: SlotsState): ReduceResult<SlotsState> {
  return {
    state: { ...state, phase: 'hold' },
    effects: [{ type: 'TIMER', ms: HOLD_MS }],
  };
}

function endRound(state: SlotsState, ctx: GameContext): ReduceResult<SlotsState> {
  const assignments: DrinkAssignment[] = [];
  for (const p of ctx.players) {
    const spin = state.spins[p.uid];
    if (spin && spin.sips > 0) {
      assignments.push({ uid: p.uid, sips: spin.sips, reason: spin.line });
    }
  }
  const spun = Object.keys(state.spins).length;
  return {
    state,
    effects: [
      {
        type: 'END',
        assignments,
        note: `${spun}/${ctx.players.length} spun the machine`,
      },
    ],
  };
}

export const definition: GameDefinition<SlotsState, SlotsInput> = {
  id: 'slots',
  name: 'Slot Machine',
  emoji: '🎰',
  rules:
    'Everyone spins their own machine at the same time. 💀💀💀 and you finish your drink, a pair costs 2, no match costs 1 — any other triple keeps you safe. 🎰 is wild.',
  minPlayers: 1,
  sharedInput: 'actor', // shared phone: only the actor spins

  createInitialState(ctx: GameContext): SlotsState {
    return { phase: 'spin', startedAt: ctx.now, spins: {} };
  },

  reduce(state, event: GameEvent<SlotsInput>, ctx: GameContext): ReduceResult<SlotsState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: SPIN_WINDOW_MS }] };
    }

    if (event.type === 'INPUT') {
      if (event.input?.action !== 'spin') return { state };
      if (state.phase === 'hold') return { state }; // results are already on screen
      const spins = state.spins ?? {};
      if (spins[event.uid]) return { state }; // one spin per player
      // shared phone: only the actor plays
      if (ctx.settings.mode === 'shared' && event.uid !== ctx.actorUid) return { state };
      const next = { ...spins, [event.uid]: spinFor(ctx.rng) };
      const nextState: SlotsState = { ...state, spins: next };
      if (Object.keys(next).length >= ctx.players.length) {
        return toHold(nextState); // everyone's in — hold the reels before closing
      }
      return { state: nextState };
    }

    if (event.type === 'TIME_UP') {
      // window closed — stragglers just don't spin, then the reels hold
      if (state.phase === 'hold') return endRound(state, ctx);
      return toHold(state);
    }

    return { state };
  },

  View,
};

export default definition;
