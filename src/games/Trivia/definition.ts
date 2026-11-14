import pack from '../../content/trivia.json';
import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  Highlight,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

/** questions in one game of trivia */
export const ROUNDS = 5;
export const QUESTION_MS = 12000;
/** a shared phone has to travel round the whole table for every question */
const SHARED_QUESTION_MS_EACH = 12000;
export const REVEAL_MS = 5000;
/** the podium, before the drinks screen */
export const FINAL_MS = 7000;
/** the loser drinks the gap between top and bottom, kept inside these */
const MIN_SIPS = 1;
const MAX_SIPS = 5;

export interface TriviaState {
  /** the question on screen (kept as its own field so older views still read it) */
  q: Question;
  /** this game's questions, in order */
  questions: Question[];
  /** index of the question on screen */
  idx: number;
  phase: 'question' | 'reveal' | 'final';
  /** answers to the question on screen (RTDB drops the empty map — read with ?? {}) */
  answers: Record<string, { choice: number; at: number }>;
  /** correct answers so far, per uid (absent = 0) */
  scores: Record<string, number>;
  /** fastest correct answer on the question just revealed */
  fastestUid: string | null;
  /** final standings: most right hand out, fewest right drink */
  winners: string[];
  losers: string[];
  sips: number;
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface TriviaInput {
  choice: number;
}

type Question = { q: string; a: string[]; c: number };
type TopicPack = Record<string, { name: string; emoji: string; questions: Question[] }>;
const TOPIC_PACK = pack as TopicPack;

export interface TriviaTopic {
  id: string;
  name: string;
  emoji: string;
  count: number;
}

/** Topic metadata for settings UIs, in pack order. */
export const triviaTopics: TriviaTopic[] = Object.entries(TOPIC_PACK).map(([id, t]) => ({
  id,
  name: t.name,
  emoji: t.emoji,
  count: t.questions.length,
}));

/**
 * Question pool for the enabled topics. Unknown/missing selection
 * (including rooms created before topics existed) falls back to all topics.
 */
export function questionsForTopics(enabled: string[] | null | undefined): Question[] {
  const ids = (enabled ?? []).filter((id) => TOPIC_PACK[id]);
  const pool = ids.length > 0 ? ids : Object.keys(TOPIC_PACK);
  return pool.flatMap((id) => TOPIC_PACK[id].questions);
}

function questionMs(ctx: GameContext): number {
  return ctx.settings.mode === 'shared'
    ? SHARED_QUESTION_MS_EACH * Math.max(1, ctx.players.length)
    : QUESTION_MS;
}

function total(state: TriviaState): number {
  return state.questions?.length ?? 1;
}

/** Mark the question on screen and put the running scoreboard up. */
function reveal(state: TriviaState, ctx: GameContext): ReduceResult<TriviaState> {
  const question = state.q;
  const right = Object.entries(state.answers ?? {})
    .filter(([uid, ans]) => ans.choice === question.c && ctx.players.some((p) => p.uid === uid))
    .sort((x, y) => x[1].at - y[1].at);

  const scores = { ...(state.scores ?? {}) };
  for (const [uid] of right) scores[uid] = (scores[uid] ?? 0) + 1;
  const fastestUid = right.length > 0 ? right[0][0] : null;

  return {
    state: { ...state, phase: 'reveal', scores, fastestUid },
    effects: [
      { type: 'TIMER', ms: REVEAL_MS },
      ...(fastestUid ? [{ type: 'SCORE', uid: fastestUid, delta: 1 } as const] : []),
    ],
  };
}

/** After the last question: most right hands the drinks out, fewest right takes them. */
function final(state: TriviaState, ctx: GameContext): ReduceResult<TriviaState> {
  const scores = state.scores ?? {};
  const of = (uid: string) => scores[uid] ?? 0;
  const top = Math.max(...ctx.players.map((p) => of(p.uid)));
  const bottom = Math.min(...ctx.players.map((p) => of(p.uid)));
  const nameOf = (uid: string) => ctx.players.find((p) => p.uid === uid)?.name ?? '?';

  let winners: string[] = [];
  let losers: string[] = [];
  let sips = 0;
  let note: string;
  const assignments: DrinkAssignment[] = [];

  if (ctx.players.length < 2) {
    note = `${top} of ${total(state)} right`;
  } else if (top === bottom) {
    // a dead heat has no top and no bottom: nobody hands out, nobody takes
    note = top === 0 ? 'Nobody got one. Nobody drinks.' : `Dead heat at ${top} of ${total(state)}. Nobody drinks.`;
  } else {
    winners = ctx.players.filter((p) => of(p.uid) === top).map((p) => p.uid);
    losers = ctx.players.filter((p) => of(p.uid) === bottom).map((p) => p.uid);
    sips = Math.max(MIN_SIPS, Math.min(MAX_SIPS, top - bottom));
    const from = winners.map(nameOf).join(' & ');
    for (const uid of losers) {
      assignments.push({
        uid,
        sips,
        reason: `Fewest right, ${bottom} of ${total(state)}. From ${from}.`,
        // one clear winner is the one handing these out
        ...(winners.length === 1 ? { fromUid: winners[0] } : {}),
      });
    }
    note = `${from} got ${top} of ${total(state)} and hand${winners.length === 1 ? 's' : ''} out ${sips}.`;
  }

  return {
    state: { ...state, phase: 'final', winners, losers, sips, assignments, note },
    effects: [{ type: 'TIMER', ms: FINAL_MS }],
  };
}

export const definition: GameDefinition<TriviaState, TriviaInput> = {
  id: 'trivia',
  name: 'Trivia',
  emoji: '🧠',
  rules: `${ROUNDS} questions, everyone answers on their own phone. Most right hands out the drinks and fewest right takes them, one sip for every question between you. A dead heat drinks nothing.`,
  minPlayers: 1,

  createInitialState(ctx: GameContext): TriviaState {
    // draw this game's questions without repeats
    const pool = [...questionsForTopics(ctx.settings.triviaTopics)];
    const questions: Question[] = [];
    while (questions.length < ROUNDS && pool.length > 0) {
      questions.push(pool.splice(Math.floor(ctx.rng() * pool.length), 1)[0]);
    }
    return {
      q: questions[0],
      questions,
      idx: 0,
      phase: 'question',
      answers: {},
      scores: {},
      fastestUid: null,
      winners: [],
      losers: [],
      sips: 0,
      assignments: [],
      note: null,
    };
  },

  reduce(state, event: GameEvent<TriviaInput>, ctx: GameContext): ReduceResult<TriviaState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: questionMs(ctx) }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase !== 'question' || event.input == null) return { state };
      if ((state.answers ?? {})[event.uid]) return { state }; // one answer per player
      const choice = Number(event.input.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice >= state.q.a.length) return { state };
      const answers = { ...(state.answers ?? {}), [event.uid]: { choice, at: ctx.now } };
      const next: TriviaState = { ...state, answers };
      if (Object.keys(answers).length >= ctx.players.length) return reveal(next, ctx);
      return { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'question') return reveal(state, ctx);
      if (state.phase === 'reveal') {
        const idx = (state.idx ?? 0) + 1;
        if (idx >= total(state)) return final(state, ctx);
        return {
          state: { ...state, phase: 'question', idx, q: state.questions[idx], answers: {}, fastestUid: null },
          effects: [{ type: 'TIMER', ms: questionMs(ctx) }],
        };
      }
      if (state.phase === 'final') {
        const winners = state.winners ?? [];
        const losers = state.losers ?? [];
        // a lone blank sheet or a lone full house is worth a line
        const highlights: Highlight[] = [];
        if (ctx.players.length >= 2) {
          const scores = state.scores ?? {};
          const zero = ctx.players.filter((p) => (scores[p.uid] ?? 0) === 0);
          const sweep = ctx.players.filter((p) => (scores[p.uid] ?? 0) >= total(state));
          if (zero.length === 1) highlights.push({ kind: 'trivia-zero', uid: zero[0].uid });
          if (sweep.length === 1) highlights.push({ kind: 'trivia-sweep', uid: sweep[0].uid });
        }
        return {
          state,
          effects: [
            {
              type: 'END',
              assignments: state.assignments ?? [],
              note: state.note,
              highlights,
              recap:
                winners.length > 0
                  ? {
                      title: 'Final scores',
                      groups: [
                        { label: 'Most right, hands out', tone: 'good', uids: winners },
                        { label: `Fewest right, drinks ${state.sips}`, tone: 'bad', uids: losers },
                      ],
                    }
                  : undefined,
            },
          ],
        };
      }
    }

    return { state };
  },

  View,
};

export default definition;
