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
 *
 * After the last trial the game doesn't just stop: the finale turns
 * every card of every round face up — who wrote what — and crowns
 * whoever took the fewest drinks. A lone winner hands out one drink.
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
/** the finale: read who wrote what; ends early once everyone taps done */
export const FINALE_MS = 45_000;
const CAUGHT_SIPS = 2;
const FOOLED_SIPS = 1;
/** what the driest confessor hands out at the end */
export const GIFT_SIPS = 1;

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
  phase: 'write' | 'trial' | 'reveal' | 'finale' | 'done';
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
  /** every finished round's cards, kept for the finale's who-wrote-what */
  archive: { prompt: string; trialCardId: string; cards: CfCard[] }[];
  /** uid → drinks taken in this game so far */
  tally: Record<string, number>;
  /** fewest drinks this game (empty until the finale, or on a dead heat) */
  winnerUids: string[];
  /** who the lone winner handed a drink to */
  giftUid: string | null;
  /** players who are done reading the finale */
  oks: Record<string, boolean>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export type CfInput =
  | { action: 'write'; text: string }
  | { action: 'vote'; uid: string }
  /** finale: the lone winner hands out a drink */
  | { action: 'give'; uid: string }
  /** finale: done reading */
  | { action: 'ok' };

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
  const tally = { ...(state.tally ?? {}) };
  for (const a of assignments) tally[a.uid] = (tally[a.uid] ?? 0) + a.sips;
  const archive = [
    ...(state.archive ?? []),
    { prompt: state.prompt, trialCardId: state.trialCardId ?? '', cards: state.cards ?? [] },
  ];
  const roundResult: CfRoundResult = { caught, authorUid, accusedUid: countVotes(votes), assignments, note };
  const next: CfState = { ...state, roundResult, history, tally, archive, assignments, note };

  // every round pours immediately, then the verdict sits for a beat
  return {
    state: { ...next, phase: 'reveal' },
    effects: [...effects, { type: 'DRINKS', assignments }, { type: 'TIMER', ms: REVEAL_MS }],
  };
}

/** Fewest drinks this game. Everyone level = a dead heat, and nobody is crowned. */
function driest(state: CfState, ctx: GameContext): string[] {
  const tally = state.tally ?? {};
  const of = (uid: string) => tally[uid] ?? 0;
  const low = Math.min(...ctx.players.map((p) => of(p.uid)));
  const winners = ctx.players.filter((p) => of(p.uid) === low).map((p) => p.uid);
  return winners.length >= ctx.players.length ? [] : winners;
}

/** All cards face up, the crown handed out. */
function toFinale(state: CfState, ctx: GameContext): ReduceResult<CfState> {
  return {
    state: { ...state, phase: 'finale', winnerUids: driest(state, ctx), giftUid: null, oks: {} },
    effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: FINALE_MS }],
  };
}

function finish(state: CfState, ctx: GameContext): ReduceResult<CfState> {
  const winners = state.winnerUids ?? [];
  const nameOf = (uid: string) => ctx.players.find((p) => p.uid === uid)?.name ?? '?';
  const tally = state.tally ?? {};
  let giftUid = state.giftUid ?? null;
  // a lone winner who never chose: the drink still lands on somebody
  if (winners.length === 1 && !giftUid) {
    const others = ctx.players.filter((p) => p.uid !== winners[0]);
    if (others.length > 0) giftUid = pick(others, ctx.rng).uid;
  }
  const assignments: DrinkAssignment[] =
    winners.length === 1 && giftUid
      ? [{ uid: giftUid, sips: GIFT_SIPS, reason: `👑 ${nameOf(winners[0])} got off lightest and picked you` }]
      : [];

  const rounds = Object.entries(state.history ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]));
  const caughtUids = [...new Set(rounds.filter(([, h]) => h.caught && h.authorUid).map(([, h]) => h.authorUid))];
  const freeUids = [...new Set(rounds.filter(([, h]) => !h.caught && h.authorUid).map(([, h]) => h.authorUid))];
  const groups = [];
  if (winners.length > 0) {
    const n = tally[winners[0]] ?? 0;
    groups.push({
      label: `👑 Fewest drinks (${n}) — ${winners.length === 1 ? 'the driest confessor' : 'tied for driest'}`,
      tone: 'good' as const,
      uids: winners,
    });
  }
  if (caughtUids.length > 0) groups.push({ label: '🕵️ Sniffed out', tone: 'bad' as const, uids: caughtUids });
  if (freeUids.length > 0) groups.push({ label: '🤫 Got away with it', tone: 'neutral' as const, uids: freeUids });

  const crown =
    winners.length === 0
      ? 'Dead heat — nobody stayed drier than anyone else'
      : `👑 ${winners.map(nameOf).join(' & ')} took the fewest drinks`;
  const note = `${crown} · ${summaryNote(state, ctx)}`;
  return {
    state: { ...state, phase: 'done', giftUid, assignments, note },
    effects: [{ type: 'END', assignments, note, recap: { title: 'Who got away with what', groups } }],
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
    "Everyone answers the same juicy prompt — anonymously. The confessions appear with no names on them, then one card goes on trial: who wrote it? A caught author drinks 2; fool the whole group and everyone else drinks 1. Two prompts per game — then every card is turned face up so you all see who wrote what, and whoever took the fewest drinks is crowned and hands one out.",
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
      archive: [],
      tally: {},
      winnerUids: [],
      giftUid: null,
      oks: {},
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

      if (state.phase === 'finale') {
        const winners = state.winnerUids ?? [];
        const shared = ctx.settings.mode === 'shared';
        let next = state;
        if (input.action === 'give') {
          // one phone for the table: whoever holds it taps for the winner
          if (winners.length !== 1 || state.giftUid) return { state };
          if (!shared && event.uid !== winners[0]) return { state };
          const target = input.uid;
          if (typeof target !== 'string' || target === winners[0]) return { state };
          if (!ctx.players.some((p) => p.uid === target)) return { state };
          next = { ...state, giftUid: target, oks: { ...(state.oks ?? {}), [event.uid]: true } };
        } else if (input.action === 'ok') {
          next = { ...state, oks: { ...(state.oks ?? {}), [event.uid]: true } };
        } else {
          return { state };
        }
        const giftSettled = winners.length !== 1 || !!next.giftUid;
        const everyone = shared || ctx.players.every((p) => (next.oks ?? {})[p.uid]);
        return giftSettled && everyone ? finish(next, ctx) : { state: next };
      }

      return { state };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'write') return toTrial(state, ctx);
      if (state.phase === 'trial') return resolveRound(state, ctx);
      if (state.phase === 'reveal') {
        return state.roundNo >= ROUNDS_COUNT ? toFinale(state, ctx) : startRound(state, ctx);
      }
      if (state.phase === 'finale') return finish(state, ctx);
    }

    return { state };
  },

  View,
};

export default definition;
