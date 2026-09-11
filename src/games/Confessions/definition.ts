/**
 * ============================================================
 *  ANONYMOUS CONFESSIONS — write it, hide it, get sniffed out
 * ============================================================
 * One prompt per round. Everyone types a short anonymous answer,
 * all the cards are revealed with no names on them, and then a
 * single random card goes on trial: who wrote it?
 *
 * Authorship lives in `cards[].authorUid`, which the View refuses
 * to render until the reveal — the same social-hiding approach
 * FakeIt and Poison use. The text a player types is capped and
 * whitespace-collapsed on the host before it reaches shared state.
 */

import pack from '../../content/confessions.json';
import { pick, shuffled } from '../../engine/rng';
import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

export const ROUNDS_COUNT = 2;
/** hard cap on a confession — enforced on the host, not just the textarea */
export const MAX_TEXT = 90;
export const WRITE_MS = 90_000;
export const VOTE_MS = 45_000;
const REVEAL_MS = 10_000;
const CAUGHT_SIPS = 2;
const FOOLED_SIPS = 1;

const PROMPTS = (pack as { t: string }[]).map((p) => p.t);

export interface CfCard {
  /** shuffled label — carries no author information */
  id: string;
  /** the number players see, 1..n */
  n: number;
  text: string;
  authorUid: string;
}

export interface CfRoundResult {
  caught: boolean;
  authorUid: string;
  accusedUid: string | null;
  assignments: DrinkAssignment[];
  note: string;
}

export interface CfState {
  phase: 'write' | 'trial' | 'reveal' | 'done';
  roundNo: number;
  prompt: string;
  usedPrompts: string[];
  /** uid → their confession this round */
  written: Record<string, string>;
  cards: CfCard[];
  trialCardId: string;
  /** voter uid → the player they blamed */
  votes: Record<string, string>;
  roundResult: CfRoundResult | null;
  history: Record<string, { authorUid: string; caught: boolean }>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export type CfInput = { action: 'write'; text: string } | { action: 'vote'; uid: string };

/** Trim + collapse whitespace + cap length. Returns null if there's nothing left. */
function clean(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return null;
  return text.slice(0, MAX_TEXT);
}

/** Strict plurality; a tie accuses nobody (same rule FakeIt uses). */
function countVotes(votes: Record<string, string>): string | null {
  const tally: Record<string, number> = {};
  for (const target of Object.values(votes)) tally[target] = (tally[target] ?? 0) + 1;
  let top = 0;
  let accused: string | null = null;
  let tie = false;
  for (const [uid, n] of Object.entries(tally)) {
    if (n > top) {
      top = n;
      accused = uid;
      tie = false;
    } else if (n === top) {
      tie = true;
    }
  }
  return tie ? null : accused;
}

function nextPrompt(used: string[], ctx: GameContext): string {
  const fresh = PROMPTS.filter((p) => !used.includes(p));
  return pick(fresh.length > 0 ? fresh : PROMPTS, ctx.rng);
}

/** Seal the confessions into anonymous, shuffled cards and pick one for trial. */
function toTrial(state: CfState, ctx: GameContext): ReduceResult<CfState> {
  const written = state.written ?? {};
  const cards: CfCard[] = shuffled(Object.keys(written), ctx.rng).map((uid, i) => ({
    id: `c${i + 1}`,
    n: i + 1,
    text: written[uid],
    authorUid: uid,
  }));
  const trialCardId = cards.length > 0 ? pick(cards, ctx.rng).id : '';
  return {
    state: { ...state, phase: 'trial', cards, trialCardId, votes: {} },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: VOTE_MS }],
  };
}

