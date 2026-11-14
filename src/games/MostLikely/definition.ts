import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  Highlight,
  ReduceResult,
} from '../../engine/types';
import pack from '../../content/mostlikely.json';
import { View } from './View';

/**
 * Most Likely To 👉
 *
 * Three prompts, played with real fingers. Each one: the prompt comes up on
 * every phone, the phones count 3, 2, 1 together, and on zero everybody points
 * at a player across the table. Then any phone says who had the most fingers
 * on them (a tie names both) and they drink. Nothing is charged until the
 * third prompt is done, so the drinks screen carries the whole game's bill.
 */

export const ROUNDS = 3;
/** time to read the prompt before the count starts */
export const READ_MS = 4_000;
/** the 3, 2, 1 */
export const COUNT_MS = 3_000;
/** how long the table gets to say who had the most fingers on them */
export const TALLY_MS = 30_000;
export const REVEAL_MS = 5_000;
/** what the most-pointed-at player drinks for one prompt */
export const POINT_SIPS = 2;

const ENDINGS: string[] = (pack as { endings: string[] }).endings;

/** one finished prompt */
export interface MlRound {
  prompt: string;
  /** who had the most fingers on them; empty when nobody called it */
  winners: string[];
  /** what each of them drinks for it */
  sips: number;
  /** whose phone called it */
  by: string | null;
}

export interface MlState {
  /** count: prompt + countdown · tally: fingers are up, who has the most · reveal */
  phase: 'count' | 'tally' | 'reveal';
  /** which prompt is on the table, 0-based */
  idx: number;
  prompts: string[];
  rounds: MlRound[];
}

/** who had the most fingers on them; an empty list is "nobody, too close to call" */
export type MlInput = { most: string[] };

function reveal(state: MlState, winners: string[], by: string | null): ReduceResult<MlState> {
  const round: MlRound = {
    prompt: (state.prompts ?? [])[state.idx ?? 0] ?? '',
    winners,
    sips: winners.length > 0 ? POINT_SIPS : 0,
    by,
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
  for (const r of rounds) {
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
          : `Pointed at most ${owed[p.uid].prompts.length} times`,
    }));

  // ---- moments, best first, two at most
  const highlights: Highlight[] = [];
  const allThree = ctx.players.find(
    (p) => rounds.length >= ROUNDS && rounds.every((r) => (r.winners ?? []).length === 1 && r.winners[0] === p.uid),
  );
  if (allThree) highlights.push({ kind: 'mlt-magnet', uid: allThree.uid, n: rounds.length });
  const called = rounds.some((r) => (r.winners ?? []).length > 0);
  const untouched = ctx.players.filter((p) => !owed[p.uid]);
  if (called && untouched.length === 1) highlights.push({ kind: 'mlt-clean', uid: untouched[0].uid });

  const drinkers = assignments.map((a) => a.uid);
  const most = [...assignments].sort((a, b) => b.sips - a.sips)[0];
  const note = most ? `${nameOf(most.uid)} drinks ${most.sips} for it.` : 'Nobody got called out. Nobody drinks.';

  return {
    state,
    effects: [
      {
        type: 'END',
        assignments,
        note,
        highlights: highlights.slice(0, 2),
        recap: called
          ? {
              title: 'Who the table pointed at',
              groups: [
                { label: 'Got the fingers', tone: 'bad', uids: drinkers },
                { label: 'Never the one', tone: 'good', uids: untouched.map((p) => p.uid) },
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
  rules: `${ROUNDS} prompts. Read it, then the phones count 3, 2, 1 and everyone points at whoever is most likely to do it. For real, across the table. Whoever has the most fingers on them drinks ${POINT_SIPS}, and a tie drinks together.`,
  minPlayers: 3,
  // one phone: it stays with the turn player, who reads the prompt out
  sharedInput: 'actor',

  createInitialState(ctx: GameContext): MlState {
    // this game's prompts, drawn without repeats
    const pool = [...ENDINGS];
    const prompts: string[] = [];
    while (prompts.length < ROUNDS && pool.length > 0) {
      prompts.push(pool.splice(Math.floor(ctx.rng() * pool.length) % pool.length, 1)[0]);
    }
    return { phase: 'count', idx: 0, prompts, rounds: [] };
  },

  reduce(state, event: GameEvent<MlInput>, ctx: GameContext): ReduceResult<MlState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: READ_MS + COUNT_MS }] };
    }

    if (event.type === 'INPUT') {
      // any phone at the table may call it; the first call stands
      if (state.phase !== 'tally' || event.input == null) return { state };
      if (!ctx.players.some((p) => p.uid === event.uid)) return { state };
      const named = event.input.most;
      if (!Array.isArray(named)) return { state };
      const winners = ctx.players.map((p) => p.uid).filter((uid) => named.includes(uid));
      return reveal(state, winners, event.uid);
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'count') {
        return { state: { ...state, phase: 'tally' }, effects: [{ type: 'TIMER', ms: TALLY_MS }] };
      }
      if (state.phase === 'tally') return reveal(state, [], null);
      if (state.phase === 'reveal') {
        const idx = (state.idx ?? 0) + 1;
        if (idx >= Math.min(ROUNDS, (state.prompts ?? []).length)) return finish(state, ctx);
        return {
          state: { ...state, phase: 'count', idx },
          effects: [{ type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: READ_MS + COUNT_MS }],
        };
      }
    }

    return { state };
  },

  View,
};

export default definition;
