/**
 * ============================================================
 *  POISONING THE DRINKS — one victim, everybody else pours
 * ============================================================
 * One player is picked at random to drink. There is ONE MORE CUP on
 * the table than there are players, and every other player secretly
 * poisons exactly one of them. Poisoners may pile onto the same cup:
 * the picks are blind, so nobody can tell what anyone else chose.
 *
 * The phone travels the poisoning order one player at a time, each
 * selecting a cup and locking it in before it moves on. The victim
 * picks last — hit a poisoned cup and they drink, find a clean one
 * and the round is simply over.
 *
 * Nothing here runs on a clock: every step waits for a lock-in, and
 * the host's skip button is the only way past a vanished phone.
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
/** cups on the table = players + this */
export const CUP_BONUS = 1;
const REVEAL_MS = 10_000;

export interface PoisonState {
  phase: 'pouring' | 'drinking' | 'reveal';
  /** players + CUP_BONUS — every cup is on the table from the start */
  cups: number;
  /** the random victim; everyone can see who it is */
  drinkerUid: string;
  /** everyone but the victim, shuffled: the order the phone travels in */
  order: string[];
  /** index into `order` — whose pour it is right now */
  turn: number;
  /**
   * poisonerUid → poisoned cup. Only ever rendered on the pourer's own
   * screen (see View): the whole game rests on picks staying private.
   * RTDB drops empty objects, so this can read back undefined.
   */
  poisons: Record<string, number>;
  /** the victim's locked cup */
  pick: number | null;
  assignments: DrinkAssignment[];
  note: string | null;
}

export interface PoisonInput {
  /** cup index (0-based) this player locked in */
  cup: number;
}

const nameOf = (players: PlayerInfo[], uid: string): string =>
  players.find((p) => p.uid === uid)?.name ?? '?';

function reveal(state: PoisonState, ctx: GameContext): ReduceResult<PoisonState> {
  const poisons = state.poisons ?? {};
  // no lock-in (round skipped, phone died) — fate picks the cup
  const pick = state.pick ?? Math.floor(ctx.rng() * state.cups);
  const hitters = Object.keys(poisons).filter((uid) => poisons[uid] === pick);
  const hit = hitters.length > 0;
  const assignments: DrinkAssignment[] = [];
  const effects: Effect[] = [{ type: 'TIMER', ms: REVEAL_MS }];

  if (hit) {
    // every poisoner who put something in that cup shares the kill
    const who = hitters.map((uid) => nameOf(ctx.players, uid)).join(' & ');
    assignments.push({
      uid: state.drinkerUid,
      sips: SIPS,
      reason: `Cup ${pick + 1} was poisoned — ☠️ ${who}`,
    });
    for (const uid of hitters) effects.push({ type: 'SCORE', uid, delta: 1 });
  }

  const note = hit
    ? `☠️ ${nameOf(ctx.players, state.drinkerUid)} drank cup ${pick + 1} — ${SIPS} sips`
    : `🍷 ${nameOf(ctx.players, state.drinkerUid)} picked cup ${pick + 1} — clean! Nobody drinks`;

  return { state: { ...state, phase: 'reveal', pick, assignments, note }, effects };
}

export const definition: GameDefinition<PoisonState, PoisonInput> = {
  id: 'poison',
  name: 'Poisoning the Drinks',
  emoji: '☠️',
  rules:
    "One of you is picked at random to drink. Everyone else secretly poisons ONE of the cups — there's one more cup than there are players, you're allowed to pick the same cup, and nobody sees anyone else's choice. The phone goes round and everyone locks in, then the drinker picks last. Poisoned cup → the drinker drinks 2. Clean cup → nothing happens at all.",
  minPlayers: 2,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): PoisonState {
    // shuffle once: the first name is the victim, the rest is the pour order
    const order = shuffled(
      ctx.players.map((p) => p.uid),
      ctx.rng,
    );
    const [drinkerUid, ...poisoners] = order;
    return {
      phase: poisoners.length > 0 ? 'pouring' : 'drinking',
      cups: order.length + CUP_BONUS,
      drinkerUid: drinkerUid ?? '',
      order: poisoners,
      turn: 0,
      poisons: {},
      pick: null,
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
      if (state.phase === 'reveal' || event.input == null) return { state };
      const cup = Math.floor(Number(event.input.cup));
      if (!Number.isInteger(cup) || cup < 0 || cup >= state.cups) return { state };

      if (state.phase === 'pouring') {
        // strictly one pour at a time: the phone is passed down the order
        if ((state.order ?? [])[state.turn] !== event.uid) return { state };
        if ((state.poisons ?? {})[event.uid] != null) return { state };
        const poisons = { ...(state.poisons ?? {}), [event.uid]: cup };
        const turn = state.turn + 1;
        const done = turn >= (state.order ?? []).length;
        // the last pourer hands the table to the victim
        return { state: { ...state, poisons, turn, phase: done ? 'drinking' : 'pouring' } };
      }

      if (state.phase === 'drinking') {
        if (event.uid !== state.drinkerUid || state.pick != null) return { state };
        return reveal({ ...state, pick: cup }, ctx);
      }

      return { state };
    }

    if (event.type === 'TIME_UP') {
      // Nothing in this game arms a timer, so this can only be a round left
      // over on a clock from elsewhere — resolve it rather than hang.
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
    if (state.phase === 'pouring') return (state.order ?? [])[state.turn] ?? null;
    if (state.phase === 'drinking') return state.drinkerUid ?? null;
    return null; // reveal: nobody needs the phone in their hand
  },

  View,
};

export default definition;
