import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { shuffled } from '../../engine/rng';
import { View } from './View';

export const CUP_COUNT = 4;
export const SIPS = 2;
/** display name of the rng-controlled poisoner for odd groups */
export const HOUSE_NAME = 'The House 🎲';

const PICK_MS = 60_000; // safety net: fate picks for anyone who vanished
const REVEAL_MS = 5_000;

export interface PoisonPair {
  drinkerUid: string;
  /** the player poisoner, or null → the House (odd group) */
  poisonerUid: string | null;
  /** the House's cup — rolled at reveal so it is never in sync before then */
  houseCup: number | null;
}

export interface PoisonState {
  phase: 'pouring' | 'reveal';
  pairs: PoisonPair[];
  /** poisonerUid → poisoned cup (0..CUP_COUNT-1); RTDB drops empty objects */
  poisons: Record<string, number>;
  /** drinkerUid → picked cup (0..CUP_COUNT-1) */
  picks: Record<string, number>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface PoisonInput {
  /** cup index: poisoner → the cup to spike, drinker → the cup to drink */
  cup: number;
}

/**
 * Split & pair: shuffle everyone, first half poisoners, second half
 * drinkers, pair by index. An odd leftover drinks against The House.
 */
function makePairs(ctx: GameContext): PoisonPair[] {
  const order = shuffled(ctx.players.map((p) => p.uid), ctx.rng);
  const half = Math.floor(order.length / 2);
  const pairs: PoisonPair[] = [];
  for (let i = 0; i < half; i++) {
    pairs.push({ drinkerUid: order[half + i], poisonerUid: order[i], houseCup: null });
  }
  for (const leftover of order.slice(half * 2)) {
    pairs.push({ drinkerUid: leftover, poisonerUid: null, houseCup: null });
  }
  return pairs;
}

function reveal(state: PoisonState, ctx: GameContext): ReduceResult<PoisonState> {
  const poisons = state.poisons ?? {};
  const picks = state.picks ?? {};
  const assignments: DrinkAssignment[] = [];
  const effects: Effect[] = [{ type: 'TIMER', ms: REVEAL_MS }];
  let hits = 0;

  const pairs = state.pairs.map((pair) => {
    const drinker = ctx.players.find((p) => p.uid === pair.drinkerUid);
    const poisoner =
      pair.poisonerUid != null ? ctx.players.find((p) => p.uid === pair.poisonerUid) : null;
    // the House rolls its cup only now — it was never in the synced state
    const poisonedCup =
      pair.poisonerUid != null ? poisons[pair.poisonerUid] : Math.floor(ctx.rng() * CUP_COUNT);
    const pickedCup = picks[pair.drinkerUid] ?? Math.floor(ctx.rng() * CUP_COUNT);
    const hit = pickedCup === poisonedCup;

    if (hit) {
      hits++;
      if (drinker) {
        assignments.push({
          uid: drinker.uid,
          sips: SIPS,
          reason:
            pair.poisonerUid != null
              ? `Poisoned by ${poisoner?.name ?? '?'} ☠️`
              : `${HOUSE_NAME} got you ☠️`,
        });
      }
      if (pair.poisonerUid != null) effects.push({ type: 'SCORE', uid: pair.poisonerUid, delta: 1 });
    } else if (pair.poisonerUid != null) {
      if (poisoner) {
        assignments.push({
          uid: poisoner.uid,
          sips: SIPS,
          reason: `${drinker?.name ?? '?'} dodged it 🍷`,
        });
      }
      if (drinker) effects.push({ type: 'SCORE', uid: drinker.uid, delta: 1 });
    }

    return pair.poisonerUid == null ? { ...pair, houseCup: poisonedCup } : pair;
  });

  const dodges = pairs.length - hits;
  const note =
    hits === 0
      ? 'Every drinker dodged! 🍷'
      : dodges === 0
        ? 'Total poisoning ☠️'
        : `☠️ ${hits} poisoned · 🍷 ${dodges} dodged`;

  return {
    state: { ...state, phase: 'reveal', pairs, assignments, note },
    effects,
  };
}

export const definition: GameDefinition<PoisonState, PoisonInput> = {
  id: 'poison',
  name: 'Poisoning the Drinks',
  emoji: '☠️',
  rules:
    'Half of you are poisoners, half are drinkers. Each poisoner spikes ONE of their victim\'s 4 cups — then the drinker picks one to drink. Safe cup → the poisoner drinks 2. Poisoned → bottoms up, 2 for the drinker.',
  minPlayers: 2,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): PoisonState {
    return { phase: 'pouring', pairs: makePairs(ctx), poisons: {}, picks: {}, assignments: [], note: null };
  },

  reduce(state, event: GameEvent<PoisonInput>, ctx: GameContext): ReduceResult<PoisonState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: PICK_MS }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase !== 'pouring' || event.input == null) return { state };
      const cup = Math.floor(Number(event.input.cup));
      if (!Number.isInteger(cup) || cup < 0 || cup >= CUP_COUNT) return { state };
      const pair = (state.pairs ?? []).find(
        (p) => p.drinkerUid === event.uid || p.poisonerUid === event.uid,
      );
      if (!pair) return { state };

      // picks are accepted in any order — the shared phone can't control
      // who holds it first, and resolution only happens at reveal anyway
      const poisons = { ...(state.poisons ?? {}) };
      const picks = { ...(state.picks ?? {}) };
      if (event.uid === pair.poisonerUid) {
        if (poisons[event.uid] != null) return { state };
        poisons[event.uid] = cup;
      } else {
        if (picks[event.uid] != null) return { state };
        picks[event.uid] = cup;
      }
      const next: PoisonState = { ...state, poisons, picks };
      const everyoneIn = (state.pairs ?? []).every(
        (p) =>
          picks[p.drinkerUid] != null &&
          (p.poisonerUid == null || poisons[p.poisonerUid] != null),
      );
      return everyoneIn ? reveal(next, ctx) : { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'pouring') {
        // fate fills in for anyone who never picked
        const poisons = { ...(state.poisons ?? {}) };
        const picks = { ...(state.picks ?? {}) };
        for (const p of state.pairs ?? []) {
          if (p.poisonerUid != null && poisons[p.poisonerUid] == null)
            poisons[p.poisonerUid] = Math.floor(ctx.rng() * CUP_COUNT);
          if (picks[p.drinkerUid] == null)
            picks[p.drinkerUid] = Math.floor(ctx.rng() * CUP_COUNT);
        }
        return reveal({ ...state, poisons, picks }, ctx);
      }
      if (state.phase === 'reveal') {
        return {
          state,
          effects: [{ type: 'END', assignments: state.assignments ?? [], note: state.note }],
        };
      }
    }

    return { state };
  },

  View,
};

export default definition;
