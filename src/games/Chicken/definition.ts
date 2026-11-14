import type {
  DrinkAssignment,
  GameContext,
  GameDefinition,
  GameEvent,
  OutcomeRecap,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

/**
 * ============================================================
 *  Chicken 🐔
 * ============================================================
 * Everyone holds a thumb on the button while a drink counter climbs. Let go
 * and you bank what the counter says, to hand out. Stay on too long and the
 * counter busts: whoever is still holding drinks it instead.
 *
 * The counter is a pure function of server time since the climb started, so
 * every phone shows the same number without a write per tick. The bust moment
 * is drawn from the round's rng and only ever armed as the engine timer: it is
 * never stored in the state, so no phone can read it ahead of time.
 */

/** "thumb down" lead-in before the counter starts */
export const READY_MS = 3000;
/** how long the first drink takes to show; every one after comes a little quicker */
export const TICK_MS = 1500;
/** the counter never goes past this */
export const MAX_VALUE = 10;
/** the earliest and latest the counter can bust, measured from the climb's start */
export const BUST_MIN_MS = 3000;
export const BUST_MAX_MS = 14000;
/** how far back a bail's own timestamp is trusted, so lag costs nobody a drink */
export const BAIL_GRACE_MS = 1500;
/** what the last thumb standing gets on top of the counter */
export const LAST_THUMB_BONUS = 2;
/** how long the bust stays on screen before the round moves on */
export const BUST_SHOW_MS = 3500;
/** how long the bankers get to hand their drinks out */
export const GIFT_MS = 25_000;

/**
 * The counter `ms` after the climb started: 1 after a second and a half, then
 * quicker and quicker, flat at MAX_VALUE from about ten and a half seconds in
 * (roughly half of all rounds bust before it gets there).
 */
export function valueAt(ms: number): number {
  if (!(ms > 0)) return 0;
  return Math.max(0, Math.min(MAX_VALUE, Math.floor(Math.pow(ms / TICK_MS, 1 / 0.85) + 1e-9)));
}

/** ms into the climb at which the counter first shows `value` (the view's "next tick") */
export function timeOf(value: number): number {
  return Math.ceil(TICK_MS * Math.pow(Math.max(0, value), 0.85));
}

/**
 * When this round busts. Skewed late (sqrt) so a three-second bust happens,
 * just not often. The engine reseeds `ctx.rng` from the round id on every
 * reducer call, so the first draw is the same number each time it is asked.
 */
export function bustMsOf(ctx: GameContext): number {
  return Math.round(BUST_MIN_MS + (BUST_MAX_MS - BUST_MIN_MS) * Math.sqrt(ctx.rng()));
}

export interface CkState {
  phase: 'ready' | 'climb' | 'bust' | 'gift';
  /** server time the counter starts (announced in 'ready', made exact in 'climb') */
  climbAt: number | null;
  /** uid -> what they let go at (the last thumb's includes the bonus) */
  banks: Record<string, number>;
  /** who won by being the only one left holding */
  lastThumb: string | null;
  /** the counter when it bust; null if everyone got out */
  bustValue: number | null;
  /** who was still holding at the bust */
  busted: string[];
  /** giver -> { receiver -> drinks } */
  gifts: Record<string, Record<string, number>>;
}

export type CkInput =
  /** thumb came off; `at` is the phone's own server-time reading of when */
  | { action: 'bail'; at?: number }
  /** a banker's whole hand-out, in one go */
  | { action: 'gift'; give?: Record<string, number> };

/** who is playing: the whole table, or just the actor on a shared phone */
function seatsOf(ctx: GameContext): string[] {
  if (ctx.settings.mode === 'shared') {
    const actor = ctx.players.find((p) => p.uid === ctx.actorUid) ?? ctx.players[0];
    return actor ? [actor.uid] : [];
  }
  return ctx.players.map((p) => p.uid);
}

function nameOf(ctx: GameContext, uid: string): string {
  return ctx.players.find((p) => p.uid === uid)?.name ?? '?';
}

/** everyone with something to hand out */
function bankersOf(state: CkState): string[] {
  return Object.entries(state.banks ?? {})
    .filter(([, n]) => n > 0)
    .map(([uid]) => uid);
}

function finish(state: CkState, ctx: GameContext): ReduceResult<CkState> {
  const banks = state.banks ?? {};
  const busted = state.busted ?? [];
  const assignments: DrinkAssignment[] = [];

  for (const uid of busted) {
    assignments.push({
      uid,
      sips: Math.max(1, state.bustValue ?? 1),
      reason: `Still holding when it bust at ${state.bustValue ?? 0}`,
    });
  }
  for (const [giver, give] of Object.entries(state.gifts ?? {})) {
    for (const [uid, n] of Object.entries(give ?? {})) {
      if (n > 0) assignments.push({ uid, sips: n, reason: `From ${nameOf(ctx, giver)}` });
    }
  }

  const bailed = Object.keys(banks);
  const recap: OutcomeRecap = {
    title: 'Who let go',
    groups: [
      { label: 'Got out', tone: 'good', uids: bailed },
      { label: 'Bust', tone: 'bad', uids: busted },
    ],
  };

  let note: string;
  if (state.lastThumb) {
    note = `${nameOf(ctx, state.lastThumb)} held longest and banked ${banks[state.lastThumb] ?? 0}.`;
  } else if (busted.length > 0) {
    note = `It bust at ${state.bustValue ?? 0}. ${busted.length} still holding.`;
  } else {
    note = 'Everyone got out.';
  }

  return { state, effects: [{ type: 'END', assignments, note, recap }] };
}

/** the climb is over without a bust: hand-outs if anyone banked, else straight to the end */
function afterClimb(state: CkState, ctx: GameContext): ReduceResult<CkState> {
  if (bankersOf(state).length === 0) return finish(state, ctx);
  return { state: { ...state, phase: 'gift', gifts: {} }, effects: [{ type: 'TIMER', ms: GIFT_MS }] };
}

export const definition: GameDefinition<CkState, CkInput> = {
  id: 'chicken',
  name: 'Chicken',
  emoji: '🐔',
  rules:
    'Hold your thumb down while the drink counter climbs. Let go and you hand out whatever it says. If it busts while you are still holding, you drink it yourself.',
  minPlayers: 2,
  sharedInput: 'actor',

  createInitialState(): CkState {
    return {
      phase: 'ready',
      climbAt: null,
      banks: {},
      lastThumb: null,
      bustValue: null,
      busted: [],
      gifts: {},
    };
  },

  reduce(state, event: GameEvent<CkInput>, ctx: GameContext): ReduceResult<CkState> {
    if (event.type === 'BEGIN') {
      return {
        state: { ...state, climbAt: ctx.now + READY_MS },
        effects: [{ type: 'TIMER', ms: READY_MS }],
      };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'ready') {
        // the counter starts now; the only trace of the bust moment is this timer
        return {
          state: { ...state, phase: 'climb', climbAt: ctx.now },
          effects: [{ type: 'TIMER', ms: bustMsOf(ctx) }],
        };
      }
      if (state.phase === 'climb') {
        const banks = state.banks ?? {};
        const busted = seatsOf(ctx).filter((uid) => banks[uid] == null);
        const bustValue = Math.max(1, valueAt(bustMsOf(ctx)));
        const next: CkState = { ...state, phase: 'bust', busted, bustValue };
        return { state: next, effects: [{ type: 'TIMER', ms: BUST_SHOW_MS }] };
      }
      if (state.phase === 'bust') return afterClimb(state, ctx);
      if (state.phase === 'gift') return finish(state, ctx);
      return { state };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (!input) return { state };

      if (input.action === 'bail') {
        if (state.phase !== 'climb' || state.climbAt == null) return { state };
        const seats = seatsOf(ctx);
        const banks = state.banks ?? {};
        if (!seats.includes(event.uid) || banks[event.uid] != null) return { state };

        // the phone's own reading of when the thumb came off, within reason:
        // never ahead of the host's clock, never further back than the grace,
        // never before the counter started
        const claimed = typeof input.at === 'number' && Number.isFinite(input.at) ? input.at : ctx.now;
        const at = Math.max(state.climbAt, Math.max(ctx.now - BAIL_GRACE_MS, Math.min(ctx.now, claimed)));
        const nextBanks = { ...banks, [event.uid]: valueAt(at - state.climbAt) };
        let next: CkState = { ...state, banks: nextBanks };

        const holding = seats.filter((uid) => nextBanks[uid] == null);
        if (holding.length === 1 && seats.length > 1) {
          // one thumb left: they win it on the spot, before it can bust
          const last = holding[0];
          const won = valueAt(ctx.now - state.climbAt) + LAST_THUMB_BONUS;
          next = { ...next, banks: { ...nextBanks, [last]: won }, lastThumb: last };
          return afterClimb(next, ctx);
        }
        if (holding.length === 0) return afterClimb(next, ctx);
        return { state: next };
      }

      if (input.action === 'gift') {
        if (state.phase !== 'gift') return { state };
        const bank = (state.banks ?? {})[event.uid] ?? 0;
        const gifts = state.gifts ?? {};
        if (bank <= 0 || gifts[event.uid]) return { state };

        // deal only what was banked, only to other players at the table
        const give: Record<string, number> = {};
        let left = bank;
        for (const [uid, raw] of Object.entries(input.give ?? {})) {
          if (left <= 0) break;
          if (uid === event.uid || !ctx.players.some((p) => p.uid === uid)) continue;
          const n = Math.min(left, Math.max(0, Math.floor(Number(raw) || 0)));
          if (n > 0) {
            give[uid] = n;
            left -= n;
          }
        }
        // RTDB drops an empty object, which would read back as "has not dealt yet"
        const nextGifts = { ...gifts, [event.uid]: Object.keys(give).length > 0 ? give : { _: 0 } };
        const next: CkState = { ...state, gifts: nextGifts };
        if (bankersOf(next).every((uid) => nextGifts[uid] != null)) return finish(next, ctx);
        return { state: next };
      }
    }

    return { state };
  },

  View,
};

export default definition;
