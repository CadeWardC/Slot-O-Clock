/**
 * ============================================================
 *  BOAT RACE — everyone races, last two drink
 * ============================================================
 * The whole race is decided the moment the round starts: each
 * vessel gets a finishing time in createInitialState, and the
 * ~8s animation on every phone is just a rendering of those
 * numbers against the engine's server-synced countdown. So all
 * phones show the identical race, and the host needs exactly one
 * timer to run it.
 */

import { shuffled } from '../../engine/rng';
import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

/** Every vessel finishes somewhere in [BASE_MS, BASE_MS + SPREAD_MS]. */
export const BASE_MS = 5200;
export const SPREAD_MS = 2400;
/** Total animation length: the slowest possible vessel, plus a beat at the line. */
export const RACE_MS = BASE_MS + SPREAD_MS + 900;
/** Whoever has drunk the most starts a length behind. */
export const HANDICAP_MS = 700;

export const SET_SAIL_MS = 30_000; // safety net: sail without anyone who wandered off
const RESULT_MS = 7_000;
const LAST_SIPS = 3;
const SECOND_LAST_SIPS = 1;
const PHOTO_FINISH_MS = 220;

/** Vessels are flavour — the marker on the track is each player's own emoji. */
const VESSELS: { emoji: string; name: string }[] = [
  { emoji: '🛶', name: 'SS Hangover' },
  { emoji: '⛵', name: 'Tipsy Breeze' },
  { emoji: '🚤', name: 'Last Orders' },
  { emoji: '🛥️', name: 'The Regret' },
  { emoji: '⛴️', name: 'HMS Why Not' },
  { emoji: '🚣', name: 'Row Zed' },
  { emoji: '🛟', name: 'Float Ya Boat' },
  { emoji: '🦆', name: 'Duck Speed' },
  { emoji: '🛁', name: 'The Bathtub' },
  { emoji: '🧊', name: 'Iceberg Ahead' },
];

export interface BrLeg {
  uid: string;
  vessel: string;
  vesselName: string;
  /** finishing time in ms from the starting gun */
  timeMs: number;
  /** started a length behind (drink leader) */
  handicap: boolean;
}

export interface BrState {
  phase: 'mounting' | 'racing' | 'result';
  legs: BrLeg[];
  /** uid → tapped SET SAIL */
  sailed: Record<string, boolean>;
  /** finishing order, fastest first — filled at the line */
  order: string[];
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface BrInput {
  action: 'sail';
}

function startRace(state: BrState): ReduceResult<BrState> {
  return {
    state: { ...state, phase: 'racing' },
    effects: [{ type: 'TIMER', ms: RACE_MS }],
  };
}

function finish(state: BrState, ctx: GameContext): ReduceResult<BrState> {
  const legs = [...(state.legs ?? [])].sort((a, b) => a.timeMs - b.timeMs);
  const nameOf = (uid: string) => ctx.players.find((p) => p.uid === uid)?.name ?? 'someone';

  const winner = legs[0];
  const last = legs[legs.length - 1];
  const secondLast = legs[legs.length - 2];

  const assignments: DrinkAssignment[] = [];
  if (legs.length >= 2 && last) {
    assignments.push({ uid: last.uid, sips: LAST_SIPS, reason: `${last.vesselName} came last 🛟` });
  }
  if (legs.length >= 3 && secondLast) {
    assignments.push({
      uid: secondLast.uid,
      sips: SECOND_LAST_SIPS,
      reason: 'Only just stayed afloat ⛵',
    });
  }

  const effects: Effect[] = [{ type: 'TIMER', ms: RESULT_MS }];
  if (winner) effects.push({ type: 'SCORE', uid: winner.uid, delta: 1 });

  const tight = legs.length >= 2 && legs[1].timeMs - legs[0].timeMs < PHOTO_FINISH_MS;
  const note = winner
    ? `🏁 ${winner.vesselName} (${nameOf(winner.uid)}) takes it${tight ? ' — photo finish 📸' : ''}!`
    : null;

  return {
    state: {
      ...state,
      phase: 'result',
      order: legs.map((l) => l.uid),
      assignments,
      note,
    },
    effects,
  };
}

export const definition: GameDefinition<BrState, BrInput> = {
  id: 'boat-race',
  name: 'Boat Race',
  emoji: '⛵',
  rules:
    'Everyone gets a random vessel. Tap SET SAIL, then watch the ~8 second sprint — last place drinks 3, second-last drinks 1. Whoever has drunk the most starts a length behind 🍺.',
  minPlayers: 2,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): BrState {
    const table = shuffled(VESSELS, ctx.rng);
    // only a clear drink leader gets the handicap — nobody is "behind" at 0
    const top = Math.max(...ctx.players.map((p) => p.drinkCount ?? 0));
    const leaders = ctx.players.filter((p) => (p.drinkCount ?? 0) === top);
    const handicapUid = top > 0 && leaders.length === 1 ? leaders[0].uid : null;

    const legs: BrLeg[] = ctx.players.map((p, i) => {
      const vessel = table[i % table.length];
      const handicap = p.uid === handicapUid;
      return {
        uid: p.uid,
        vessel: vessel.emoji,
        vesselName: vessel.name,
        timeMs: BASE_MS + ctx.rng() * SPREAD_MS + (handicap ? HANDICAP_MS : 0),
        handicap,
      };
    });

    return { phase: 'mounting', legs, sailed: {}, order: [], assignments: [], note: null };
  },

  reduce(state, event: GameEvent<BrInput>, ctx: GameContext): ReduceResult<BrState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: SET_SAIL_MS }] };
    }

    if (event.type === 'INPUT') {
      if (state.phase !== 'mounting' || event.input?.action !== 'sail') return { state };
      const sailed = { ...(state.sailed ?? {}), [event.uid]: true };
      const next: BrState = { ...state, sailed };
      const allIn = (state.legs ?? []).every((l) => sailed[l.uid]);
      return allIn ? startRace(next) : { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'mounting') return startRace(state);
      if (state.phase === 'racing') return finish(state, ctx);
      if (state.phase === 'result') {
        return {
          state,
          effects: [{ type: 'END', assignments: state.assignments ?? [], note: state.note }],
        };
      }
    }

    return { state };
  },

  View,
};

export default definition;
