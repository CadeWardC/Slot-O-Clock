import pack from '../../content/categories.json';
import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

export const TARGET = 4;
export const GIVE_UP_PENALTY = 2;
/** the namer's head start: nobody can stack a drink while this runs */
export const THINK_MS = 3_000;
/** the +1 button has to recharge after every tap, whoever holds it next */
export const COOLDOWN_MS = 2_500;
/** safety net so a vanished namer can't stall the room forever */
export const NAMING_MS = 120_000;

type Category = { c: string };
const CATEGORIES = pack as Category[];

export interface CatState {
  category: string;
  /** 'think' = the 3-second head start; the +1 button is locked for everyone */
  phase: 'think' | 'naming' | 'done';
  /** penalty drinks stacked by the group while the actor stalls */
  pool: number;
  /** player currently holding the "+1 drink" button */
  punisherUid: string | null;
  /** server time the +1 button comes back to life (0 = it is live) */
  nextAt: number;
  /** who landed the last +1 — the view celebrates the hit */
  lastHitUid: string | null;
  gaveUp: boolean;
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
    state: { ...state, phase: 'done', gaveUp, resultLine },
    effects: [{ type: 'END', assignments, note: resultLine }],
  };
}

export const definition: GameDefinition<CatState, CatInput> = {
  id: 'categories',
  name: 'Categories',
  emoji: '🗂️',
  rules:
    'Name 4 things in the category out loud before the group buries you. You get a 3-second head start to think — then the +1 drink button goes live and jumps from player to player, stacking drinks on you (it needs a moment to recharge between taps). Done = drink what stacked. Give up = stacked + 2.',
  minPlayers: 2,
  sharedInput: 'actor',

  createInitialState(ctx: GameContext): CatState {
    return {
      category: CATEGORIES[Math.floor(ctx.rng() * CATEGORIES.length)].c,
      phase: 'think',
      pool: 0,
      punisherUid: randomPunisher(ctx),
      nextAt: 0,
      lastHitUid: null,
      gaveUp: false,
      resultLine: null,
    };
  },

  reduce(state, event: GameEvent<CatInput>, ctx: GameContext): ReduceResult<CatState> {
    if (event.type === 'BEGIN') {
      // the namer reads the category and thinks; nobody can punish yet
      return { state, effects: [{ type: 'TIMER', ms: THINK_MS }] };
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
        // still recharging — a tap that beat the cooldown simply doesn't count
        // (a little slack so a phone whose clock runs a touch fast isn't robbed)
        if (ctx.now < (state.nextAt ?? 0) - 150) return { state };
        const punisherUid = state.punisherUid
          ? nextPunisher(ctx, state.punisherUid)
          : state.punisherUid;
        return {
          state: {
            ...state,
            pool: state.pool + 1,
            punisherUid,
            nextAt: ctx.now + COOLDOWN_MS,
            lastHitUid: event.uid,
          },
        };
      }
      return { state };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'think') {
        return { state: { ...state, phase: 'naming', nextAt: 0 }, effects: [{ type: 'TIMER', ms: NAMING_MS }] };
      }
      if (state.phase === 'naming') return finish(state, ctx, true);
    }

    return { state };
  },

  View,
};

export default definition;
