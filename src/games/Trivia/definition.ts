import pack from '../../content/trivia.json';
import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

const QUESTION_MS = 12000;
const REVEAL_MS = 4500;

export interface TriviaState {
  q: Question;
  phase: 'question' | 'reveal';
  answers: Record<string, { choice: number; at: number }>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface TriviaInput {
  choice: number;
}

type Question = { q: string; a: string[]; c: number };
const QUESTIONS = pack as Question[];

function reveal(state: TriviaState, ctx: GameContext): ReduceResult<TriviaState> {
  const question = state.q;
  const entries = Object.entries(state.answers ?? {}).sort((x, y) => x[1].at - y[1].at);
  const wrong = entries.filter(([, ans]) => ans.choice !== question.c);
  const right = entries.filter(([, ans]) => ans.choice === question.c);

  const assignments: DrinkAssignment[] = wrong.map(([uid]) => ({
    uid,
    sips: 1,
    reason: 'Wrong answer ❌',
  }));

  let note: string;
  if (right.length === 0) {
    note = 'Nobody got it! 🤯';
  } else if (wrong.length === 0 && right.length >= ctx.players.length) {
    note = 'Everyone got it — nobody drinks! 🎓';
    assignments.length = 0;
  } else {
    const fastestUid = right[0][0];
    const who = ctx.players.find((p) => p.uid === fastestUid);
    note = `🎓 Fastest correct: ${who?.name ?? '?'}`;
  }

  return {
    state: { ...state, phase: 'reveal', assignments, note },
    effects: [
      { type: 'TIMER', ms: REVEAL_MS },
      ...(right.length > 0 ? [{ type: 'SCORE', uid: right[0][0], delta: 1 } as const] : []),
    ],
  };
}

export const definition: GameDefinition<TriviaState, TriviaInput> = {
  id: 'trivia',
  name: 'Booze Trivia',
  emoji: '🧠',
  rules: 'A question appears — everyone answers on their phone. Wrong answers drink 1. Fastest correct answer scores.',
  minPlayers: 1,

  createInitialState(ctx: GameContext): TriviaState {
    return {
      q: QUESTIONS[Math.floor(ctx.rng() * QUESTIONS.length)],
      phase: 'question',
      answers: {},
      assignments: [],
      note: null,
    };
  },

  reduce(state, event: GameEvent<TriviaInput>, ctx: GameContext): ReduceResult<TriviaState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: QUESTION_MS }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase !== 'question' || event.input == null) return { state };
      if ((state.answers ?? {})[event.uid]) return { state }; // one answer per player
      const answers = {
        ...(state.answers ?? {}),
        [event.uid]: { choice: event.input.choice, at: ctx.now },
      };
      const next: TriviaState = { ...state, answers };
      if (Object.keys(answers).length >= ctx.players.length) return reveal(next, ctx);
      return { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'question') return reveal(state, ctx);
      if (state.phase === 'reveal') {
        return { state, effects: [{ type: 'END', assignments: state.assignments, note: state.note }] };
      }
    }

    return { state };
  },

  View,
};

export default definition;
