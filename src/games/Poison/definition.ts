/**
 * ============================================================
 *  POISONING THE DRINKS — one victim, everybody else pours
 * ============================================================
 * One player is picked at random to drink. The cups sit in a ring on
 * the table — ONE MORE CUP than there are players — and every other
 * player secretly poisons exactly one of them. Poisoners may pile
 * onto the same cup, and a stacked cup hits harder.
 *
 * Then the table watches the victim sweat:
 *   - their hand hovering over a cup is public, live;
 *   - they get ONE sniff 👃 — it tells the whole table how many doses
 *     are in that cup and its two neighbours combined, never where;
 *   - the poisoners heckle with emoji (honestly or not);
 *   - one cup hides an antidote 💚 nobody knows about: land on it and
 *     the poison bounces back onto the crew.
 *
 * Party mode: every poisoner pours at the same time on their own
 * phone. Shared phone: the phone travels the pour order one player
 * at a time. Nothing but the final reveal runs on a clock: every
 * step waits for a lock-in, and the host's skip is the way past a
 * vanished phone.
 */

import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  PlayerInfo,
  ReduceResult,
} from '../../engine/types';
import { shuffled } from '../../engine/rng';
import { View } from './View';

/** what the victim drinks when they land on a poisoned cup */
export const SIPS = 2;
/** every extra poisoner stacked in the same cup adds this */
export const STACK_SIPS = 1;
/** what every poisoner drinks when the victim dodges the whole table */
export const MISS_SIPS = 1;
/** landing on the antidote makes the crew's miss cost this instead */
export const ANTIDOTE_MISS_SIPS = 2;
/** cups on the table = players + this */
export const CUP_BONUS = 1;
/** the staged reveal: lift → verdict → every cup turned over */
export const REVEAL_MS = 13_000;
/** heckles the poisoners can throw while the victim chooses */
export const REACTIONS = ['😈', '😇', '😬', '🤣', '👀', '🥶'] as const;

