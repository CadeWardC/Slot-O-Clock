/**
 * ============================================================
 *  GAME TEMPLATE — copy me to make a new game!
 * ============================================================
 * `npm run new-game -- "My Game"` does this for you.
 *
 * A game is exactly this folder + these three parts:
 *   1. metadata (id / name / emoji / rules / minPlayers)
 *   2. createInitialState + reduce  → pure HOST logic
 *   3. View                         → what every phone renders
 *
 * You get for free: turn claiming (I'll Start / I'm Next),
 * intro splash, input plumbing, fair timers, drink assignments,
 * outcome screen, scores, shared-phone pass-around gating.
 */

import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

/** Your game's state — whatever YOU need it to be. */
export interface CoinState {
  phase: 'ready' | 'flipping' | 'result';
  result: 'heads' | 'tails' | null;
  assignments: DrinkAssignment[];
}

/** Your game's input — what a phone submits via submitInput(). */
export interface CoinInput {
  action: 'flip';
}

export const definition: GameDefinition<CoinState, CoinInput> = {
  id: '__GAME_ID__',
  name: '__GAME_NAME__',
  emoji: '🪙',
  rules: 'Coin flip: heads — everyone else drinks 1. Tails — the flipper drinks 1.',
  minPlayers: 1,

  createInitialState(_ctx: GameContext): CoinState {
    return { phase: 'ready', result: null, assignments: [] };
  },

  /**
   * Pure reducer — runs ONLY on the host phone. Return the next state
   * plus optional effects. Never mutate: always return a fresh object.
   */
  reduce(state, event: GameEvent<CoinInput>, ctx: GameContext): ReduceResult<CoinState> {
    // A player did something (only the turn actor may flip here)
    if (event.type === 'INPUT') {
      if (event.input?.action !== 'flip') return { state };
      if (state.phase !== 'ready' || event.uid !== ctx.actorUid) return { state };
      return {
        state: { ...state, phase: 'flipping' },
        effects: [{ type: 'TIMER', ms: 1500 }], // ask the engine for a TIME_UP in 1.5s
      };
    }

    // An engine timer expired
    if (event.type === 'TIME_UP') {
      if (state.phase === 'flipping') {
        const result = ctx.rng() < 0.5 ? 'heads' : 'tails';
        const assignments: DrinkAssignment[] =
          result === 'heads'
            ? ctx.players
                .filter((p) => p.uid !== ctx.actorUid)
                .map((p) => ({ uid: p.uid, sips: 1, reason: 'Heads 🪙' }))
            : [{ uid: ctx.actorUid!, sips: 1, reason: 'Tails 🪙' }];
        return {
          state: { ...state, phase: 'result', result, assignments },
          effects: [{ type: 'TIMER', ms: 1400 }],
        };
      }
      if (state.phase === 'result') {
        // END the round; assignments are applied & shown on the outcome screen
        return {
          state,
          effects: [{ type: 'END', assignments: state.assignments }],
        };
      }
    }

    return { state };
  },

  View,
};

export default definition;
