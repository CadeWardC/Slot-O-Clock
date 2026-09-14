import type { GameDefinition, GameContext, GameEvent, ReduceResult } from '../src/engine/types.ts';

/**
 * A deliberately tiny game used to pin the engine's behaviour down.
 *
 * It is shaped exactly like the failure in the bug report — a private-card
 * phase that everyone acknowledges, which hands over to a short second phase
 * on a timer of its own:
 *
 *   A (10s)  everyone taps → B
 *   B (5s)   the countdown   → C
 *   C (1s)   → END (one drink for the first player)
 *
 * The "final tap lands at the deadline" case is the one that used to skip B
 * entirely: the state moved to B while the database still held A's deadline,
 * that deadline expired, and B was over two milliseconds after it started.
 */
export interface TinyState {
  phase: 'a' | 'b' | 'c';
  taps: Record<string, boolean>;
  ran: string[];
}

export const TINY_A_MS = 10_000;
export const TINY_B_MS = 5_000;
export const TINY_C_MS = 1_000;

export type TinyInput = { action: 'tap' };

export const tiny: GameDefinition<TinyState, TinyInput> = {
  id: 'tiny',
  name: 'Tiny',
  emoji: '🧪',
  rules: 'test-only',
  minPlayers: 1,

  createInitialState(_ctx: GameContext): TinyState {
    return { phase: 'a', taps: {}, ran: [] };
  },

  reduce(
    state: TinyState,
    event: GameEvent<TinyInput>,
    ctx: GameContext,
  ): ReduceResult<TinyState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: TINY_A_MS }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase !== 'a') return { state };
      if (state.taps[event.uid]) return { state };
      const taps = { ...state.taps, [event.uid]: true };
      const all = ctx.players.every((p) => taps[p.uid]);
      if (!all) return { state: { ...state, taps } };
      return {
        state: { ...state, phase: 'b', taps, ran: [...state.ran, 'b'] },
        effects: [{ type: 'TIMER', ms: TINY_B_MS }],
      };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'a') {
        return {
          state: { ...state, phase: 'b', ran: [...state.ran, 'b'] },
          effects: [{ type: 'TIMER', ms: TINY_B_MS }],
        };
      }
      if (state.phase === 'b') {
        return {
          state: { ...state, phase: 'c', ran: [...state.ran, 'c'] },
          effects: [{ type: 'TIMER', ms: TINY_C_MS }],
        };
      }
      return {
        state,
        effects: [
          {
            type: 'END',
            assignments: [{ uid: ctx.players[0].uid, sips: 1, reason: 'round over' }],
            note: 'tiny round over',
          },
        ],
      };
    }

    return { state };
  },

  // never rendered: the engine only ever calls createInitialState/reduce
  View: (() => null) as never,
};

export default tiny;
