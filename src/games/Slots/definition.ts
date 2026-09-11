import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

export const SYMBOLS = ['🍺', '🍻', '🥃', '🍷', '🍹', '🍒', '🎰', '💀'] as const;
const WILD = 6;
const SKULL = 7;

const SPIN_MS = 2400;
const RESULT_MS = 3800;

export interface SlotsState {
  phase: 'idle' | 'spinning' | 'result';
  reels: number[];
  line: string;
  assignments: DrinkAssignment[];
}

export interface SlotsInput {
  action: 'spin';
}

function evaluate(reels: number[], ctx: GameContext): { line: string; assignments: DrinkAssignment[] } {
  const actor = ctx.players.find((p) => p.uid === ctx.actorUid) ?? ctx.players[0];
  const others = ctx.players.filter((p) => p.uid !== actor.uid);
  const wilds = reels.filter((s) => s === WILD).length;
  const nonWild = reels.filter((s) => s !== WILD);

  // find the most common non-wild symbol
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
  const everyoneElse = (sips: number, reason: string) =>
    others.map((p) => ({ uid: p.uid, sips, reason }));

  if (nonWild.length === 0) {
    return {
      line: '🎰🎰🎰 JACKPOT!',
      assignments: everyoneElse(3, 'JACKPOT! 🎰🎰🎰'),
    };
  }
  if (effective >= 3) {
    if (bestSym === SKULL) {
      return {
        line: '💀💀💀 TRIPLE SKULL!',
        assignments: [{ uid: actor.uid, sips: 5, reason: 'Triple Skull — finish it! 💀' }],
      };
    }
    const emoji = SYMBOLS[bestSym];
    return {
      line: `${emoji}${emoji}${emoji} TRIPLE!`,
      assignments: everyoneElse(2, `Triple ${emoji}!`),
    };
  }
  if (effective >= 2) {
    const emoji = SYMBOLS[bestSym];
    const idx = ctx.players.findIndex((p) => p.uid === actor.uid);
    const neighbor = ctx.players[(idx + 1) % ctx.players.length];
    return {
      line: `Pair of ${emoji}!`,
      assignments:
        neighbor && neighbor.uid !== actor.uid
          ? [{ uid: neighbor.uid, sips: 2, reason: `Pair of ${emoji} — spinner's neighbor!` }]
          : [{ uid: actor.uid, sips: 2, reason: `Pair of ${emoji}` }],
    };
  }
  return {
    line: 'No match — house wins 🎩',
    assignments: [{ uid: actor.uid, sips: 1, reason: 'No match' }],
  };
}

export const definition: GameDefinition<SlotsState, SlotsInput> = {
  id: 'slots',
  name: 'Slot Machine',
  emoji: '🎰',
  rules:
    'The spinner pulls the lever. Triples make everyone else drink, 💀💀💀 makes the spinner finish theirs, 🎰 is wild — and no match means the house wins.',
  minPlayers: 1,

  createInitialState(): SlotsState {
    return { phase: 'idle', reels: [-1, -1, -1], line: '', assignments: [] };
  },

  reduce(state, event: GameEvent<SlotsInput>, ctx: GameContext): ReduceResult<SlotsState> {
    if (event.type === 'INPUT') {
      if (event.input?.action !== 'spin') return { state };
      if (state.phase !== 'idle' || event.uid !== ctx.actorUid) return { state };
      return {
        state: { ...state, phase: 'spinning' },
        effects: [{ type: 'TIMER', ms: SPIN_MS }],
      };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'spinning') {
        const reels = [-1, -1, -1].map(() => Math.floor(ctx.rng() * SYMBOLS.length));
        const { line, assignments } = evaluate(reels, ctx);
        return {
          state: { ...state, phase: 'result', reels, line, assignments },
          effects: [{ type: 'TIMER', ms: RESULT_MS }],
        };
      }
      if (state.phase === 'result') {
        return { state, effects: [{ type: 'END', assignments: state.assignments, note: state.line }] };
      }
    }

    return { state };
  },

  View,
};

export default definition;
