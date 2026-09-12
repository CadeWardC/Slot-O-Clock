/**
 * ============================================================
 *  FAKE IT TILL YOU MAKE IT — one liar, three blind moves
 * ============================================================
 * ONE player is the faker for the WHOLE game, and they never get
 * the prompt. Each round opens on a private card: everybody else
 * reads the prompt, the faker is only told WHICH MOVE the table is
 * playing (fingers 🖐 / point 👉 / raise ✋) and told to blend in.
 *
 * The move itself is made with the body, never in the app. The
 * phones show a 10-second countdown and nothing else, the whole
 * table moves together at zero, and only THEN does the prompt go
 * public — faker included — so the table can argue about the moves
 * it just watched.
 *
 * Then the group votes. Ballots are public and live: everyone sees
 * who named whom and can switch their own pick, and the ballot
 * locks once every player has voted (a short last-chance window,
 * then it settles). An accusation only lands when every CLEAN
 * ballot names the same player — the faker's own ballot is a decoy
 * that is never counted, so nobody is caught by paperwork and
 * nobody is saved by it either.
 *
 * What the app never says is whether the group was RIGHT. Nobody
 * can vote for themselves, so a unanimous accusation can only ever
 * land on the faker: print "unanimous" and the faker is public in
 * round one, which turns rounds 2 and 3 into a formality. So the
 * ballots are public and the verdict stays silent — no drinks
 * mid-game, no "you got them", and all three rounds (and the whole
 * tab) settle at the unmask.
 *
 * (The prompt rides along in the broadcast state like every other
 * secret in this codebase: the View hides it during the brief and
 * the countdown, devtools doesn't. Same contract as `fakerUid`.)
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
export const GESTURE_MS = 10_000;
/** prompt goes public — argue about the moves you just saw */
export const REVEAL_MS = 120_000;
/** public ballot; it locks as soon as every player has voted */
export const VOTE_MS = 60_000;
/** last-chance window once every ballot is in — you can still switch */
export const LOCK_MS = 30_000;
/** the silent round result */
const VERDICT_MS = 10_000;
/** the unmasking */
const UNMASK_MS = 25_000;
/** the faker drinks this for every round the table nailed them */
export const CAUGHT_SIPS = 3;
/** everyone else drinks this for every round the faker got away */
export const FOOLED_SIPS = 1;

export type FkMode = 'numbers' | 'point' | 'raise';
export type FkPhase = 'brief' | 'gesture' | 'reveal' | 'vote' | 'verdict' | 'unmask' | 'done';

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
    fakerHint: 'Pick a number that looks like a real answer — you have to defend it out loud.',
  },
  point: {
    name: 'Point',
    emoji: '👉',
    how: 'everyone points at one player at the same time',
    move: 'point at one player',
    fakerHint: 'Point at whoever you can justify — then justify it hard.',
  },
  raise: {
    name: 'Raise a Hand',
    emoji: '✋',
    how: 'everyone raises a hand if the statement is true for them',
    move: 'raise a hand if it is true for you',
    fakerHint: "You don't know the statement — read the room and match the hands around you.",
  },
};

/** One round, fully resolved. Only the unmask screen ever renders the truth of it. */
export interface FkRoundRecord {
  roundNo: number;
  prompt: string;
  /** the player every clean ballot named (null = the ballot wasn't unanimous) */
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
  /** this round's prompt — hidden on screen until `reveal`, and never shown to the faker's card */
  prompt: string;
  usedPrompts: string[];
  /** the ONE faker for the entire game */
  fakerUid: string;
  /** brief: uid → has read their private card */
  seen: Record<string, boolean>;
  /** reveal: uid → has said their piece and is ready for the ballot */
  argued: Record<string, boolean>;
  /** voter uid → the player they're naming (live and changeable until the ballot locks) */
  votes: Record<string, string>;
  /** vote: every ballot is in — the last-chance window is running */
  allIn: boolean;
  /** roundNo → the whole truth, rendered only on the unmask screen */
  history: Record<string, FkRoundRecord>;
}

export type FkInput =
  /** brief: I've read my card · reveal: we've said enough, open the ballot */
  | { action: 'ready' }
  /** vote: name a player — re-sending switches your pick while the ballot is open */
  | { action: 'vote'; value: string }
  /** vote (shared phone): hand the phone round the table again */
  | { action: 'recast' };

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
    state: { ...state, phase: 'brief', seen: {}, argued: {}, votes: {}, allIn: false },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: BRIEF_MS }],
  };
}

function nextPrompt(state: FkState, ctx: GameContext): string {
  const prompts = PACK[state.mode]?.prompts ?? PACK.numbers.prompts;
  const fresh = prompts.filter((p) => !(state.usedPrompts ?? []).includes(p));
  return pick(fresh.length > 0 ? fresh : prompts, ctx.rng);
}

function roundsOf(state: FkState): FkRoundRecord[] {
  return Object.values(state.history ?? {}).sort((a, b) => a.roundNo - b.roundNo);
}

function cleanPlayers(state: FkState, ctx: GameContext) {
  return ctx.players.filter((p) => p.uid !== state.fakerUid);
}