function summaryNote(state: CfState, ctx: GameContext): string {
  const rounds = Object.entries(state.history ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const caught = rounds.filter(([, h]) => h.caught).length;
  const who = rounds
    .map(([, h]) => ctx.players.find((p) => p.uid === h.authorUid)?.name ?? '?')
    .join(', ');
  return `You sniffed out ${caught}/${rounds.length} confessions — the cards belonged to ${who}`;
}

function resolveRound(state: CfState, ctx: GameContext): ReduceResult<CfState> {
  const card = (state.cards ?? []).find((c) => c.id === state.trialCardId);
  const votes = state.votes ?? {};

  let assignments: DrinkAssignment[];
  let note: string;
  let caught = false;
  const authorUid = card?.authorUid ?? '';
  const effects: Effect[] = [];

  if (!card) {
    // nobody got a confession in before the clock ran out
    assignments = ctx.players.map((p) => ({
      uid: p.uid,
      sips: FOOLED_SIPS,
      reason: 'Nobody confessed 🤐',
    }));
    note = 'Nobody confessed in time 🤐 — everyone drinks 1';
  } else {
    const author = ctx.players.find((p) => p.uid === authorUid);
    const accusedUid = countVotes(votes);
    const accused = accusedUid ? ctx.players.find((p) => p.uid === accusedUid) : null;
    caught = accusedUid === authorUid;

    assignments = caught
      ? [{ uid: authorUid, sips: CAUGHT_SIPS, reason: 'Your confession got sniffed out 🤫' }]
      : ctx.players
          .filter((p) => p.uid !== authorUid)
          .map((p) => ({ uid: p.uid, sips: FOOLED_SIPS, reason: 'Fooled by a confession 🤫' }));

    note = caught
      ? `🕵️ Card #${card.n} was ${author?.name ?? '?'}'s — caught red-handed!`
      : accused
        ? `🤫 Card #${card.n} was ${author?.name ?? '?'}'s — you all blamed ${accused.name}!`
        : `🤐 Card #${card.n} was ${author?.name ?? '?'}'s — nobody could decide!`;

    if (caught) {
      for (const [voter, target] of Object.entries(votes)) {
        if (target === authorUid) effects.push({ type: 'SCORE', uid: voter, delta: 1 });
      }
    } else if (authorUid) {
      effects.push({ type: 'SCORE', uid: authorUid, delta: 1 });
    }
  }

  const history = {
    ...(state.history ?? {}),
    [state.roundNo]: { authorUid, caught },
  };
  const roundResult: CfRoundResult = { caught, authorUid, accusedUid: countVotes(votes), assignments, note };
  const next: CfState = { ...state, roundResult, history, assignments, note };

  if (state.roundNo >= ROUNDS_COUNT) {
    return {
      state: { ...next, phase: 'done' },
      effects: [...effects, { type: 'END', assignments, note: `${summaryNote(next, ctx)} — ${note}` }],
    };
  }

  // earlier rounds pour immediately, then the verdict sits for a beat
  return {
    state: { ...next, phase: 'reveal' },
    effects: [...effects, { type: 'DRINKS', assignments }, { type: 'TIMER', ms: REVEAL_MS }],
  };
}

function startRound(state: CfState, ctx: GameContext): ReduceResult<CfState> {
  const used = [...(state.usedPrompts ?? []), state.prompt];
  return {
    state: {
      ...state,
      phase: 'write',
      roundNo: state.roundNo + 1,
      prompt: nextPrompt(used, ctx),
      usedPrompts: used,
      written: {},
      cards: [],
      trialCardId: '',
      votes: {},
      roundResult: null,
      assignments: [],
      note: null,
    },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: WRITE_MS }],
  };
}

export const definition: GameDefinition<CfState, CfInput> = {
  id: 'confessions',
  name: 'Anonymous Confessions',
  emoji: '🤫',
  rules:
    "Everyone answers the same juicy prompt — anonymously. The confessions appear with no names on them, then one card goes on trial: who wrote it? A caught author drinks 2; fool the whole group and everyone else drinks 1. Two prompts per game.",
  minPlayers: 3,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): CfState {
    const prompt = nextPrompt([], ctx);
    return {
      phase: 'write',
      roundNo: 1,
      prompt,
      usedPrompts: [prompt],
      written: {},
      cards: [],
      trialCardId: '',
      votes: {},
      roundResult: null,
      history: {},
      assignments: [],
      note: null,
    };
  },

  reduce(state, event: GameEvent<CfInput>, ctx: GameContext): ReduceResult<CfState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: WRITE_MS }] };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (!input) return { state };

      if (input.action === 'write') {
        if (state.phase !== 'write') return { state };
        if ((state.written ?? {})[event.uid] != null) return { state };
        const text = clean(input.text);
        if (!text) return { state };
        const written = { ...(state.written ?? {}), [event.uid]: text };
        const next: CfState = { ...state, written };
        return Object.keys(written).length >= ctx.players.length ? toTrial(next, ctx) : { state: next };
      }

      if (input.action === 'vote') {
        if (state.phase !== 'trial' || !state.trialCardId) return { state };
        const target = input.uid;
        if (typeof target !== 'string' || target === event.uid) return { state };
        if (!ctx.players.some((p) => p.uid === target)) return { state };
        if ((state.votes ?? {})[event.uid]) return { state }; // first vote is locked
        const votes = { ...(state.votes ?? {}), [event.uid]: target };
        const next: CfState = { ...state, votes };
        return Object.keys(votes).length >= ctx.players.length ? resolveRound(next, ctx) : { state: next };
      }

      return { state };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'write') return toTrial(state, ctx);
      if (state.phase === 'trial') return resolveRound(state, ctx);
      if (state.phase === 'reveal') return startRound(state, ctx);
    }

    return { state };
  },

  View,
};

export default definition;
