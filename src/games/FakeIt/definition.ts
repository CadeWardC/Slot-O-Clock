/**
 * ============================================================
 *  FAKE IT TILL YOU MAKE IT — one liar, up to three blind moves
 * ============================================================
 * ONE player is the faker for the WHOLE game, and they never get
 * the prompt. Each round opens on a private card: everybody else
 * reads the prompt, the faker is only told WHICH MOVE the table is
 * playing (fingers 🖐 / point 👉 / raise ✋) and told to blend in.
 *
 * The move itself is made with the body, never in the app. The
 * phones show a 5-second countdown and nothing else, the whole
 * table moves together at zero, and only THEN does the prompt go
 * public — faker included — so the table can argue about the moves
 * it just watched.
 *
 * Then the group votes, and nothing is on a clock: every player
 * picks a suspect and LOCKS IT IN. Ballots stay sealed until the
 * last one is locked, then they all flip at once. A player is
 * convicted when EVERYONE ELSE named them — players minus one,
 * because nobody can vote for themselves.
 *
 *   - convicted the faker  → CAUGHT: the table is told on the spot,
 *     the faker drinks, and the game ends right there.
 *   - split ballot         → the faker got away with this round.
 *   - convicted an innocent→ the table is told they were innocent,
 *     and the faker got away with this round.
 *
 * A getaway never says WHO the faker is, so the drinks for it (one
 * each for everybody who isn't the faker) can't be handed out
 * mid-game without unmasking them: they ride on the tab and land
 * with the outcome. Survive every round and the faker is unmasked
 * as the one who got away.
 *
 * (The prompt rides along in the broadcast state like every other
 * secret in this codebase: the View hides it during the brief and
 * the countdown, devtools doesn't. Same contract as `fakerUid` and
 * the sealed `votes`.)
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
/** private card: read your prompt (or your cover story) and hide it */
export const BRIEF_MS = 60_000;
/** the blind move: countdown only, everybody moves with their body */
export const GESTURE_MS = 5_000;
/** prompt goes public — argue about the moves you just saw */
export const REVEAL_MS = 120_000;
/** the ballots flip and the round's verdict is read out */
export const VERDICT_MS = 11_000;
/** CAUGHT! — the table gets a moment to enjoy it before the drinks */
export const CAUGHT_MS = 9_000;
/** the unmasking of a faker nobody caught */
export const UNMASK_MS = 14_000;
/** the faker drinks this when the table catches them */
export const CAUGHT_SIPS = 3;
/** everyone else drinks this for every round the faker got away */
export const FOOLED_SIPS = 1;

export type FkMode = 'numbers' | 'point' | 'raise';
export type FkPhase = 'brief' | 'gesture' | 'reveal' | 'vote' | 'verdict' | 'unmask' | 'done';
/** how a round's ballot came out */
export type FkResult = 'caught' | 'innocent' | 'split';

type Pack = { name: string; emoji: string; prompts: string[] };
const PACK = pack as Record<FkMode, Pack>;

/** Move metadata shared by the reducer's prompts, the View and the faker's card. */
export const MODES: Record<
  FkMode,
  { name: string; emoji: string; how: string; move: string; fakerHint: string }
> = {
  numbers: {
    name: 'Fingers',
    emoji: '🖐',
    how: 'everyone holds up fingers with their answer',
    move: 'hold up your fingers',
    fakerHint: 'Pick a number that could be a real answer. You will have to defend it.',
  },
  point: {
    name: 'Point',
    emoji: '👉',
    how: 'everyone points at one player at the same time',
    move: 'point at one player',
    fakerHint: 'Point at someone you can make a case for.',
  },
  raise: {
    name: 'Raise a Hand',
    emoji: '✋',
    how: 'everyone raises a hand if the statement is true for them',
    move: 'raise a hand if it is true for you',
    fakerHint: 'Watch the hands around you and go with the room.',
  },
};

/** One round, fully resolved. */
export interface FkRoundRecord {
  roundNo: number;
  prompt: string;
  /** the player everyone else named (null = no player got players−1 votes) */
  accusedUid: string | null;
  result: FkResult;
  /** voter uid → the player they named */
  votes: Record<string, string>;
}

export interface FkState {
  phase: FkPhase;
  /** 1..ROUNDS_COUNT */
  roundNo: number;
  /** the ONE move type played for all three rounds */
  mode: FkMode;
  /** this round's prompt — hidden on screen until `reveal`, and never shown to the faker's card */
  prompt: string;
  usedPrompts: string[];
  /** the ONE faker for the entire game */
  fakerUid: string;
  /** brief: uid → has read their private card */
  seen: Record<string, boolean>;
  /** reveal: uid → has said their piece and is ready for the ballot */
  argued: Record<string, boolean>;
  /** voter uid → the player they LOCKED IN. Sealed on screen until the verdict. */
  votes: Record<string, string>;
  /** the last player to tap — on a shared phone they keep holding it through the hands-off screens */
  lastUid?: string | null;
  /** roundNo → how each round came out */
  history: Record<string, FkRoundRecord>;
}

