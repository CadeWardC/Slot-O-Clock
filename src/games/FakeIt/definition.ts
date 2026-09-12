/**
 * ============================================================
 *  FAKE IT TILL YOU MAKE IT — one liar, three rounds, no mercy
 * ============================================================
 * ONE player is the faker for the WHOLE game, and the table plays
 * ONE move type (fingers / point / raise) for all three rounds.
 *
 * The prompt is public: everyone — the faker included — sees it.
 * The faker isn't improvising blind, they are lying with exactly
 * the information everybody else has, which is why every round has
 * a long ARGUE phase with the clock running before the ballot.
 *
 * An accusation only lands if the ballot is UNANIMOUS across every
 * honest player: one doubter, one abstention, one vote for the wrong
 * person and the faker walks. The faker still gets a ballot screen
 * (so nobody can spot them by who did or didn't vote), but that
 * ballot is a DECOY — it is left out of the tally and can never
 * break the group's unanimity. The faker wins by talking, not by
 * paperwork.
 *
 * Nobody can vote for themselves, so unanimity can only ever land on
 * the faker — which means telling the table "you were unanimous"
 * would hand them the identity in round one and turn rounds 2 and 3
 * into a formality. So the verdict reveals NOTHING: the tally is
 * sealed, no drinks are poured mid-game, and only the unmask screen
 * settles all three rounds at once.
 */

import pack from '../../content/fakeit.json';
import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { pick } from '../../engine/rng';
import { View } from './View';

export const ROUNDS_COUNT = 3;
/** read the public prompt + privately learn your role */
const BRIEF_MS = 45_000;
/** lock your move in */
const TASK_MS = 60_000;
/** the phase that decides everything — argue, bluster, interrogate */
export const ARGUE_MS = 120_000;
/** secret ballot; unanimity is required for an accusation to land */
export const VOTE_MS = 60_000;
/** the sealed round result */
const VERDICT_MS = 10_000;
/** the unmasking */
const UNMASK_MS = 25_000;
/** the faker drinks this for every round the table nailed them */
export const CAUGHT_SIPS = 3;
/** everyone else drinks this for every round the faker got away */
export const FOOLED_SIPS = 1;

export type FkMode = 'numbers' | 'point' | 'raise';
export type FkPhase = 'brief' | 'task' | 'argue' | 'vote' | 'verdict' | 'unmask' | 'done';

type Pack = { name: string; emoji: string; prompts: string[] };
const PACK = pack as Record<FkMode, Pack>;

/** Move metadata shared by the reducer's prompts and the View. */
export const MODES: Record<FkMode, { name: string; emoji: string; how: string; fakerHint: string }> = {
  numbers: {
    name: 'Numbers',
    emoji: '🖐',
    how: 'everyone holds up fingers with their answer',
    fakerHint: 'Pick a number you can defend out loud — you have to remember it all game.',
  },
  point: {
    name: 'Point',
    emoji: '👉',
    how: 'everyone points at one player at the same time',
    fakerHint: 'Point at whoever you can justify — then justify it hard.',
  },
  raise: {
    name: 'Raise a Hand',
    emoji: '✋',
    how: 'everyone raises a hand if it is true for them',
    fakerHint: "You know the statement, so don't overthink it — just don't oversell it.",
  },
};

/** One round, fully resolved. Only the unmask screen ever renders any of it. */
export interface FkRoundRecord {
  roundNo: number;
  prompt: string;
  /** the player every honest ballot named (null = the ballot wasn't unanimous) */
  accusedUid: string | null;
  unanimous: boolean;
  /** true when that unanimous accusation actually landed on the faker */
  hit: boolean;
  /** voter uid → the player they named — the faker's decoy vote included */
  votes: Record<string, string>;
}

export interface FkState {
  phase: FkPhase;
  /** 1..ROUNDS_COUNT */
  roundNo: number;
  /** the ONE move type played for all three rounds */
  mode: FkMode;
  /** this round's prompt — public on every screen; the faker knows it too */
  prompt: string;
  usedPrompts: string[];
  /** the ONE faker for the entire game */
  fakerUid: string;
  /** uid → acknowledged their private role card */
  seen: Record<string, boolean>;
  /** uid → their move: numbers 0-10 · point target uid · raise 0/1 */
  answers: Record<string, number | string>;
  /** uid → finished arguing, ready for the ballot */
  argued: Record<string, boolean>;
  /** voter uid → the player they named (the faker's ballot is a decoy) */
  votes: Record<string, string>;
  /** roundNo → the whole truth, rendered only on the unmask screen */
  history: Record<string, FkRoundRecord>;
}

