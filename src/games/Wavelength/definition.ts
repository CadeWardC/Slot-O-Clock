/**
 * ============================================================
 *  WAVELENGTH — one player knows the target, everyone else dials
 * ============================================================
 * The turn actor is the clue-giver: they see where the target sits
 * on a spectrum and say a clue out loud. Everyone else slides a
 * dial 0-100 and locks it in. The furthest guess drinks, and a
 * group average that lands nowhere means the clue failed — the
 * actor drinks instead.
 *
 * Shared-phone note: the pass-around gate only advances when a
 * player submits an input, and in the clue phase the non-actors
 * have nothing to submit (likewise the actor during guessing).
 * `{ action: 'wait' }` exists purely to move the phone along — the
 * reducer ignores it, so it can never change the game state.
 */

import spectrums from '../../content/spectrums.json';
import { pick } from '../../engine/rng';
import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

export const CLUE_MS = 30_000;
export const GUESS_MS = 40_000;
const REVEAL_MS = 9_000;
const FAR_SIPS = 2;
const BAD_CLUE_SIPS = 2;
const EASY_SIPS = 1;
/** guesses averaging farther than this from the target mean the clue failed */
export const BAD_CLUE_DISTANCE = 30;
/** within this counts as dead on */
export const EASY_DISTANCE = 8;

export type Spectrum = { l: string; r: string };
const PACK = spectrums as Spectrum[];

export interface WlState {
  phase: 'clue' | 'guessing' | 'reveal';
  left: string;
  right: string;
  /** 0-100 — only the actor's phone renders this before the reveal */
  target: number;
  /** uid → dial position 0-100 */
  guesses: Record<string, number>;
  assignments: DrinkAssignment[];
  closestUids: string[];
  average: number | null;
  note: string | null;
}

export type WlInput =
  | { action: 'clue' }
  | { action: 'guess'; value: number }
  | { action: 'wait' };

function toGuessing(state: WlState): ReduceResult<WlState> {
  return {
    state: { ...state, phase: 'guessing' },
    // inputs are wiped so the pass-around gate restarts for the guessers
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: GUESS_MS }],
  };
}

function reveal(state: WlState, ctx: GameContext): ReduceResult<WlState> {
  const target = Math.round(state.target);
  const entries = Object.entries(state.guesses ?? {}).map(([uid, value]) => ({
    uid,
    value,
    d: Math.abs(value - state.target),
  }));

  const assignments: DrinkAssignment[] = [];
  const effects: Effect[] = [{ type: 'TIMER', ms: REVEAL_MS }];

  if (entries.length === 0) {
    for (const p of ctx.players) {
      assignments.push({ uid: p.uid, sips: 1, reason: 'Nobody dialed 🎚️' });
    }
    return {
      state: {
        ...state,
        phase: 'reveal',
        assignments,
        closestUids: [],
        average: null,
        note: 'Nobody dialed a guess — everyone drinks 1 🍺',
      },
      effects,
    };
  }

  const minD = Math.min(...entries.map((e) => e.d));
  const closest = entries.filter((e) => e.d === minD).map((e) => e.uid);
  const average = entries.reduce((sum, e) => sum + e.value, 0) / entries.length;
  const avgDist = Math.abs(average - state.target);
  const soloDeadOn = entries.length === 1 && minD <= EASY_DISTANCE;

  if (soloDeadOn) {
    // one dial, dead on — the clue was too easy to be a fair round
    if (ctx.actorUid) {
      assignments.push({ uid: ctx.actorUid, sips: EASY_SIPS, reason: 'Dead on — too easy 😏' });
    }
  } else {
    const maxD = Math.max(...entries.map((e) => e.d));
    for (const e of entries.filter((x) => x.d === maxD)) {
      assignments.push({
        uid: e.uid,
        sips: FAR_SIPS,
        reason: `${Math.round(e.value)} — miles off ${target} 🎯`,
      });
    }
  }

  for (const uid of closest) effects.push({ type: 'SCORE', uid, delta: 1 });

  const badClue = avgDist > BAD_CLUE_DISTANCE;
  if (badClue && ctx.actorUid) {
    assignments.push({ uid: ctx.actorUid, sips: BAD_CLUE_SIPS, reason: 'That clue was useless 🗣️' });
  }

  const verdict = badClue
    ? 'the clue sent you all over the place 🗣️'
    : avgDist <= EASY_DISTANCE
      ? 'dead on ✅'
      : 'pretty close 👌';

  return {
    state: {
      ...state,
      phase: 'reveal',
      assignments,
      closestUids: closest,
      average,
      note: `🎯 "${state.left} ↔ ${state.right}" — the target was ${target}, you averaged ${Math.round(average)} (${verdict})`,
    },
    effects,
  };
}

export const definition: GameDefinition<WlState, WlInput> = {
  id: 'wavelength',
  name: 'Wavelength',
  emoji: '🎚️',
  rules:
    'One player sees a hidden target on the spectrum and says a clue out loud. Everyone else dials where they think it sits — furthest guess drinks 2, and if the group averages miles off, the clue-giver drinks 2 instead.',
  minPlayers: 3,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): WlState {
    const spectrum = pick(PACK, ctx.rng);
    return {
      phase: 'clue',
      left: spectrum.l,
      right: spectrum.r,
      target: Math.floor(ctx.rng() * 101),
      guesses: {},
      assignments: [],
      closestUids: [],
      average: null,
      note: null,
    };
  },

  reduce(state, event: GameEvent<WlInput>, ctx: GameContext): ReduceResult<WlState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: CLUE_MS }] };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (!input || state.phase === 'reveal') return { state };
      // shared-phone pass-along only — never touches the game state
      if (input.action === 'wait') return { state };

      if (input.action === 'clue') {
        if (state.phase !== 'clue' || event.uid !== ctx.actorUid) return { state };
        return toGuessing(state);
      }

      if (state.phase !== 'guessing' || event.uid === ctx.actorUid) return { state };
      const value = Math.round(Number(input.value));
      if (!Number.isFinite(value)) return { state };
      if ((state.guesses ?? {})[event.uid] != null) return { state };

      const guesses = {
        ...(state.guesses ?? {}),
        [event.uid]: Math.max(0, Math.min(100, value)),
      };
      const guessers = ctx.players.filter((p) => p.uid !== ctx.actorUid);
      const allIn = guessers.length > 0 && guessers.every((p) => guesses[p.uid] != null);
      const next: WlState = { ...state, guesses };
      return allIn ? reveal(next, ctx) : { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'clue') return toGuessing(state);
      if (state.phase === 'guessing') return reveal(state, ctx);
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
