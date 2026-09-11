import pack from '../../content/fakeit.json';
import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { pick, shuffled } from '../../engine/rng';
import { View } from './View';

const ROUNDS = 3;
const SECRET_NET_MS = 120000; // stall safety net while players check their secret
const TASK_MS = 60000;
const VOTE_MS = 45000;
const VERDICT_MS = 8000;
const CAUGHT_SIPS = 3;
const SURVIVE_SIPS = 1;

export type FkMode = 'numbers' | 'point' | 'raise';

type Pack = { name: string; emoji: string; prompts: string[] };
const PACK = pack as Record<FkMode, Pack>;

/** Move metadata shared by the reducer's prompts and the View. */
export const MODES: Record<FkMode, { name: string; emoji: string; how: string; fakerHint: string }> = {
  numbers: {
    name: 'Numbers',
    emoji: '🖐',
    how: 'everyone holds up fingers with their answer',
    fakerHint: "You won't see the question — hold up a believable number of fingers.",
  },
  point: {
    name: 'Point',
    emoji: '👉',
    how: 'everyone points at one player at the same time',
    fakerHint: "You won't know who or why — pick a player and commit.",
  },
  raise: {
    name: 'Raise a Hand',
    emoji: '✋',
    how: 'everyone raises a hand if it is true for them',
    fakerHint: "You won't see the statement — copy the group or keep your hand down.",
  },
};

export interface FkState {
  phase: 'secret' | 'task' | 'vote' | 'verdict' | 'done';
  /** 1..ROUNDS */
  roundNo: number;
  /** move order for this game, one mode per round */
  modes: FkMode[];
  mode: FkMode;
  /** the secret prompt everyone but the faker receives */
  prompt: string;
  fakerUid: string;
  /** uid → acknowledged their secret card */
  seen: Record<string, boolean>;
  /** uid → their move: numbers 0-10 · point target uid · raise 0/1 */
  answers: Record<string, number | string>;
  /** voter uid → accused uid */
  votes: Record<string, string>;
  /** filled when the round resolves; RTDB may drop the null between rounds */
  roundResult: {
    caught: boolean;
    accusedUid: string | null;
    assignments: DrinkAssignment[];
    note: string;
  } | null;
  /** roundNo → what happened, for the end-of-game summary */
  history: Record<string, { fakerUid: string; caught: boolean }>;
}

export interface FkInput {
  action: 'ready' | 'answer' | 'vote';
  /** 'answer': 0-10, a uid, or 0/1 depending on mode · 'vote': a uid */
  value?: number | string;
}

/** Pick this round's faker, preferring players who have not faked yet. */
function pickFaker(ctx: GameContext, used: string[]): string {
  const uids = ctx.players.map((p) => p.uid);
  const fresh = uids.filter((u) => !used.includes(u));
  return pick(fresh.length > 0 ? fresh : uids, ctx.rng);
}

function startRound(state: FkState, ctx: GameContext, roundNo: number): FkState {
  const mode = state.modes[roundNo - 1] ?? 'numbers';
  const used = Object.values(state.history ?? {}).map((h) => h.fakerUid);
  return {
    ...state,
    phase: 'secret',
    roundNo,
    mode,
    prompt: pick(PACK[mode].prompts, ctx.rng),
    fakerUid: pickFaker(ctx, used),
    seen: {},
    answers: {},
    votes: {},
    roundResult: null,
  };
}

/** Tally the votes: strictly-most-voted player is accused, ties accuse nobody. */
function countVotes(votes: Record<string, string>): { accusedUid: string | null } {
  const tally: Record<string, number> = {};
  for (const accused of Object.values(votes)) tally[accused] = (tally[accused] ?? 0) + 1;
  let accusedUid: string | null = null;
  let top = 0;
  let tie = false;
  for (const [uid, n] of Object.entries(tally)) {
    if (n > top) {
      top = n;
      accusedUid = uid;
      tie = false;
    } else if (n === top) {
      tie = true;
    }
  }
  return { accusedUid: tie ? null : accusedUid };
}

function resolveRound(state: FkState, ctx: GameContext): ReduceResult<FkState> {
  const faker = ctx.players.find((p) => p.uid === state.fakerUid) ?? ctx.players[0];
  const { accusedUid } = countVotes(state.votes ?? {});
  const caught = accusedUid === state.fakerUid;

  const assignments: DrinkAssignment[] = caught
    ? [{ uid: state.fakerUid, sips: CAUGHT_SIPS, reason: 'Caught red-handed 🕵️' }]
    : ctx.players
        .filter((p) => p.uid !== state.fakerUid)
        .map((p) => ({ uid: p.uid, sips: SURVIVE_SIPS, reason: 'The faker faked you out 🎭' }));

  const accused = accusedUid ? ctx.players.find((p) => p.uid === accusedUid) : null;
  const note = caught
    ? `🕵️ ${faker.name} was the faker — CAUGHT!`
    : accused
      ? `🎭 You accused ${accused.name}… but ${faker.name} was the faker!`
      : `🤝 Tie vote — nobody was accused, so ${faker.name} walks!`;

  const history = { ...(state.history ?? {}), [state.roundNo]: { fakerUid: state.fakerUid, caught } };
  const final = state.roundNo >= ROUNDS;

  // The final round's drinks ride into END so they land on the outcome
  // screen; earlier rounds pour immediately via DRINKS.
  const effects: Effect[] = [
    ...(final ? [] : [{ type: 'DRINKS', assignments } as const]),
    ...(caught
      ? Object.entries(state.votes ?? {})
          .filter(([, target]) => target === state.fakerUid)
          .map(([uid]) => ({ type: 'SCORE', uid, delta: 1 }) as const)
      : ([{ type: 'SCORE', uid: state.fakerUid, delta: 1 }] as const)),
    { type: 'TIMER', ms: VERDICT_MS },
  ];

  return {
    state: {
      ...state,
      phase: 'verdict',
      roundResult: { caught, accusedUid, assignments, note },
      history,
    },
    effects,
  };
}