export type FkInput =
  /** brief: I've read the prompt and know my role · argue: we've said enough */
  | { action: 'ready' }
  /** task: 0-10, a player uid, or 0/1 depending on the mode */
  | { action: 'answer'; value: number | string }
  /** vote: the uid being accused */
  | { action: 'vote'; value: string };

function nextPrompt(state: FkState, ctx: GameContext): string {
  const prompts = PACK[state.mode]?.prompts ?? PACK.numbers.prompts;
  const fresh = prompts.filter((p) => !(state.usedPrompts ?? []).includes(p));
  return pick(fresh.length > 0 ? fresh : prompts, ctx.rng);
}

function roundsOf(state: FkState): FkRoundRecord[] {
  return Object.values(state.history ?? {}).sort((a, b) => a.roundNo - b.roundNo);
}

function toTask(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'task' },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: TASK_MS }],
  };
}

function toArgue(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'argue' },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: ARGUE_MS }],
  };
}

function toVote(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'vote' },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: VOTE_MS }],
  };
}

function toUnmask(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'unmask' },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: UNMASK_MS }],
  };
}

/** Rounds 2 and 3: same faker, same move, a brand new prompt. */
function startRound(state: FkState, ctx: GameContext): ReduceResult<FkState> {
  const prompt = nextPrompt(state, ctx);
  return {
    state: {
      ...state,
      phase: 'brief',
      roundNo: state.roundNo + 1,
      prompt,
      usedPrompts: [...(state.usedPrompts ?? []), prompt],
      seen: {},
      answers: {},
      argued: {},
      votes: {},
    },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: BRIEF_MS }],
  };
}

/**
 * The group's decision, sealed. Somebody is accused only when EVERY
 * honest ballot named them — and the faker's own ballot is not part of
 * that count, so it can't be used to break unanimity. The result is
 * written to `history` for the unmask and is deliberately rendered
 * NOWHERE: the table must not learn whether their accusation landed
 * until all three rounds are done.
 */
function resolveRound(state: FkState, ctx: GameContext): ReduceResult<FkState> {
  const votes = state.votes ?? {};
  const honest = ctx.players.filter((p) => p.uid !== state.fakerUid);
  const targets = honest
    .map((p) => votes[p.uid])
    .filter((t): t is string => typeof t === 'string');
  const unanimous =
    honest.length > 0 && targets.length === honest.length && targets.every((t) => t === targets[0]);
  const accusedUid = unanimous ? targets[0] : null;
  // nobody can vote for themselves, so a unanimous ballot can only ever
  // land on the faker — the check stays explicit anyway
  const hit = unanimous && accusedUid === state.fakerUid;

  const record: FkRoundRecord = {
    roundNo: state.roundNo,
    prompt: state.prompt,
    accusedUid,
    unanimous,
    hit,
    votes,
  };

  return {
    state: {
      ...state,
      phase: 'verdict',
      history: { ...(state.history ?? {}), [state.roundNo]: record },
    },
    effects: [{ type: 'TIMER', ms: VERDICT_MS }],
  };
}

/** The whole tab lands at once — first time the truth is public. */
function finish(state: FkState, ctx: GameContext): ReduceResult<FkState> {
  const rounds = roundsOf(state);
  const hits = rounds.filter((r) => r.hit).length;
  const misses = rounds.length - hits;
  const faker = ctx.players.find((p) => p.uid === state.fakerUid);

  const assignments: DrinkAssignment[] = [];
  if (hits > 0) {
    assignments.push({
      uid: state.fakerUid,
      sips: hits * CAUGHT_SIPS,
      reason: hits >= ROUNDS_COUNT ? 'Caught all three rounds 🕵️' : `Caught ${hits}× 🕵️`,
    });
  }
  if (misses > 0) {
    for (const p of ctx.players) {
      if (p.uid === state.fakerUid) continue;
      assignments.push({ uid: p.uid, sips: misses * FOOLED_SIPS, reason: `Faked you out ${misses}× 🎭` });
    }
  }

  const effects: Effect[] = [];
  for (const r of rounds) {
    if (r.hit) {
      for (const p of ctx.players) {
        if (p.uid !== state.fakerUid) effects.push({ type: 'SCORE', uid: p.uid, delta: 1 });
      }
    } else {
      effects.push({ type: 'SCORE', uid: state.fakerUid, delta: 1 });
    }
  }
  effects.push({
    type: 'END',
    assignments,
    note: `${faker?.name ?? 'The faker'} was the faker all game — caught ${hits}/${rounds.length} rounds`,
  });

  return { state: { ...state, phase: 'done' }, effects };
}