export interface PoisonState {
  phase: 'pouring' | 'drinking' | 'reveal';
  /** players + CUP_BONUS — every cup is on the table from the start */
  cups: number;
  /** the random victim; everyone can see who it is */
  drinkerUid: string;
  /** everyone but the victim, shuffled: the order a shared phone travels in */
  order: string[];
  /** how many pours are locked in */
  turn: number;
  /**
   * poisonerUid → poisoned cup. Only ever rendered on the pourer's own
   * screen (see View): the whole game rests on picks staying private.
   * RTDB drops empty objects, so this can read back undefined.
   */
  poisons: Record<string, number>;
  /** the cup hiding the antidote — a secret from everyone until the reveal */
  antidoteCup: number;
  /** the cup the victim's hand is over right now (public, not a commitment) */
  hover: number | null;
  /** the victim's one sniff: doses in `cup` and both its neighbours */
  sniff: { cup: number; count: number } | null;
  /** poisonerUid → their latest heckle */
  reactions: Record<string, { e: string; at: number }>;
  /** the victim's locked cup */
  pick: number | null;
  /** server time the reveal started — the staging on every phone runs off it */
  revealAt: number | null;
  outcome: 'hit' | 'clean' | 'antidote' | null;
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface PoisonInput {
  /** cup index (0-based) this player locks in (a pour, or the victim's drink) */
  cup?: number;
  /** victim only: where the hand is hovering (null = hand off the table) */
  hover?: number | null;
  /** victim only, once: sniff this cup */
  sniff?: number;
  /** poisoners, while the victim chooses: throw a heckle */
  react?: string;
}

const nameOf = (players: PlayerInfo[], uid: string): string =>
  players.find((p) => p.uid === uid)?.name ?? '?';

/** the cup itself plus the one on each side — the table is a ring */
export function sniffZone(cup: number, cups: number): number[] {
  if (cups <= 3) return Array.from({ length: cups }, (_, c) => c);
  return [(cup - 1 + cups) % cups, cup, (cup + 1) % cups];
}

function validCup(raw: unknown, cups: number): number | null {
  const cup = Math.floor(Number(raw));
  return Number.isInteger(cup) && cup >= 0 && cup < cups ? cup : null;
}

function reveal(state: PoisonState, ctx: GameContext): ReduceResult<PoisonState> {
  const poisons = state.poisons ?? {};
  // no lock-in (round skipped, phone died) — fate picks the cup
  const pick = state.pick ?? Math.floor(ctx.rng() * state.cups);
  const pourers = Object.keys(poisons);
  const hitters = pourers.filter((uid) => poisons[uid] === pick);
  const hit = hitters.length > 0;
  const antidote = pick === state.antidoteCup;
  const drinker = nameOf(ctx.players, state.drinkerUid);
  const assignments: DrinkAssignment[] = [];
  const effects: Effect[] = [{ type: 'TIMER', ms: REVEAL_MS }];
  const dose = SIPS + STACK_SIPS * Math.max(0, hitters.length - 1);
  let note: string;
  let outcome: PoisonState['outcome'];

  if (antidote && pourers.length > 0) {
    outcome = 'antidote';
    if (hit) {
      // the poison bounces: whoever spiked this cup drinks their own dose
      for (const uid of hitters) {
        assignments.push({ uid, sips: dose, reason: `Cup ${pick + 1} hid the antidote — your poison bounced 💚` });
      }
      const who = hitters.map((uid) => nameOf(ctx.players, uid)).join(' & ');
      note = `💚 ${drinker} found the antidote in cup ${pick + 1} — the poison bounces back on ${who} (${dose})`;
    } else {
      for (const uid of pourers) {
        assignments.push({ uid, sips: ANTIDOTE_MISS_SIPS, reason: `Cup ${pick + 1} was the antidote — the whole crew pays 💚` });
      }
      note = `💚 ${drinker} found the antidote in cup ${pick + 1} — every poisoner drinks ${ANTIDOTE_MISS_SIPS}`;
    }
    effects.push({ type: 'SCORE', uid: state.drinkerUid, delta: 1 });
  } else if (hit) {
    outcome = 'hit';
    // every poisoner who put something in that cup shares the kill
    const who = hitters.map((uid) => nameOf(ctx.players, uid)).join(' & ');
    assignments.push({
      uid: state.drinkerUid,
      sips: dose,
      reason:
        hitters.length > 1
          ? `Cup ${pick + 1} was poisoned ×${hitters.length} — ☠️ ${who}`
          : `Cup ${pick + 1} was poisoned — ☠️ ${who}`,
    });
    for (const uid of hitters) effects.push({ type: 'SCORE', uid, delta: 1 });
    note =
      hitters.length > 1
        ? `☠️ ${drinker} drank cup ${pick + 1} — a ×${hitters.length} dose, ${dose} sips`
        : `☠️ ${drinker} drank cup ${pick + 1} — ${dose} sips`;
  } else if (pourers.length > 0) {
    outcome = 'clean';
    // a clean cup means the whole table missed: everyone who poured drinks
    for (const uid of pourers) {
      assignments.push({ uid, sips: MISS_SIPS, reason: `Cup ${pick + 1} was clean — the poison missed 🍷` });
    }
    note =
      pourers.length === 1
        ? `🍷 ${drinker} picked cup ${pick + 1} — clean! The poisoner drinks ${MISS_SIPS}`
        : `🍷 ${drinker} picked cup ${pick + 1} — clean! All ${pourers.length} poisoners drink ${MISS_SIPS}`;
    effects.push({ type: 'SCORE', uid: state.drinkerUid, delta: 1 });
  } else {
    outcome = 'clean';
    // nobody ever poured (round force-skipped) — nothing to punish
    note = `🍷 ${drinker} picked cup ${pick + 1} — clean! Nobody drinks`;
  }

  return {
    state: { ...state, phase: 'reveal', pick, hover: null, revealAt: ctx.now, outcome, assignments, note },
    effects,
  };
}

export const definition: GameDefinition<PoisonState, PoisonInput> = {
  id: 'poison',
  name: 'Poisoning the Drinks',
  emoji: '☠️',
  rules:
    "One of you is picked at random to drink. Everyone else secretly poisons ONE cup in the ring — there's one more cup than players, and you can pile onto the same cup to make it hit harder. Then the drinker chooses while the table watches their hand: they get ONE sniff 👃 (how many doses are in that cup + its two neighbours), and the poisoners can heckle. Poisoned cup → the drinker drinks 2, +1 per extra poisoner in it. Clean cup → every poisoner drinks 1. And one cup secretly hides an antidote 💚 — land on it and the poison bounces back on the crew.",
  minPlayers: 2,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): PoisonState {
    // shuffle once: the first name is the victim, the rest is the pour order
    const order = shuffled(
      ctx.players.map((p) => p.uid),
      ctx.rng,
    );
    const [drinkerUid, ...poisoners] = order;
    const cups = order.length + CUP_BONUS;
    return {
      phase: poisoners.length > 0 ? 'pouring' : 'drinking',
      cups,
      drinkerUid: drinkerUid ?? '',
      order: poisoners,
      turn: 0,
      poisons: {},
      antidoteCup: Math.floor(ctx.rng() * cups),
      hover: null,
      sniff: null,
      reactions: {},
      pick: null,
      revealAt: null,
      outcome: null,
      assignments: [],
      note: null,
    };
  },

