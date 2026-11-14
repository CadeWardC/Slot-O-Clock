import pack from '../../content/knowme.json';
import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  Highlight,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

/**
 * ============================================================
 *  Know Me 🫵 — how well does the table know the hot seat?
 * ============================================================
 * The turn actor sits in the hot seat for four this-or-that questions about
 * themselves. Each question they answer for real, in private, while everyone
 * else predicts what they will say. Nothing shows until every pick is in (or
 * the clock runs out); then the answer is turned over and the table gets to
 * argue about it, which is the point of the game.
 *
 * Phases, per question:  answer → reveal  (×4), then END.
 *
 * Scoring: a predictor's score is how many they called. Fewest right drinks
 * one per miss (capped). A question nobody called costs the hot seat a drink.
 * The single best predictor hands out drinks through the engine's own
 * hand-out stage (`givers` on END).
 */

export const ROUNDS = 4;
export const ANSWER_MS = 20_000;
/** a shared phone has to go round the whole table for every question */
export const SHARED_ANSWER_MS_EACH = 15_000;
export const REVEAL_MS = 6_000;
/** the most a bad predictor drinks, however badly it went */
const MAX_MISS_SIPS = 3;
/** what the best predictor gets to hand out, and the score it takes */
const GIVER_SIPS = 2;
const GIVER_MIN_RIGHT = 3;

export interface KmQuestion {
  /** a stem that reads after a name: "Would rather", "First move at a party" */
  q: string;
  a: string;
  b: string;
}

const QUESTIONS = (pack as { questions: KmQuestion[] }).questions;

/** one turned-over question, kept so the reveal can be drawn from state alone */
export interface KmReveal {
  /** what the hot seat said: 0 = a, 1 = b */
  truth: 0 | 1;
  /** the hot seat never answered and the app picked for them */
  froze: boolean;
  /** predictors who called it (RTDB drops an empty list: read with ?? []) */
  right: string[];
  /** predictors who never picked at all */
  silent: string[];
}

export interface KmState {
  phase: 'answer' | 'reveal';
  /** the player the questions are about */
  seatUid: string;
  questions: KmQuestion[];
  idx: number;
  /**
   * This question's picks, hot seat included. Private until the reveal: a view
   * may only ever read its own entry while the phase is 'answer'.
   */
  picks: Record<string, 0 | 1>;
  /** the question just turned over (reveal phase only) */
  reveal: KmReveal | null;
  /** questions called so far, per predictor (absent = 0) */
  scores: Record<string, number>;
  /** questions nobody called: one drink each for the hot seat */
  seatSips: number;
}

export interface KmInput {
  pick: 0 | 1;
}

function answerMs(ctx: GameContext): number {
  return ctx.settings.mode === 'shared'
    ? SHARED_ANSWER_MS_EACH * Math.max(1, ctx.players.length)
    : ANSWER_MS;
}

function total(state: KmState): number {
  return state.questions?.length ?? ROUNDS;
}

function predictorsOf(state: KmState, ctx: GameContext) {
  return ctx.players.filter((p) => p.uid !== state.seatUid);
}

/** Turn the question over: fix the hot seat's answer and mark every prediction. */
function reveal(state: KmState, ctx: GameContext): ReduceResult<KmState> {
  const picks = state.picks ?? {};
  const own = picks[state.seatUid];
  const froze = own !== 0 && own !== 1;
  const truth: 0 | 1 = froze ? (ctx.rng() < 0.5 ? 0 : 1) : own;
  const predictors = predictorsOf(state, ctx);
  const right = predictors.filter((p) => picks[p.uid] === truth).map((p) => p.uid);
  const silent = predictors.filter((p) => picks[p.uid] !== 0 && picks[p.uid] !== 1).map((p) => p.uid);
  const scores = { ...(state.scores ?? {}) };
  for (const uid of right) scores[uid] = (scores[uid] ?? 0) + 1;
  // a question the whole table got wrong is on the hot seat: nobody knows you
  const nobody = predictors.length > 0 && right.length === 0;
  return {
    state: {
      ...state,
      phase: 'reveal',
      reveal: { truth, froze, right, silent },
      scores,
      seatSips: (state.seatSips ?? 0) + (nobody ? 1 : 0),
    },
    effects: [{ type: 'TIMER', ms: REVEAL_MS }],
  };
}

