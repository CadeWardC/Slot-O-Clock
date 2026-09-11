/**
 * ============================================================
 *  HORSE RACE — bet on a runner, the field does the rest
 * ============================================================
 * Horses are neutral (nobody rides their own), so the round is a
 * bet: everyone picks a runner, the field races, and the money
 * decides who drinks.
 *
 *   - backed the actual winner  → you hand out a drink to anyone
 *   - backed the worst-placed horse ANYONE backed → you drink 3
 *   - backed the next-worst backed horse         → you drink 1
 *   - nobody backed the winner → everyone drinks 1 instead
 *
 * Like Boat Race before it, the race is decided in
 * createInitialState: each horse gets a finishing time, and the
 * animation interpolates those times against the engine's single
 * server-synced countdown, so every phone draws the same race.
 */

import { pick } from '../../engine/rng';
import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  ReduceResult,
} from '../../engine/types';
import { View } from './View';

/** Every runner finishes somewhere in [BASE_MS, BASE_MS + SPREAD_MS]. */
export const BASE_MS = 5200;
export const SPREAD_MS = 2400;
/** Total animation length: the slowest possible runner, plus a beat at the line. */
export const RACE_MS = BASE_MS + SPREAD_MS + 900;
export const BET_MS = 30_000;
export const GIFT_MS = 30_000;
const RESULT_MS = 8_000;
const LAST_SIPS = 3;
const SECOND_LAST_SIPS = 1;
const GIFT_SIPS = 1;
const PHOTO_FINISH_MS = 220;
const MAX_FIELD = 8;

/** Racing silks, so runners stay tellable apart on the track. */
const SILKS = [
  '#ffc94d',
  '#ff4fa3',
  '#4fd8ff',
  '#46e08b',
  '#ff5f6e',
  '#b07cff',
  '#ff9a4d',
  '#4de0d0',
];

const NAMES = [
  'Thunderhoof',
  'Hay There',
  'Neigh Sayer',
  'Pony Soprano',
  'Withering Heights',
  'Sir Trotsalot',
  'Mane Event',
  'Filly Cheesesteak',
  'Buckaroo',
  'Clip Clop',
  'Pony Danza',
  'Bucephalus',
];

export interface HrHorse {
  id: string;
  /** saddle-cloth number, 1..field */
  n: number;
  name: string;
  silk: string;
  /** finishing time in ms from the starting gun */
  timeMs: number;
}