  reduce(state, event: GameEvent<PoisonInput>, ctx: GameContext): ReduceResult<PoisonState> {
    if (event.type === 'BEGIN') {
      // nothing is timed — the round waits for lock-ins, not for a clock
      return { state };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (state.phase === 'reveal' || input == null) return { state };
      const order = state.order ?? [];
      const poisons = state.poisons ?? {};

      if (state.phase === 'pouring') {
        const cup = validCup(input.cup, state.cups);
        if (cup == null) return { state };
        if (!order.includes(event.uid) || poisons[event.uid] != null) return { state };
        // a shared phone is passed strictly down the order; in party mode
        // everybody pours on their own phone at once
        if (ctx.settings.mode === 'shared' && order.find((uid) => poisons[uid] == null) !== event.uid) {
          return { state };
        }
        const next = { ...poisons, [event.uid]: cup };
        const turn = Object.keys(next).length;
        const done = order.every((uid) => next[uid] != null);
        // the last pour hands the table to the victim
        return { state: { ...state, poisons: next, turn, phase: done ? 'drinking' : 'pouring' } };
      }

      // ---- drinking ----
      if (event.uid !== state.drinkerUid) {
        // the crew can only heckle
        if (typeof input.react !== 'string' || !(REACTIONS as readonly string[]).includes(input.react)) {
          return { state };
        }
        if (!order.includes(event.uid)) return { state };
        return {
          state: {
            ...state,
            reactions: { ...(state.reactions ?? {}), [event.uid]: { e: input.react, at: ctx.now } },
          },
        };
      }

      if (state.pick != null) return { state };

      if (input.cup != null) {
        const cup = validCup(input.cup, state.cups);
        if (cup == null) return { state };
        return reveal({ ...state, pick: cup }, ctx);
      }

      if (input.sniff != null) {
        const cup = validCup(input.sniff, state.cups);
        if (cup == null || state.sniff != null) return { state };
        const zone = sniffZone(cup, state.cups);
        const count = Object.values(poisons).filter((c) => zone.includes(c)).length;
        return { state: { ...state, sniff: { cup, count }, hover: cup } };
      }

      if ('hover' in input) {
        const hover = input.hover == null ? null : validCup(input.hover, state.cups);
        if (hover === (state.hover ?? null)) return { state };
        return { state: { ...state, hover } };
      }

      return { state };
    }

    if (event.type === 'TIME_UP') {
      // Only the reveal arms a timer; anything else is a round left over on
      // a clock from elsewhere — resolve it rather than hang.
      if (state.phase !== 'reveal') return reveal(state, ctx);
      return {
        state,
        effects: [{ type: 'END', assignments: state.assignments ?? [], note: state.note }],
      };
    }

    return { state };
  },

  /** the phone travels the pour order, then lands on the victim */
  sharedHolderUid(state: PoisonState): string | null {
    if (state.phase === 'pouring') {
      const poisons = state.poisons ?? {};
      return (state.order ?? []).find((uid) => poisons[uid] == null) ?? null;
    }
    if (state.phase === 'drinking') return state.drinkerUid ?? null;
    return null; // reveal: nobody needs the phone in their hand
  },

  View,
};

export default definition;