function finish(state: KmState, ctx: GameContext): ReduceResult<KmState> {
  const n = total(state);
  const scores = state.scores ?? {};
  const predictors = predictorsOf(state, ctx);
  const seat = ctx.players.find((p) => p.uid === state.seatUid);
  const seatName = seat?.name ?? 'them';
  const scoreOf = (uid: string) => scores[uid] ?? 0;
  const assignments: DrinkAssignment[] = [];

  const low = predictors.length > 0 ? Math.min(...predictors.map((p) => scoreOf(p.uid))) : 0;
  const high = predictors.length > 0 ? Math.max(...predictors.map((p) => scoreOf(p.uid))) : 0;
  const worst = predictors.filter((p) => scoreOf(p.uid) === low);
  const best = predictors.filter((p) => scoreOf(p.uid) === high);

  const missSips = Math.min(MAX_MISS_SIPS, n - low);
  if (missSips > 0) {
    for (const p of worst) {
      assignments.push({ uid: p.uid, sips: missSips, reason: `Called ${low} of ${n} about ${seatName}` });
    }
  }
  const seatSips = state.seatSips ?? 0;
  if (seatSips > 0 && seat) {
    assignments.push({
      uid: seat.uid,
      sips: seatSips,
      reason: seatSips === 1 ? 'Nobody saw one answer coming' : `Nobody saw ${seatSips} answers coming`,
    });
  }

  const soleBest = best.length === 1 && predictors.length > 1 ? best[0] : null;
  const soleWorst = worst.length === 1 && predictors.length > 1 ? worst[0] : null;
  const givers =
    soleBest && high >= GIVER_MIN_RIGHT
      ? [{ uid: soleBest.uid, sips: GIVER_SIPS, why: 'Knows them best' }]
      : undefined;

  const highlights: Highlight[] = [];
  if (predictors.length > 0 && low >= n) {
    highlights.push({ kind: 'know-open-book', uid: state.seatUid });
  } else if (ctx.players.length >= 3 && high <= 1) {
    highlights.push({ kind: 'know-mystery', uid: state.seatUid });
  }
  if (soleBest && high >= n) {
    highlights.push({ kind: 'know-best', uid: soleBest.uid, n: high, text: seatName });
  }
  if (soleWorst && low <= 1 && highlights.length < 2) {
    highlights.push({ kind: 'know-stranger', uid: soleWorst.uid, n: low, text: seatName });
  }

  const note =
    predictors.length > 0 && low >= n
      ? `Everyone called all ${n}. ${seatName} is an open book.`
      : soleBest
        ? `${soleBest.name} knows ${seatName} best: ${high} of ${n}.`
        : `Best anyone managed on ${seatName} was ${high} of ${n}.`;

  return {
    state,
    effects: [
      {
        type: 'END',
        assignments,
        note,
        highlights: highlights.slice(0, 2),
        givers,
        recap: {
          title: `Who knows ${seatName}`,
          groups: [
            { label: `Knows them best, ${high} of ${n}`, tone: 'good', uids: best.map((p) => p.uid) },
            {
              label: missSips > 0 ? `Knows them least, ${low} of ${n}` : 'Also got them all',
              tone: missSips > 0 ? 'bad' : 'neutral',
              uids: worst.filter((p) => !best.includes(p)).map((p) => p.uid),
            },
          ],
        },
      },
    ],
  };
}

export const definition: GameDefinition<KmState, KmInput> = {
  id: 'know-me',
  name: 'Know Me',
  emoji: '🫵',
  rules: `One of you is in the hot seat for ${ROUNDS} this-or-that questions. They answer for real while everyone else guesses what they will say. Know them least and you drink; know them best and you hand drinks out. If nobody sees an answer coming, the hot seat drinks.`,
  minPlayers: 3,
  sharedInput: 'all',

  /**
   * Shared phone: it goes to whoever has not picked yet, and the hot seat
   * holds it for the reveal, so no "pass the phone" lands on top of it.
   */
  sharedHolderUid(state, { players }) {
    if (state.phase === 'answer') {
      const picks = state.picks ?? {};
      const next = players.find((p) => picks[p.uid] !== 0 && picks[p.uid] !== 1);
      if (next) return next.uid;
    }
    return players.some((p) => p.uid === state.seatUid) ? state.seatUid : (players[0]?.uid ?? null);
  },

  createInitialState(ctx: GameContext): KmState {
    const seat =
      ctx.players.find((p) => p.uid === ctx.actorUid) ?? ctx.players[0];
    // draw this game's questions without repeats
    const pool = [...QUESTIONS];
    const questions: KmQuestion[] = [];
    while (questions.length < ROUNDS && pool.length > 0) {
      questions.push(pool.splice(Math.floor(ctx.rng() * pool.length) % pool.length, 1)[0]);
    }
    return {
      phase: 'answer',
      seatUid: seat?.uid ?? '',
      questions,
      idx: 0,
      picks: {},
      reveal: null,
      scores: {},
      seatSips: 0,
    };
  },

  reduce(state, event: GameEvent<KmInput>, ctx: GameContext): ReduceResult<KmState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: answerMs(ctx) }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase !== 'answer' || event.input == null) return { state };
      const pick = event.input.pick;
      if (pick !== 0 && pick !== 1) return { state };
      if (!ctx.players.some((p) => p.uid === event.uid)) return { state };
      const picks = state.picks ?? {};
      if (picks[event.uid] === 0 || picks[event.uid] === 1) return { state }; // one pick each
      const next: KmState = { ...state, picks: { ...picks, [event.uid]: pick } };
      const allIn = ctx.players.every((p) => next.picks[p.uid] === 0 || next.picks[p.uid] === 1);
      return allIn ? reveal(next, ctx) : { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'answer') return reveal(state, ctx);
      if (state.phase === 'reveal') {
        const idx = (state.idx ?? 0) + 1;
        if (idx >= total(state)) return finish(state, ctx);
        return {
          state: { ...state, phase: 'answer', idx, picks: {}, reveal: null },
          // a fresh input stage, so the shared-phone gate starts round again
          effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: answerMs(ctx) }],
        };
      }
    }

    return { state };
  },

  View,
};

export default definition;