/**
 * The group's decision: the player every CLEAN ballot named, or null
 * when the ballot was split. The faker's own ballot is deliberately not
 * part of this — it can neither land an accusation nor break one.
 */
function unanimousTarget(state: FkState, ctx: GameContext): string | null {
  const votes = state.votes ?? {};
  const clean = cleanPlayers(state, ctx);
  const targets = clean.map((p) => votes[p.uid]).filter((t): t is string => typeof t === 'string');
  if (clean.length === 0 || targets.length !== clean.length) return null;
  return targets.every((t) => t === targets[0]) ? targets[0] : null;
}

function toGesture(state: FkState): ReduceResult<FkState> {
  // no CLEAR_INPUTS: nobody taps during the countdown, and on a shared
  // phone wiping the inputs would park a "pass the phone to…" gate in
  // front of a countdown that is already running
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

function toVote(state: FkState): ReduceResult<FkState> {
  return {
    state: { ...state, phase: 'vote', argued: {}, allIn: false },
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
      argued: {},
      votes: {},
      allIn: false,
    },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: BRIEF_MS }],
  };
}

/**
 * The round settles. Somebody is accused only when EVERY clean ballot
 * named them. The result is written to `history` for the unmask and is
 * deliberately rendered NOWHERE: the table must not learn whether their
 * accusation landed until all three rounds are done — and the round
 * always ends on the clock (or the moment every ballot is in), never on
 * unanimity, so the timing of the verdict can't give it away either.
 */
function resolveRound(state: FkState, ctx: GameContext): ReduceResult<FkState> {
  const accusedUid = unanimousTarget(state, ctx);
  const record: FkRoundRecord = {
    roundNo: state.roundNo,
    prompt: state.prompt,
    accusedUid,
    unanimous: accusedUid != null,
    // nobody can name themselves, so a unanimous ballot can only ever
    // land on the faker — the check stays explicit anyway
    hit: accusedUid === state.fakerUid,
    votes: state.votes ?? {},
  };

  return {
    state: {
      ...state,
      phase: 'verdict',
      allIn: false,
      history: { ...(state.history ?? {}), [state.roundNo]: record },
    },
    effects: [{ type: 'TIMER', ms: VERDICT_MS }],
  };
}

/** The whole tab lands at once — the first time the truth is public. */
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

export const definition: GameDefinition<FkState, FkInput> = {
  id: 'fakeit',
  name: 'Fake It Till You Make It',
  emoji: '🕵️',
  rules:
    'One player NEVER gets the prompt — they only get told the move (fingers 🖐, a point 👉 or a raised hand ✋) and have to blend in. Everyone else reads the prompt privately, a 10-second countdown drops, and the whole table makes the move at once with their body — nothing is tapped in the app. The prompt then goes public and you argue it out. Finally the group votes: ballots are public and live, and an accusation needs every vote to land on the same player (the faker\'s own ballot never counts). One doubter and the faker walks — and whether you were right stays secret until the final unmask.',
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
      allIn: false,
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
          const next = { ...state, seen };
          return Object.keys(seen).length >= ctx.players.length ? toGesture(next) : { state: next };
        }

        // the prompt is public and the clock is running: whoever is holding
        // the phone (shared) or the last player to tap (party) opens the ballot
        if (state.phase === 'reveal') {
          if (ctx.settings.mode === 'shared') return toVote(state);
          if ((state.argued ?? {})[event.uid]) return { state };
          const argued = { ...(state.argued ?? {}), [event.uid]: true };
          const next = { ...state, argued };
          return Object.keys(argued).length >= ctx.players.length ? toVote(next) : { state: next };
        }

        return { state };
      }

      if (input.action === 'vote') {
        if (state.phase !== 'vote') return { state };
        const target = input.value;
        if (typeof target !== 'string' || target === event.uid) return { state };
        if (!ctx.players.some((p) => p.uid === target)) return { state };
        const votes = { ...(state.votes ?? {}), [event.uid]: target };
        const next = { ...state, votes };
        const everyoneVoted = ctx.players.every((p) => typeof votes[p.uid] === 'string');
        if (!everyoneVoted) return { state: { ...next, allIn: false } };
        // every ballot is in: the table gets one last-chance window to switch
        // before the round settles (switching inside it doesn't extend it)
        if (state.allIn) return { state: { ...next, allIn: true } };
        return { state: { ...next, allIn: true }, effects: [{ type: 'TIMER', ms: LOCK_MS }] };
      }

      if (input.action === 'recast') {
        if (state.phase !== 'vote' || ctx.settings.mode !== 'shared') return { state };
        if (!state.allIn) return { state };
        return {
          state: { ...state, allIn: false },
          effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: VOTE_MS }],
        };
      }

      return { state };
    }

    if (event.type === 'TIME_UP') {
      // force-advance whatever stragglers left hanging
      if (!PHASES[state.phase as FkPhase]) return recover(state);
      if (state.phase === 'brief') return toGesture(state);
      if (state.phase === 'gesture') return toReveal(state);
      if (state.phase === 'reveal') return toVote(state);
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