function summaryNote(state: FkState, ctx: GameContext): string {
  const rounds = Object.entries(state.history ?? {}).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  const survived = rounds.filter(([, h]) => !h.caught).length;
  const headline =
    survived === 0
      ? 'Every faker was caught 🕵️'
      : survived === ROUNDS
        ? 'The fakers were never caught 🎭'
        : `Fakers survived ${survived}/${ROUNDS} rounds 🎭`;
  const fakers = rounds
    .map(([, h]) => {
      const p = ctx.players.find((x) => x.uid === h.fakerUid);
      return `${p?.name ?? '?'} (${h.caught ? 'caught' : 'survived'})`;
    })
    .join(', ');
  return `${headline} — fakers: ${fakers}`;
}

function toTask(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'task' },
    effects: [
      { type: 'CLEAR_INPUTS' },
      { type: 'TIMER', ms: TASK_MS },
    ],
  };
}

function toVote(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'vote' },
    effects: [
      { type: 'CLEAR_INPUTS' },
      { type: 'TIMER', ms: VOTE_MS },
    ],
  };
}

function validAnswer(state: FkState, uid: string, value: unknown, players: GameContext['players']): boolean {
  const isPlayerUid = (v: unknown) => typeof v === 'string' && players.some((p) => p.uid === v);
  switch (state.mode) {
    case 'numbers':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10;
    case 'point':
      return isPlayerUid(value) && value !== uid;
    case 'raise':
      return value === 0 || value === 1;
  }
}

export const definition: GameDefinition<FkState, FkInput> = {
  id: 'fakeit',
  name: 'Fake It Till You Make It',
  emoji: '🕵️',
  rules:
    'Everyone gets the same secret prompt — except one faker who gets nothing. Do the move on three, argue it out, then vote for the faker. Caught faker drinks 3; a faker who slips away makes everyone else drink 1. Three rounds: fingers, point, raise.',
  minPlayers: 3,

  createInitialState(ctx: GameContext): FkState {
    const base: FkState = {
      phase: 'secret',
      roundNo: 1,
      modes: shuffled(['numbers', 'point', 'raise'] as FkMode[], ctx.rng),
      mode: 'numbers',
      prompt: '',
      fakerUid: '',
      seen: {},
      answers: {},
      votes: {},
      roundResult: null,
      history: {},
    };
    return startRound(base, ctx, 1);
  },

  reduce(state, event: GameEvent<FkInput>, ctx: GameContext): ReduceResult<FkState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: SECRET_NET_MS }] };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (!input) return { state };

      if (input.action === 'ready' && state.phase === 'secret') {
        if ((state.seen ?? {})[event.uid]) return { state };
        const seen = { ...(state.seen ?? {}), [event.uid]: true };
        const next = { ...state, seen };
        if (Object.keys(seen).length >= ctx.players.length) return toTask(next);
        return { state: next };
      }

      if (input.action === 'answer' && state.phase === 'task') {
        if (!validAnswer(state, event.uid, input.value, ctx.players)) return { state };
        if ((state.answers ?? {})[event.uid] != null) return { state };
        const answers = { ...(state.answers ?? {}), [event.uid]: input.value as number | string };
        const next = { ...state, answers };
        if (Object.keys(answers).length >= ctx.players.length) return toVote(next);
        return { state: next };
      }

      if (input.action === 'vote' && state.phase === 'vote') {
        const target = input.value;
        if (
          typeof target !== 'string' ||
          target === event.uid ||
          !ctx.players.some((p) => p.uid === target)
        ) {
          return { state };
        }
        if ((state.votes ?? {})[event.uid]) return { state }; // first vote is locked
        const votes = { ...(state.votes ?? {}), [event.uid]: target };
        const next = { ...state, votes };
        if (Object.keys(votes).length >= ctx.players.length) return resolveRound(next, ctx);
        return { state: next };
      }

      return { state };
    }

    if (event.type === 'TIME_UP') {
      // force-advance whatever stragglers left hanging
      if (state.phase === 'secret') return toTask(state);
      if (state.phase === 'task') return toVote(state);
      if (state.phase === 'vote') return resolveRound(state, ctx);
      if (state.phase === 'verdict') {
        if (state.roundNo >= ROUNDS) {
          return {
            state: { ...state, phase: 'done' },
            effects: [
              {
                type: 'END',
                assignments: state.roundResult?.assignments ?? [],
                note: summaryNote(state, ctx),
              },
            ],
          };
        }
        return {
          state: startRound(state, ctx, state.roundNo + 1),
          effects: [
            { type: 'CLEAR_INPUTS' },
            { type: 'TIMER', ms: SECRET_NET_MS },
          ],
        };
      }
    }

    return { state };
  },

  View,
};

export const ROUNDS_COUNT = ROUNDS;
export default definition;