export type FkInput =
  /** brief: I've read my card · reveal: we've said enough, open the ballot */
  | { action: 'ready' }
  /** vote: lock in the player you're naming — final, there is no switching a locked ballot */
  | { action: 'vote'; value: string };

/** votes on one player that convict them: everybody but the accused */
export function votesNeeded(playerCount: number): number {
  return Math.max(1, playerCount - 1);
}

/**
 * The table's decision: the player that everyone else named, or null.
 * Players minus one — the accused can't vote for themselves, so that IS
 * unanimous. At most one player can ever reach it.
 */
export function convictedUid(
  votes: Record<string, string> | undefined,
  uids: readonly string[],
): string | null {
  const need = votesNeeded(uids.length);
  if (uids.length < 2) return null;
  for (const target of uids) {
    const n = uids.filter((voter) => voter !== target && (votes ?? {})[voter] === target).length;
    if (n >= need) return target;
  }
  return null;
}

const PHASES: Record<FkPhase, true> = {
  brief: true,
  gesture: true,
  reveal: true,
  vote: true,
  verdict: true,
  unmask: true,
  done: true,
};

/**
 * A room that was mid-round on a build before this one (or a phase we no
 * longer know): fold it into a fresh private card. The prompt, the mode
 * and the faker all survive, so nothing is lost beyond the round in play.
 */
function recover(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'brief', seen: {}, argued: {}, votes: {} },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: BRIEF_MS }],
  };
}

function nextPrompt(state: FkState, ctx: GameContext): string {
  const prompts = PACK[state.mode]?.prompts ?? PACK.numbers.prompts;
  const fresh = prompts.filter((p) => !(state.usedPrompts ?? []).includes(p));
  return pick(fresh.length > 0 ? fresh : prompts, ctx.rng);
}

export function roundsOf(state: FkState): FkRoundRecord[] {
  return Object.values(state.history ?? {})
    .filter((r): r is FkRoundRecord => !!r)
    .sort((a, b) => a.roundNo - b.roundNo);
}

function toGesture(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'gesture' },
    effects: [{ type: 'TIMER', ms: GESTURE_MS }],
  };
}

function toReveal(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'reveal' },
    effects: [{ type: 'TIMER', ms: REVEAL_MS }],
  };
}

/** The ballot is deliberately NOT on a clock: it closes when the last player locks in. */
function toVote(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'vote', argued: {}, votes: {} },
    effects: [{ type: 'CLEAR_INPUTS' }],
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
      argued: {},
      votes: {},
    },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: BRIEF_MS }],
  };
}

/**
 * Every ballot is locked: flip them. A player is convicted when everyone
 * else named them. Catching the faker is announced right here and ends the
 * game; anything else is a getaway and the game goes on.
 */
function resolveRound(state: FkState, ctx: GameContext): ReduceResult<FkState> {
  const votes = state.votes ?? {};
  const accusedUid = convictedUid(
    votes,
    ctx.players.map((p) => p.uid),
  );
  const result: FkResult =
    accusedUid == null ? 'split' : accusedUid === state.fakerUid ? 'caught' : 'innocent';
  const record: FkRoundRecord = {
    roundNo: state.roundNo,
    prompt: state.prompt,
    accusedUid,
    result,
    votes,
  };

  return {
    state: {
      ...state,
      phase: 'verdict',
      history: { ...(state.history ?? {}), [state.roundNo]: record },
    },
    effects: [{ type: 'TIMER', ms: result === 'caught' ? CAUGHT_MS : VERDICT_MS }],
  };
}

/** The tab: the faker pays for being caught, the table pays for every getaway. */
function finish(state: FkState, ctx: GameContext): ReduceResult<FkState> {
  const rounds = roundsOf(state);
  const caught = rounds.some((r) => r.result === 'caught');
  const getaways = rounds.filter((r) => r.result !== 'caught').length;
  const faker = ctx.players.find((p) => p.uid === state.fakerUid);
  const clean = ctx.players.filter((p) => p.uid !== state.fakerUid);

  const assignments: DrinkAssignment[] = [];
  if (caught) {
    assignments.push({ uid: state.fakerUid, sips: CAUGHT_SIPS, reason: 'Caught faking it' });
  }
  if (getaways > 0) {
    for (const p of clean) {
      assignments.push({
        uid: p.uid,
        sips: getaways * FOOLED_SIPS,
        reason: getaways === 1 ? 'Fooled for a round' : `Fooled for ${getaways} rounds`,
      });
    }
  }

  const effects: Effect[] = [];
  if (caught) {
    for (const p of clean) effects.push({ type: 'SCORE', uid: p.uid, delta: 1 });
  }
  for (let i = 0; i < getaways; i++) effects.push({ type: 'SCORE', uid: state.fakerUid, delta: 1 });

  const name = faker?.name ?? 'The faker';
  effects.push({
    type: 'END',
    assignments,
    note: caught
      ? `${name} was the faker. Caught in round ${rounds.length}.`
      : `${name} was the faker. Nobody caught them.`,
    recap: {
      title: caught ? 'Caught' : 'Got away',
      groups: [
        { label: caught ? 'The faker, caught' : 'The faker, got away', tone: caught ? 'bad' : 'good', uids: [state.fakerUid] },
        { label: caught ? 'Caught them' : 'Fooled', tone: caught ? 'good' : 'bad', uids: clean.map((p) => p.uid) },
      ],
    },
  });

  return { state: { ...state, phase: 'done' }, effects };
}