export interface HrState {
  phase: 'betting' | 'racing' | 'gifting' | 'result';
  horses: HrHorse[];
  /** bettor uid → horse id */
  bets: Record<string, string>;
  /** uids whose bet the house placed for them when the clock ran out */
  auto: Record<string, boolean>;
  /** winning backer uid → the player they handed a drink to */
  gifts: Record<string, string>;
  /** finishing order, fastest first — filled at the line */
  order: string[];
  winnerHorseId: string | null;
  /** horse id → sips its backers owe (the loser 3, the next-worst 1) */
  penalties: Record<string, number>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export type HrInput =
  | { action: 'bet'; horseId: string }
  | { action: 'gift'; uid: string }
  /** shared-phone pass-along only — never touches the game state */
  | { action: 'wait' };

function backersOf(bets: Record<string, string>, horseId: string): string[] {
  return Object.entries(bets)
    .filter(([, id]) => id === horseId)
    .map(([uid]) => uid);
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Nobody should be left out of the race because they wandered off. */
function withAutoBets(state: HrState, ctx: GameContext): HrState {
  const horses = state.horses ?? [];
  const bets = { ...(state.bets ?? {}) };
  const auto = { ...(state.auto ?? {}) };
  if (horses.length === 0) return state;
  for (const p of ctx.players) {
    if (bets[p.uid] != null) continue;
    const horse = pick(horses, ctx.rng);
    bets[p.uid] = horse.id;
    auto[p.uid] = true;
  }
  return { ...state, bets, auto };
}

function toRacing(state: HrState): ReduceResult<HrState> {
  // no CLEAR_INPUTS here: every player already answered in the betting
  // phase, so the shared phone renders the race instead of the pass gate
  return { state: { ...state, phase: 'racing' }, effects: [{ type: 'TIMER', ms: RACE_MS }] };
}

function toResult(state: HrState, ctx: GameContext): ReduceResult<HrState> {
  const assignments = [...(state.assignments ?? [])];
  for (const [giverUid, targetUid] of Object.entries(state.gifts ?? {})) {
    const giver = ctx.players.find((p) => p.uid === giverUid);
    assignments.push({
      uid: targetUid,
      sips: GIFT_SIPS,
      reason: `🎁 a drink from ${giver?.name ?? 'the winner'}`,
    });
  }
  return {
    state: { ...state, phase: 'result', assignments },
    effects: [{ type: 'TIMER', ms: RESULT_MS }],
  };
}

function resolve(state: HrState, ctx: GameContext): ReduceResult<HrState> {
  const horses = state.horses ?? [];
  const bets = state.bets ?? {};
  const ranked = [...horses].sort((a, b) => a.timeMs - b.timeMs);
  const order = ranked.map((h) => h.id);
  const horseById = (id: string | null) => (id ? horses.find((h) => h.id === id) : undefined);
  const placeOf = (id: string) => order.indexOf(id) + 1;

  const winnerHorseId = order[0] ?? null;
  const winner = horseById(winnerHorseId);
  // only horses somebody actually backed count towards winning and losing
  const backed = order.filter((id) => backersOf(bets, id).length > 0);
  const winnerBacked = winnerHorseId != null && backed.includes(winnerHorseId);

  const rawLoser = backed.length >= 1 ? backed[backed.length - 1] : null;
  const rawSecondLast = backed.length >= 2 ? backed[backed.length - 2] : null;
  // the winner can't also be the loser — if it's the only backed horse, it just pays out
  const loserId = rawLoser && rawLoser !== winnerHorseId ? rawLoser : null;
  const secondLastId = rawSecondLast && rawSecondLast !== winnerHorseId ? rawSecondLast : null;

  const assignments: DrinkAssignment[] = [];
  const penalties: Record<string, number> = {};
  const effects: Effect[] = [];

  if (winnerHorseId && !winnerBacked && winner) {
    for (const p of ctx.players) {
      assignments.push({ uid: p.uid, sips: 1, reason: `Nobody backed ${winner.name} 🤷` });
    }
  }
  if (loserId) {
    const horse = horseById(loserId);
    penalties[loserId] = LAST_SIPS;
    for (const uid of backersOf(bets, loserId)) {
      assignments.push({
        uid,
        sips: LAST_SIPS,
        reason: `${horse?.name ?? '?'} flopped (${ordinal(placeOf(loserId))}) 🐌`,
      });
    }
  }
  if (secondLastId) {
    const horse = horseById(secondLastId);
    penalties[secondLastId] = SECOND_LAST_SIPS;
    for (const uid of backersOf(bets, secondLastId)) {
      assignments.push({
        uid,
        sips: SECOND_LAST_SIPS,
        reason: `${horse?.name ?? '?'} was nearly last (${ordinal(placeOf(secondLastId))})`,
      });
    }
  }
  if (winnerBacked && winnerHorseId) {
    for (const uid of backersOf(bets, winnerHorseId)) {
      effects.push({ type: 'SCORE', uid, delta: 1 });
    }
  }

  const tight = ranked.length >= 2 && ranked[1].timeMs - ranked[0].timeMs < PHOTO_FINISH_MS;
  const bits = [`🏇 ${winner?.name ?? '?'} wins${tight ? ' — photo finish 📸' : ''}!`];
  bits.push(winnerBacked ? 'its backers hand out drinks 🎁' : 'nobody backed it — everyone drinks 1 🤷');
  if (loserId) bits.push(`${horseById(loserId)?.name ?? '?'} lets its backers down 🐌`);
  const note = bits.join(' · ');

  const next: HrState = { ...state, order, winnerHorseId, assignments, penalties, note, gifts: {} };

  // the winners choose who drinks, so their phones need a phase of their own
  if (winnerBacked && winnerHorseId) {
    return {
      state: { ...next, phase: 'gifting' },
      effects: [...effects, { type: 'CLEAR_INPUTS' }, { type: 'TIMER', ms: GIFT_MS }],
    };
  }
  return { state: { ...next, phase: 'result' }, effects: [...effects, { type: 'TIMER', ms: RESULT_MS }] };
}

export const definition: GameDefinition<HrState, HrInput> = {
  id: 'horse-race',
  name: 'Horse Race',
  emoji: '🏇',
  rules:
    'Everyone bets on a horse, then the field races. Back the winner and you hand out a drink to anyone you like. Back the worst-placed horse anyone picked and you drink 3, the next-worst costs 1 — and if nobody backed the winner, everyone drinks 1.',
  minPlayers: 3,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): HrState {
    const field = Math.min(MAX_FIELD, Math.max(3, ctx.players.length));
    const horses: HrHorse[] = Array.from({ length: field }, (_, i) => ({
      id: `h${i + 1}`,
      n: i + 1,
      name: NAMES[i % NAMES.length],
      silk: SILKS[i % SILKS.length],
      timeMs: BASE_MS + ctx.rng() * SPREAD_MS,
    }));
    return {
      phase: 'betting',
      horses,
      bets: {},
      auto: {},
      gifts: {},
      order: [],
      winnerHorseId: null,
      penalties: {},
      assignments: [],
      note: null,
    };
  },

  reduce(state, event: GameEvent<HrInput>, ctx: GameContext): ReduceResult<HrState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: BET_MS }] };
    }

    if (event.type === 'INPUT') {
      const input = event.input;
      if (!input || input.action === 'wait') return { state };

      if (input.action === 'bet') {
        if (state.phase !== 'betting') return { state };
        if ((state.bets ?? {})[event.uid] != null) return { state }; // first bet is locked
        if (!(state.horses ?? []).some((h) => h.id === input.horseId)) return { state };
        const bets = { ...(state.bets ?? {}), [event.uid]: input.horseId };
        const next: HrState = { ...state, bets };
        const allIn = ctx.players.every((p) => bets[p.uid] != null);
        return allIn ? toRacing(next) : { state: next };
      }

      // gift: only the backers of the winning horse may hand one out
      if (state.phase !== 'gifting' || !state.winnerHorseId) return { state };
      if (!backersOf(state.bets ?? {}, state.winnerHorseId).includes(event.uid)) return { state };
      const target = input.uid;
      if (typeof target !== 'string' || target === event.uid) return { state };
      if (!ctx.players.some((p) => p.uid === target)) return { state };
      if ((state.gifts ?? {})[event.uid]) return { state }; // first gift is locked
      const gifts = { ...(state.gifts ?? {}), [event.uid]: target };
      const next: HrState = { ...state, gifts };
      const gifters = backersOf(state.bets ?? {}, state.winnerHorseId);
      const allGifted = gifters.every((uid) => gifts[uid] != null);
      return allGifted ? toResult(next, ctx) : { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'betting') return toRacing(withAutoBets(state, ctx));
      if (state.phase === 'racing') return resolve(state, ctx);
      if (state.phase === 'gifting') return toResult(state, ctx);
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
