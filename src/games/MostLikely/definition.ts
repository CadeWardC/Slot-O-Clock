import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  Highlight,
  PlayerInfo,
  ReduceResult,
} from '../../engine/types';
import pack from '../../content/mostlikely.json';
import { View } from './View';

/**
 * Most Likely To 👉
 *
 * Three prompts. Each one: everybody secretly names a player, the votes are
 * turned over together, and whoever got the most drinks one per vote. A tie
 * drinks together. Nothing is charged until the third prompt is done, so the
 * drinks screen carries the whole game's bill.
 */

export const ROUNDS = 3;
export const VOTE_MS = 20_000;
/** a shared phone has to travel round the table */
export const SHARED_VOTE_MS_EACH = 15_000;
export const REVEAL_MS = 6_000;
/** the most one prompt can cost, however many votes it drew */
export const MAX_SIPS = 4;

const ENDINGS: string[] = (pack as { endings: string[] }).endings;

/** one finished prompt */
export interface MlRound {
  prompt: string;
  /** voter → who they named (only votes that counted) */
  votes: Record<string, string>;
  /** whoever got the most; empty when nobody voted */
  winners: string[];
  /** what each winner drinks for it */
  sips: number;
}

export interface MlState {
  phase: 'vote' | 'reveal';
  /** which prompt is on the table, 0-based */
  idx: number;
  prompts: string[];
  /** this prompt's votes so far: voter → target. Never shown before the reveal. */
  votes: Record<string, string>;
  rounds: MlRound[];
  /** shared phone: whoever voted last keeps it for the reveal */
  lastUid: string | null;
}

export type MlInput = { vote: string };

function voteMs(ctx: GameContext): number {
  return ctx.settings.mode === 'shared'
    ? SHARED_VOTE_MS_EACH * Math.max(1, ctx.players.length)
    : VOTE_MS;
}

/** votes received per player, from votes that name a real player */
export function tally(votes: Record<string, string>, players: PlayerInfo[]): Record<string, number> {
  const seated = new Set(players.map((p) => p.uid));
  const counts: Record<string, number> = {};
  for (const [voter, target] of Object.entries(votes ?? {})) {
    if (!seated.has(voter) || !seated.has(target)) continue;
    counts[target] = (counts[target] ?? 0) + 1;
  }
  return counts;
}

/** Turn the votes over. */
function reveal(state: MlState, ctx: GameContext): ReduceResult<MlState> {
  const seated = new Set(ctx.players.map((p) => p.uid));
  const votes: Record<string, string> = {};
  for (const [voter, target] of Object.entries(state.votes ?? {})) {
    if (seated.has(voter) && seated.has(target)) votes[voter] = target;
  }
  const counts = tally(votes, ctx.players);
  const top = Math.max(0, ...Object.values(counts));
  const winners = top > 0 ? ctx.players.filter((p) => counts[p.uid] === top).map((p) => p.uid) : [];
  const round: MlRound = {
    prompt: (state.prompts ?? [])[state.idx ?? 0] ?? '',
    votes,
    winners,
    sips: Math.min(MAX_SIPS, top),
  };
  return {
    state: { ...state, phase: 'reveal', rounds: [...(state.rounds ?? []), round] },
    effects: [{ type: 'TIMER', ms: REVEAL_MS }],
  };
}

