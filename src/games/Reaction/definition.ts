import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

const GO_WINDOW_MS = 3000;

interface Tap {
  /** reaction time in ms; null = tapped early / never tapped */
  ms: number | null;
  early: boolean;
}

export interface RxState {
  phase: 'ready' | 'go' | 'done';
  goAt: number | null;
  taps: Record<string, Tap>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface RxInput {
  /** party mode: server-time of the tap */
  at?: number;
  /** shared mode: locally measured reaction time */
  reactionMs?: number;
  early?: boolean;
}

function finish(state: RxState, ctx: GameContext): ReduceResult<RxState> {
  const taps: Record<string, Tap> = { ...state.taps };
  for (const p of ctx.players) {
    if (!taps[p.uid]) taps[p.uid] = { ms: null, early: false };
  }

  const assignments: DrinkAssignment[] = [];
  const earlyUids = Object.entries(taps)
    .filter(([, t]) => t.early)
    .map(([uid]) => uid);
  const valid = Object.entries(taps).filter(([, t]) => !t.early && t.ms != null);

  for (const uid of earlyUids) {
    assignments.push({ uid, sips: 2, reason: 'Jumped the gun 🚨' });
  }

  if (valid.length >= 2) {
    const slowest = valid.reduce((a, b) => ((b[1].ms as number) > (a[1].ms as number) ? b : a));
    assignments.push({ uid: slowest[0], sips: 2, reason: 'Slowest finger 🐌' });
  }

  const effects: ReduceResult<RxState>['effects'] = [{ type: 'TIMER', ms: 2600 }];
  let note: string | null = null;
  if (valid.length > 0) {
    const fastest = valid.reduce((a, b) => ((b[1].ms as number) < (a[1].ms as number) ? b : a));
    const who = ctx.players.find((p) => p.uid === fastest[0]);
    note = `⚡ Fastest: ${who?.name ?? '?'} — ${((fastest[1].ms as number) / 1000).toFixed(2)}s`;
    effects.push({ type: 'SCORE', uid: fastest[0], delta: 1 });
  } else {
    note = earlyUids.length > 0 ? 'Everyone jumped the gun 🚨' : 'Nobody tapped 🤷';
  }

  return {
    state: { ...state, phase: 'done', taps, assignments, note },
    effects,
  };
}

export const definition: GameDefinition<RxState, RxInput> = {
  id: 'reaction',
  name: 'Reaction Duel',
  emoji: '⚡',
  rules:
    'Wait for GREEN, then tap as fast as you can. Tap early and you drink 2. When everyone plays, the slowest finger drinks 2.',
  minPlayers: 2,

  createInitialState(): RxState {
    return { phase: 'ready', goAt: null, taps: {}, assignments: [], note: null };
  },

  reduce(state, event: GameEvent<RxInput>, ctx: GameContext): ReduceResult<RxState> {
    if (event.type === 'BEGIN') {
      // random wait so nobody can pretime the green
      return { state, effects: [{ type: 'TIMER', ms: 2000 + Math.floor(ctx.rng() * 3000) }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase === 'done') return { state };
      const input = event.input ?? {};
      let tap: Tap;
      if (input.reactionMs != null) {
        // shared phone: time measured on-device for the current holder
        tap = { ms: Math.max(0, Math.min(9999, input.reactionMs)), early: !!input.early };
      } else {
        const early = !!input.early || state.phase === 'ready';
        tap = { ms: early ? null : Math.max(0, (input.at ?? ctx.now) - (state.goAt ?? ctx.now)), early };
      }
      const taps = { ...state.taps, [event.uid]: tap };
      const next: RxState = { ...state, taps };
      if (Object.keys(taps).length >= ctx.players.length) return finish(next, ctx);
      return { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'ready') {
        return {
          state: { ...state, phase: 'go', goAt: ctx.now },
          effects: [{ type: 'TIMER', ms: GO_WINDOW_MS }],
        };
      }
      if (state.phase === 'go') {
        return finish(state, ctx); // stragglers never tapped
      }
      if (state.phase === 'done') {
        return { state, effects: [{ type: 'END', assignments: state.assignments, note: state.note }] };
      }
    }

    return { state };
  },

  View,
};

export default definition;
