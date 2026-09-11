import pack from '../../content/prompts.json';
import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

const VOTE_MS = 15000;
const REVEAL_MS = 5000;

type Rule = 'guilty' | 'innocent' | 'minority';

export interface PromptsState {
  prompt: string;
  rule: Rule;
  phase: 'vote' | 'reveal';
  votes: Record<string, boolean>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface PromptsInput {
  vote: boolean;
}

function reveal(state: PromptsState, ctx: GameContext): ReduceResult<PromptsState> {
  const votes: Record<string, boolean> = { ...(state.votes ?? {}) };
  for (const p of ctx.players) {
    if (!(p.uid in votes)) votes[p.uid] = false; // no vote = not guilty
  }
  const guilty = Object.entries(votes).filter(([, g]) => g).map(([uid]) => uid);
  const innocent = Object.entries(votes).filter(([, g]) => !g).map(([uid]) => uid);
  const assignments: DrinkAssignment[] = [];
  let note: string;

  if (guilty.length === innocent.length && guilty.length > 0) {
    for (const uid of ctx.players.map((p) => p.uid)) {
      assignments.push({ uid, sips: 1, reason: 'Perfectly split — everyone drinks! 🤝' });
    }
    note = `Split down the middle: ${guilty.length} vs ${innocent.length}`;
  } else if (state.rule === 'guilty') {
    for (const uid of guilty) assignments.push({ uid, sips: 1, reason: 'Guilty 🙋' });
    note = `Guilty side drinks — ${guilty.length} caught`;
  } else if (state.rule === 'innocent') {
    for (const uid of innocent) assignments.push({ uid, sips: 1, reason: 'Innocent 🙅' });
    note = `Innocent side drinks — ${innocent.length} saints`;
  } else {
    const minority = guilty.length < innocent.length ? guilty : innocent;
    const label = guilty.length < innocent.length ? 'guilty' : 'innocent';
    for (const uid of minority) assignments.push({ uid, sips: 2, reason: 'Brave minority 🦄' });
    note = `Minority (${label}) drinks ×2 — ${minority.length} brave souls`;
  }

  return {
    state: { ...state, phase: 'reveal', votes, assignments, note },
    effects: [{ type: 'TIMER', ms: REVEAL_MS }],
  };
}

export const definition: GameDefinition<PromptsState, PromptsInput> = {
  id: 'prompts',
  name: 'Prompt Deck',
  emoji: '🫵',
  rules:
    'A "never have I ever" style prompt appears. Everyone votes honestly — the round rule decides which side drinks, and it changes every round!',
  minPlayers: 2,

  createInitialState(ctx: GameContext): PromptsState {
    const rules: Rule[] = ['guilty', 'innocent', 'minority'];
    return {
      prompt: pack[Math.floor(ctx.rng() * pack.length)].t,
      rule: rules[Math.floor(ctx.rng() * rules.length)],
      phase: 'vote',
      votes: {},
      assignments: [],
      note: null,
    };
  },

  reduce(state, event: GameEvent<PromptsInput>, ctx: GameContext): ReduceResult<PromptsState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: VOTE_MS }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase !== 'vote' || event.input == null) return { state };
      if (event.uid in (state.votes ?? {})) return { state };
      const votes = { ...(state.votes ?? {}), [event.uid]: !!event.input.vote };
      const next: PromptsState = { ...state, votes };
      if (Object.keys(votes).length >= ctx.players.length) return reveal(next, ctx);
      return { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'vote') return reveal(state, ctx);
      if (state.phase === 'reveal') {
        return { state, effects: [{ type: 'END', assignments: state.assignments, note: state.note }] };
      }
    }

    return { state };
  },

  View,
};

export default definition;