function validAnswer(
  state: FkState,
  uid: string,
  value: unknown,
  players: GameContext['players'],
): boolean {
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
    'ONE faker, secret for the whole game — and the prompt is PUBLIC, so the faker reads exactly what you read and has to lie about it. Three rounds, one move type all game: make the move, argue it out, then vote. An accusation only lands if every honest vote agrees (the faker\'s own ballot never counts), and the tally stays sealed until the final unmask — where all three rounds settle at once.',
  minPlayers: 3,

  createInitialState(ctx: GameContext): FkState {
    const mode = pick(['numbers', 'point', 'raise'] as FkMode[], ctx.rng);
    const base: FkState = {
      phase: 'brief',
      roundNo: 1,
      mode,
      prompt: '',
      usedPrompts: [],
      fakerUid: pick(ctx.players, ctx.rng).uid,
      seen: {},
      answers: {},
      argued: {},
      votes: {},
      history: {},
    };
    const prompt = nextPrompt(base, ctx);
    return { ...base, prompt, usedPrompts: [prompt] };
  },

  reduce(state, event: GameEvent<FkInput>, ctx: GameContext): ReduceResult<FkState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: BRIEF_MS }] };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (!input) return { state };

      if (input.action === 'ready') {
        if (state.phase === 'brief') {
          if ((state.seen ?? {})[event.uid]) return { state };
          const seen = { ...(state.seen ?? {}), [event.uid]: true };
          const next = { ...state, seen };
          return Object.keys(seen).length >= ctx.players.length ? toTask(next) : { state: next };
        }

        if (state.phase === 'argue') {
          // shared phone: whoever is holding it calls the table to the ballot
          if (ctx.settings.mode === 'shared') return toVote(state);
          if ((state.argued ?? {})[event.uid]) return { state };
          const argued = { ...(state.argued ?? {}), [event.uid]: true };
          const next = { ...state, argued };
          return Object.keys(argued).length >= ctx.players.length ? toVote(next) : { state: next };
        }

        return { state };
      }

      if (input.action === 'answer') {
        if (state.phase !== 'task') return { state };
        if (!validAnswer(state, event.uid, input.value, ctx.players)) return { state };
        if ((state.answers ?? {})[event.uid] != null) return { state }; // one move, locked
        const answers = { ...(state.answers ?? {}), [event.uid]: input.value };
        const next = { ...state, answers };
        return Object.keys(answers).length >= ctx.players.length ? toArgue(next) : { state: next };
      }

      if (input.action === 'vote') {
        if (state.phase !== 'vote') return { state };
        const target = input.value;
        if (typeof target !== 'string' || target === event.uid) return { state };
        if (!ctx.players.some((p) => p.uid === target)) return { state };
        if ((state.votes ?? {})[event.uid]) return { state }; // first ballot is locked
        const votes = { ...(state.votes ?? {}), [event.uid]: target };
        const next = { ...state, votes };
        return Object.keys(votes).length >= ctx.players.length ? resolveRound(next, ctx) : { state: next };
      }

      return { state };
    }

    if (event.type === 'TIME_UP') {
      // force-advance whatever stragglers left hanging
      // ('secret' = a room that was mid-game when this build landed — fold it into task)
      if (state.phase === 'brief' || (state.phase as string) === 'secret') return toTask(state);
      if (state.phase === 'task') return toArgue(state);
      if (state.phase === 'argue') return toVote(state);
      if (state.phase === 'vote') return resolveRound(state, ctx);
      if (state.phase === 'verdict') {
        return state.roundNo >= ROUNDS_COUNT ? toUnmask(state) : startRound(state, ctx);
      }
      if (state.phase === 'unmask') return finish(state, ctx);
    }

    return { state };
  },

  View,
};

export default definition;