export const definition: GameDefinition<FkState, FkInput> = {
  id: 'fakeit',
  name: 'Fake It Till You Make It',
  emoji: '🕵️',
  rules:
    'One player never sees the prompt, only the move: fingers, a point or a raised hand. Everyone does the move on a 5-second count, then the prompt goes public and you argue. Vote and lock it in: if everyone else names the faker they drink 3 and the game ends, otherwise the faker gets away and everyone else owes 1 per round, up to 3 rounds.',
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
      argued: {},
      votes: {},
      lastUid: null,
      history: {},
    };
    const prompt = nextPrompt(base, ctx);
    return { ...base, prompt, usedPrompts: [prompt] };
  },

  reduce(state, event: GameEvent<FkInput>, ctx: GameContext): ReduceResult<FkState> {
    if (event.type === 'BEGIN') {
      if (!PHASES[state.phase as FkPhase]) return recover(state);
      return { state, effects: [{ type: 'TIMER', ms: BRIEF_MS }] };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (!input) return { state };

      if (input.action === 'ready') {
        if (state.phase === 'brief') {
          if ((state.seen ?? {})[event.uid]) return { state };
          const seen = { ...(state.seen ?? {}), [event.uid]: true };
          const next = { ...state, seen, lastUid: event.uid };
          return ctx.players.every((p) => seen[p.uid]) ? toGesture(next) : { state: next };
        }

        // the prompt is public and the clock is running: whoever is holding
        // the phone (shared) or the last player to tap (party) opens the ballot
        if (state.phase === 'reveal') {
          if (ctx.settings.mode === 'shared') return toVote({ ...state, lastUid: event.uid });
          if ((state.argued ?? {})[event.uid]) return { state };
          const argued = { ...(state.argued ?? {}), [event.uid]: true };
          const next = { ...state, argued };
          return ctx.players.every((p) => argued[p.uid]) ? toVote(next) : { state: next };
        }

        return { state };
      }

      if (input.action === 'vote') {
        if (state.phase !== 'vote') return { state };
        const target = input.value;
        if (typeof target !== 'string' || target === event.uid) return { state };
        if (!ctx.players.some((p) => p.uid === target)) return { state };
        if (!ctx.players.some((p) => p.uid === event.uid)) return { state };
        // locked means locked
        if (typeof (state.votes ?? {})[event.uid] === 'string') return { state };
        const votes = { ...(state.votes ?? {}), [event.uid]: target };
        const next = { ...state, votes, lastUid: event.uid };
        const everyoneLocked = ctx.players.every((p) => typeof votes[p.uid] === 'string');
        return everyoneLocked ? resolveRound(next, ctx) : { state: next };
      }

      return { state };
    }

    if (event.type === 'TIME_UP') {
      // force-advance whatever stragglers left hanging
      if (!PHASES[state.phase as FkPhase]) return recover(state);
      if (state.phase === 'brief') return toGesture(state);
      if (state.phase === 'gesture') return toReveal(state);
      if (state.phase === 'reveal') return toVote(state);
      // the ballot has no clock — a stray timeout here (a round carried over
      // from an older build) must not close it early
      if (state.phase === 'vote') return { state };
      if (state.phase === 'verdict') {
        const last = roundsOf(state).at(-1);
        if (last?.result === 'caught') return finish(state, ctx);
        return state.roundNo >= ROUNDS_COUNT ? toUnmask(state) : startRound(state, ctx);
      }
      if (state.phase === 'unmask') return finish(state, ctx);
    }

    return { state };
  },

  /**
   * Shared phone: private cards and ballots go round the table one player at
   * a time; the hands-off screens (countdown, argument, verdict) stay with
   * whoever tapped last, so no "pass the phone" gate lands on top of a
   * 5-second countdown.
   */
  sharedHolderUid(state, { players }) {
    if (state.phase === 'brief') {
      return players.find((p) => !(state.seen ?? {})[p.uid])?.uid ?? null;
    }
    if (state.phase === 'vote') {
      return players.find((p) => typeof (state.votes ?? {})[p.uid] !== 'string')?.uid ?? null;
    }
    const last = state.lastUid;
    return last && players.some((p) => p.uid === last) ? last : (players[0]?.uid ?? null);
  },

  View,
};

export default definition;