/** The bill for the whole game, and the moments worth a line. */
function finish(state: MlState, ctx: GameContext): ReduceResult<MlState> {
  const rounds = state.rounds ?? [];
  const nameOf = (uid: string) => ctx.players.find((p) => p.uid === uid)?.name ?? '?';
  const owed: Record<string, { sips: number; prompts: string[] }> = {};
  const received: Record<string, number> = {};
  for (const r of rounds) {
    for (const target of Object.values(r.votes ?? {})) received[target] = (received[target] ?? 0) + 1;
    for (const uid of r.winners ?? []) {
      const o = owed[uid] ?? { sips: 0, prompts: [] };
      o.sips += r.sips;
      o.prompts.push(r.prompt);
      owed[uid] = o;
    }
  }
  const assignments: DrinkAssignment[] = ctx.players
    .filter((p) => (owed[p.uid]?.sips ?? 0) > 0)
    .map((p) => ({
      uid: p.uid,
      sips: owed[p.uid].sips,
      reason:
        owed[p.uid].prompts.length === 1
          ? `Most likely to ${owed[p.uid].prompts[0]}`
          : `Voted most likely ${owed[p.uid].prompts.length} times`,
    }));

  // ---- moments, best first, two at most
  const highlights: Highlight[] = [];
  const allThree = ctx.players.find(
    (p) => rounds.length >= ROUNDS && rounds.every((r) => (r.winners ?? []).length === 1 && r.winners[0] === p.uid),
  );
  if (allThree) highlights.push({ kind: 'mlt-magnet', uid: allThree.uid, n: received[allThree.uid] ?? 0 });
  const unanimous = rounds.find((r) => {
    const targets = Object.values(r.votes ?? {});
    return targets.length >= 3 && targets.every((t) => t === targets[0]);
  });
  if (unanimous) {
    highlights.push({ kind: 'mlt-unanimous', uid: Object.values(unanimous.votes)[0], text: unanimous.prompt });
  }
  const selfMade = rounds.find((r) => (r.winners ?? []).some((uid) => (r.votes ?? {})[uid] === uid));
  if (selfMade) {
    const uid = (selfMade.winners ?? []).find((w) => (selfMade.votes ?? {})[w] === w) as string;
    highlights.push({ kind: 'mlt-self-vote', uid, text: selfMade.prompt });
  }
  const voted = rounds.some((r) => Object.keys(r.votes ?? {}).length > 0);
  const untouched = ctx.players.filter((p) => (received[p.uid] ?? 0) === 0);
  if (voted && untouched.length === 1) highlights.push({ kind: 'mlt-clean', uid: untouched[0].uid });

  const drinkers = assignments.map((a) => a.uid);
  const most = [...assignments].sort((a, b) => b.sips - a.sips)[0];
  const note = !voted
    ? 'Nobody voted. Nobody drinks.'
    : most
      ? `${nameOf(most.uid)} drinks ${most.sips} for it.`
      : 'Nobody drinks.';

  return {
    state,
    effects: [
      {
        type: 'END',
        assignments,
        note,
        highlights: highlights.slice(0, 2),
        recap: voted
          ? {
              title: 'Who the table picked',
              groups: [
                { label: 'Got the votes', tone: 'bad', uids: drinkers },
                { label: 'Not one vote all game', tone: 'good', uids: untouched.map((p) => p.uid) },
              ],
            }
          : undefined,
      },
    ],
  };
}

export const definition: GameDefinition<MlState, MlInput> = {
  id: 'most-likely',
  name: 'Most Likely To',
  emoji: '👉',
  rules: `${ROUNDS} prompts. Everyone secretly names the player most likely to do it, yourself included. Whoever gets the most votes drinks one per vote, up to ${MAX_SIPS}, and a tie drinks together.`,
  minPlayers: 3,
  sharedInput: 'all',

  /**
   * Shared phone: it goes to whoever has not voted yet, then stays with the
   * last voter for the reveal so no "pass the phone" lands on top of it.
   */
  sharedHolderUid(state, { players }) {
    if (state.phase === 'vote') {
      const next = players.find((p) => typeof (state.votes ?? {})[p.uid] !== 'string');
      if (next) return next.uid;
    }
    const last = state.lastUid;
    return last && players.some((p) => p.uid === last) ? last : (players[0]?.uid ?? null);
  },

  createInitialState(ctx: GameContext): MlState {
    // this game's prompts, drawn without repeats
    const pool = [...ENDINGS];
    const prompts: string[] = [];
    while (prompts.length < ROUNDS && pool.length > 0) {
      prompts.push(pool.splice(Math.floor(ctx.rng() * pool.length) % pool.length, 1)[0]);
    }
    return { phase: 'vote', idx: 0, prompts, votes: {}, rounds: [], lastUid: null };
  },

  reduce(state, event: GameEvent<MlInput>, ctx: GameContext): ReduceResult<MlState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: voteMs(ctx) }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase !== 'vote' || event.input == null) return { state };
      const target = event.input.vote;
      if (typeof target !== 'string') return { state };
      if (!ctx.players.some((p) => p.uid === target)) return { state };
      if (!ctx.players.some((p) => p.uid === event.uid)) return { state };
      if (typeof (state.votes ?? {})[event.uid] === 'string') return { state }; // one vote each, final
      const votes = { ...(state.votes ?? {}), [event.uid]: target };
      const next: MlState = { ...state, votes, lastUid: event.uid };
      if (ctx.players.every((p) => typeof votes[p.uid] === 'string')) return reveal(next, ctx);
      return { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'vote') return reveal(state, ctx);
      if (state.phase === 'reveal') {
        const idx = (state.idx ?? 0) + 1;
        if (idx >= Math.min(ROUNDS, (state.prompts ?? []).length)) return finish(state, ctx);
        return {
          state: { ...state, phase: 'vote', idx, votes: {} },
          // the phase change already opens a new input stage; this makes the
          // shared-phone gate start again from the first player
          effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: voteMs(ctx) }],
        };
      }
    }

    return { state };
  },

  View,
};

export default definition;
