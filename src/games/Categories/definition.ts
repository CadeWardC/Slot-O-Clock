import pack from '../../content/categories.json';
import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

const TARGET = 4;
const GIVE_UP_PENALTY = 2;

type Category = { c: string };
const CATEGORIES = pack as Category[];

export interface CatState {
  category: string;
  phase: 'naming' | 'done';
  /** penalty drinks stacked by the group while the actor stalls */
  pool: number;
  /** player currently holding the "+1 drink" button */
  punisherUid: string | null;
  resultLine: string | null;
}

export interface CatInput {
  action: 'done' | 'giveup' | 'penalty';
}

/** Next holder of the +1 button: follows the claimed order, skipping the actor. */
function nextPunisher(ctx: GameContext, current: string): string | null {
  const order = ctx.turnOrder.length > 0
    ? ctx.turnOrder
    : ctx.players.map((p) => p.uid);
  const ring = order.filter((uid) => uid !== ctx.actorUid && ctx.players.some((p) => p.uid === uid));
  if (ring.length === 0) return null;
  const idx = ring.indexOf(current);
  return ring[(idx + 1) % ring.length];
}

function randomPunisher(ctx: GameContext): string | null {
  const candidates = ctx.players.filter((p) => p.uid !== ctx.actorUid);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(ctx.rng() * candidates.length)].uid;
}

function finish(
  state: CatState,
  ctx: GameContext,
  gaveUp: boolean,
): ReduceResult<CatState> {
  const actor = ctx.players.find((p) => p.uid === ctx.actorUid) ?? ctx.players[0];
  const sips = state.pool + (gaveUp ? GIVE_UP_PENALTY : 0);
  const assignments: DrinkAssignment[] =
    sips > 0
      ? [
          {
            uid: actor.uid,
            sips,
            reason: gaveUp
              ? `Gave up 💀 (+${GIVE_UP_PENALTY} penalty)`
              : `Named all ${TARGET}! 🎓`,
          },
        ]
      : [];
  const resultLine = gaveUp
    ? `💀 ${actor.name} gave up — ${sips} drinks`
    : sips > 0
      ? `🎓 ${actor.name} did it — ${sips} drinks`
      : `🏆 ${actor.name} nailed it clean!`;
  return {
    state: { ...state, phase: 'done', resultLine },
    effects: [{ type: 'END', assignments, note: resultLine }],
  };
}

export const definition: GameDefinition<CatState, CatInput> = {
  id: 'categories',
  name: 'Categories',
  emoji: '🗂️',
  rules:
    'Name 4 things in the category before the group buries you: the +1 drink button jumps from player to player, stacking drinks on the namer. Done = drink what stacked. Give up = stacked + 2.',
  minPlayers: 2,
  sharedInput: 'actor',

  createInitialState(ctx: GameContext): CatState {
    return {
      category: CATEGORIES[Math.floor(ctx.rng() * CATEGORIES.length)].c,
      phase: 'naming',
      pool: 0,
      punisherUid: randomPunisher(ctx),
      resultLine: null,
    };
  },

  reduce(state, event: GameEvent<CatInput>, ctx: GameContext): ReduceResult<CatState> {
    if (event.type === 'BEGIN') {
      // safety net so a vanished actor can't stall the room forever
      return { state, effects: [{ type: 'TIMER', ms: 120000 }] };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (!input || state.phase !== 'naming') return { state };
      const iAmActor = event.uid === ctx.actorUid;

      if (input.action === 'done' && iAmActor) {
        return finish(state, ctx, false);
      }
      if (input.action === 'giveup' && iAmActor) {
        return finish(state, ctx, true);
      }
      if (input.action === 'penalty') {
        // party mode: only the current holder may stack a drink
        // shared phone: anyone (it's one phone for the whole group)
        if (ctx.settings.mode === 'party' && event.uid !== state.punisherUid) return { state };
        const punisherUid = state.punisherUid
          ? nextPunisher(ctx, state.punisherUid)
          : state.punisherUid;
        return { state: { ...state, pool: state.pool + 1, punisherUid } };
      }
      return { state };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'naming') return finish(state, ctx, true);
    }

    return { state };
  },

  View,
};

export default definition;
