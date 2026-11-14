/**
 * ============================================================
 *  HORSE RACE — bet on a runner, the field does the rest
 * ============================================================
 * Horses are neutral (nobody rides their own), so the round is a
 * bet: everyone picks a runner, the field races, and the money
 * decides who drinks.
 *
 * Every bet carries a stake — as many drinks as the bettor dares:
 *
 *   - backed the winner → you hand out your stake, split however you like
 *   - backed anything else → you drink your own stake
 *   - backed the worst-placed horse ANYONE backed → one more on top
 *
 * The race is decided in createInitialState, and it is written to be a
 * *race*: one lap of the oval, with a pace profile per horse — a list of
 * gaps to an even reference pace at fixed points of the lap. The profiles
 * are built from a running order per checkpoint, so the lead changes hands
 * by construction, the eventual winner sits off the pace and only gets up in
 * the home straight, and the first two cross within a neck of each other.
 * `raceProgress` is a pure function of (horse, elapsed), and elapsed comes
 * off the engine's single server-synced countdown, so every phone draws the
 * same overtakes at the same moment.
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

/** The field is held at the gate for this long before the tape goes up. */
export const GATE_MS = 1800;
/** The winner's lap, gun to line. Everybody else is home within TAIL of it. */
export const LAP_MS = 19_000;
/** How far behind the winner (as a fraction of a lap) the last horse may finish. */
const MAX_BEHIND = 0.11;
/** A beat at the line once the whole field is home. */
const LINE_BEAT_MS = 1400;
/** Total animation length: gate + the slowest possible lap + a beat at the line. */
export const RACE_MS = GATE_MS + Math.round(LAP_MS * (1 + MAX_BEHIND)) + LINE_BEAT_MS;
/**
 * Checkpoints of the lap, as fractions of LAP_MS. A horse's `pace[k]` is its
 * gap to an even pace at KNOTS[k + 1] (negative = behind); past the last one
 * the gap is held, so the finishing time follows directly from it.
 */
export const KNOTS = [0, 0.1, 0.22, 0.34, 0.46, 0.58, 0.69, 0.79, 0.88, 0.965];
/** The fewest times the lead must change hands for a race to be allowed out. */
export const MIN_LEAD_CHANGES = 4;
export const BET_MS = 30_000;
export const GIFT_MS = 30_000;
const RESULT_MS = 8_000;
/** The most drinks one bet may carry. */
export const MAX_STAKE = 10;
/** On top of the stake, for whoever backed the worst-placed horse anyone picked. */
export const SPOON_SIPS = 1;
export const PHOTO_FINISH_MS = 190;
const MAX_FIELD = 8;

/** Racing silks, so runners stay tellable apart on the track. */
const SILKS = [
  '#f6b92b',
  '#ff5a45',
  '#7fd4e6',
  '#f7efdc',
  '#ff7fa8',
  '#4a90d9',
  '#ff9a3d',
  '#7be0a0',
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

/** Paddock gossip — colour for the card, and no help at all in picking. */
const QUIRKS = [
  'ate a whole pizza this morning',
  'afraid of its own shadow',
  'trained exclusively on carrots',
  'owes the jockey money',
  'thinks this is dressage',
  'has never lost (or raced)',
  'ran here from the pub',
  'allergic to grass',
  'in it for the sugar cubes',
  'vibes: immaculate',
  'napped through warm-ups',
  'fuelled by pure spite',
];

export interface HrHorse {
  id: string;
  /** saddle-cloth number, 1..field */
  n: number;
  name: string;
  silk: string;
  /** finishing time in ms from the starting gun */
  timeMs: number;
  /** gap to an even pace at each checkpoint after the gun — see KNOTS */
  pace?: number[];
  /** paddock gossip shown on the betting card */
  quirk?: string;
}

/**
 * Where a runner is `tMs` after the gun, as a fraction of the lap (1 = the
 * line; it keeps going past 1 so the view can let a finisher run on).
 * Pure, so the reducer, the tests and every phone agree on every overtake.
 */
export function raceProgress(horse: HrHorse, tMs: number): number {
  if (tMs <= 0) return 0;
  const pace = horse.pace;
  // a round left over from an older build has no profile: run it evenly
  if (!pace || pace.length !== KNOTS.length - 1) return tMs / Math.max(1, horse.timeMs);
  const u = tMs / LAP_MS;
  const last = KNOTS.length - 1;
  if (u >= KNOTS[last]) return u + pace[last - 1];
  let k = 1;
  while (u > KNOTS[k]) k += 1;
  const from = k === 1 ? 0 : pace[k - 2];
  const to = pace[k - 1];
  const x = (u - KNOTS[k - 1]) / (KNOTS[k] - KNOTS[k - 1]);
  // half linear, half eased: moves build and fade without the pace ever stalling
  const e = 0.5 * x + 0.5 * x * x * (3 - 2 * x);
  return u + from + (to - from) * e;
}

/** Every time the lead changes hands: when (ms after the gun) and to whom. */
export function leadChanges(horses: HrHorse[]): { atMs: number; horseId: string }[] {
  const out: { atMs: number; horseId: string }[] = [];
  let leader: string | null = null;
  const end = Math.max(0, ...horses.map((h) => h.timeMs));
  for (let t = LAP_MS * 0.05; t <= end; t += 50) {
    let best: HrHorse | null = null;
    let bestP = -1;
    for (const h of horses) {
      const p = Math.min(1, raceProgress(h, t));
      // a horse that is home stays in front of one that is not
      const score = p >= 1 ? 2 - h.timeMs / 1e6 : p;
      if (score > bestP) {
        bestP = score;
        best = h;
      }
    }
    if (best && best.id !== leader) {
      if (leader != null) out.push({ atMs: t, horseId: best.id });
      leader = best.id;
    }
  }
  return out;
}

/**
 * Write one race: a finishing order, then a running order for every
 * checkpoint that gets there the long way round.
 */
function buildPaces(n: number, rng: () => number): number[][] {
  const K = KNOTS.length - 1; // checkpoints after the gun
  const idx = Array.from({ length: n }, (_, i) => i);
  // finishing order: fin[0] wins
  const fin = [...idx];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [fin[i], fin[j]] = [fin[j], fin[i]];
  }
  const winner = fin[0];

  // final gaps: a neck between the first two, then the field strung out
  const finalGap: number[] = new Array(n).fill(0);
  let g = 0;
  for (let r = 1; r < n; r++) {
    g -= r === 1 ? 0.004 + rng() * 0.006 : 0.012 + rng() * 0.02;
    finalGap[fin[r]] = g;
  }
  // a big field is squeezed to fit, never clipped: no two horses share a time
  const squeeze = g < -MAX_BEHIND ? -MAX_BEHIND / g : 1;
  for (const h of idx) finalGap[h] *= squeeze;

  const paces: number[][] = idx.map(() => new Array(K).fill(0));
  // running order per checkpoint, front first
  let order = [...fin].reverse(); // the eventual tail-enders break fastest
  if (rng() < 0.5 && n > 2) [order[0], order[1]] = [order[1], order[0]];
  let prevLeader = -1;
  for (let k = 1; k <= K - 2; k++) {
    if (k > 1) {
      // somebody new goes to the front: a move from just off the pace…
      const reach = Math.min(n - 1, 3);
      let pickAt = 1 + Math.floor(rng() * reach);
      // …but never the winner, who is being saved for the home straight
      if (order[pickAt] === winner) pickAt = pickAt === 1 && n > 2 ? 2 : 1;
      if (order[pickAt] === winner) pickAt = 0;
      const mover = order.splice(pickAt, 1)[0];
      order.unshift(mover);
      // and the pack behind keeps trading places
      for (let s = 0; s < 2; s++) {
        const a = 1 + Math.floor(rng() * Math.max(1, n - 2));
        if (a + 1 < n) [order[a], order[a + 1]] = [order[a + 1], order[a]];
      }
    }
    // the winner creeps up through the field: buried early, stalking late
    const wantRank = Math.max(1, Math.round((n - 1) * (1 - k / (K - 2)) * 0.8) + 1);
    const at = order.indexOf(winner);
    order.splice(at, 1);
    order.splice(Math.min(order.length, Math.max(1, wantRank)), 0, winner);
    if (order[0] === prevLeader && n > 2) {
      // the same horse in front twice running is a procession, not a race
      const swapWith = order[1] === winner ? 2 : 1;
      [order[0], order[swapWith]] = [order[swapWith], order[0]];
    }
    prevLeader = order[0];

    const spread = 0.05 + 0.07 * Math.min(1, k / 4);
    const step = Math.min(0.032, spread / Math.max(1, n - 1));
    order.forEach((h, rank) => {
      const jitter = rank === 0 ? 0 : (rng() - 0.5) * step * 0.5;
      paces[h][k - 1] = (rank === 0 ? 0.006 : 0) - rank * step + jitter;
    });
  }

  // the last checkpoint before the line: the winner is second or third and
  // closing, behind a leader that is about to be run down
  const lateLeader = n > 2 && rng() < 0.4 ? fin[2] : fin[1];
  for (const h of idx) {
    const prev = paces[h][K - 3];
    if (h === lateLeader) paces[h][K - 2] = 0.008;
    else if (h === winner) paces[h][K - 2] = -(0.012 + rng() * 0.01);
    else if (h === fin[1] || h === fin[2]) paces[h][K - 2] = -(0.006 + rng() * 0.018);
    else paces[h][K - 2] = (prev + finalGap[h]) / 2 - rng() * 0.01;
    paces[h][K - 1] = finalGap[h];
  }
  // a horse may fade, but never faster than the pace can absorb: working back
  // from the line, no gap may open quicker than MAX_FADE of the ground covered
  const MAX_FADE = 0.45;
  for (const h of idx) {
    for (let k = K - 2; k >= 0; k--) {
      const dt = KNOTS[k + 2] - KNOTS[k + 1];
      paces[h][k] = Math.min(paces[h][k], paces[h][k + 1] + MAX_FADE * dt);
    }
    paces[h][0] = Math.max(paces[h][0], -MAX_FADE * KNOTS[1]);
  }
  return paces;
}

function raceIsGood(horses: HrHorse[]): boolean {
  const changes = leadChanges(horses);
  if (changes.length < MIN_LEAD_CHANGES) return false;
  const ranked = [...horses].sort((a, b) => a.timeMs - b.timeMs);
  const winner = ranked[0];
  // the winner must get up late: the last lead change is theirs, in the straight
  const lastChange = changes[changes.length - 1];
  if (lastChange.horseId !== winner.id || lastChange.atMs < LAP_MS * 0.84) return false;
  // nobody may ever stall or run backwards
  for (const h of horses) {
    let prev = 0;
    for (let t = 100; t <= h.timeMs; t += 100) {
      const p = raceProgress(h, t);
      if (p - prev < (100 / LAP_MS) * 0.3) return false;
      prev = p;
    }
  }
  return true;
}

function buildField(ctx: GameContext): HrHorse[] {
  const field = Math.min(MAX_FIELD, Math.max(3, ctx.players.length));
  const quirkAt = Math.floor(ctx.rng() * QUIRKS.length);
  const nameAt = Math.floor(ctx.rng() * NAMES.length);
  let horses: HrHorse[] = [];
  // a race that came out flat is thrown away and rewritten (same seeded rng,
  // so the host and a recovering host write the same one)
  for (let attempt = 0; attempt < 60; attempt++) {
    const paces = buildPaces(field, ctx.rng);
    horses = paces.map((pace, i) => ({
      id: `h${i + 1}`,
      n: i + 1,
      name: NAMES[(nameAt + i) % NAMES.length],
      silk: SILKS[i % SILKS.length],
      // past the last checkpoint the gap is held, so the line comes at exactly:
      timeMs: Math.round(LAP_MS * (1 - pace[pace.length - 1])),
      pace: pace.map((v) => Math.round(v * 1e5) / 1e5),
      quirk: QUIRKS[(quirkAt + i) % QUIRKS.length],
    }));
    if (raceIsGood(horses)) break;
  }
  return horses;
}

export interface HrState {
  phase: 'betting' | 'racing' | 'gifting' | 'result';
  horses: HrHorse[];
  /** bettor uid → horse id */
  bets: Record<string, string>;
  /** uids whose bet the house placed for them when the clock ran out */
  auto: Record<string, boolean>;
  /** bettor uid → drinks riding on their horse (1..MAX_STAKE) */
  stakes?: Record<string, number>;
  /** winning backer uid → { player → drinks handed to them } */
  gifts: Record<string, Record<string, number>>;
  /** finishing order, fastest first — filled at the line */
  order: string[];
  winnerHorseId: string | null;
  /** horse id → extra sips its backers owe on top of their stake (the wooden spoon) */
  penalties: Record<string, number>;
  assignments: DrinkAssignment[];
  note: string | null;
}

export type HrInput =
  | { action: 'bet'; horseId: string; /** drinks wagered, 1..MAX_STAKE (default 1) */ stake?: number }
  /** a winner's whole payout in one go: player → drinks (or `uid` = all to one) */
  | { action: 'gift'; give?: Record<string, number>; uid?: string }
  /** shared-phone pass-along only — never touches the game state */
  | { action: 'wait' };

function backersOf(bets: Record<string, string>, horseId: string): string[] {
  return Object.entries(bets)
    .filter(([, id]) => id === horseId)
    .map(([uid]) => uid);
}

/** What a bettor has riding: a whole number of drinks, 1..MAX_STAKE. */
export function stakeOf(stakes: Record<string, number> | undefined, uid: string): number {
  const v = Math.floor(Number((stakes ?? {})[uid]));
  return Number.isFinite(v) ? Math.max(1, Math.min(MAX_STAKE, v)) : 1;
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
  // the house only ever risks one drink of somebody else's
  const stakes = { ...(state.stakes ?? {}) };
  for (const uid of Object.keys(auto)) if (stakes[uid] == null) stakes[uid] = 1;
  return { ...state, bets, auto, stakes };
}

function toRacing(state: HrState): ReduceResult<HrState> {
  // no CLEAR_INPUTS here: every player already answered in the betting
  // phase, so the shared phone renders the race instead of the pass gate
  return { state: { ...state, phase: 'racing' }, effects: [{ type: 'TIMER', ms: RACE_MS }] };
}

function toResult(state: HrState, ctx: GameContext): ReduceResult<HrState> {
  const assignments = [...(state.assignments ?? [])];
  for (const [giverUid, give] of Object.entries(state.gifts ?? {})) {
    const giver = ctx.players.find((p) => p.uid === giverUid);
    for (const [targetUid, sips] of Object.entries(give ?? {})) {
      if (!(sips > 0)) continue;
      assignments.push({
        uid: targetUid,
        sips,
        reason: `From ${giver?.name ?? 'a winner'}'s winnings`,
      });
    }
  }
  return {
    state: { ...state, phase: 'result', assignments },
    effects: [{ type: 'TIMER', ms: RESULT_MS }],
  };
}

function resolve(state: HrState): ReduceResult<HrState> {
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
  // the winner can't also be the loser — if it's the only backed horse, it just pays out
  const loserId = rawLoser && rawLoser !== winnerHorseId ? rawLoser : null;

  const assignments: DrinkAssignment[] = [];
  const penalties: Record<string, number> = {};
  const effects: Effect[] = [];

  // every losing bet is drunk by whoever made it
  for (const horseId of backed) {
    if (horseId === winnerHorseId) continue;
    const horse = horseById(horseId);
    const spoon = horseId === loserId ? SPOON_SIPS : 0;
    if (spoon) penalties[horseId] = spoon;
    for (const uid of backersOf(bets, horseId)) {
      const stake = stakeOf(state.stakes, uid);
      assignments.push({
        uid,
        sips: stake + spoon,
        reason: spoon
          ? `Had ${stake} on ${horse?.name ?? '?'}, ${ordinal(placeOf(horseId))}. Worst pick, so ${spoon} more.`
          : `Had ${stake} on ${horse?.name ?? '?'}, ${ordinal(placeOf(horseId))}.`,
      });
    }
  }
  if (winnerBacked && winnerHorseId) {
    for (const uid of backersOf(bets, winnerHorseId)) {
      effects.push({ type: 'SCORE', uid, delta: 1 });
    }
  }

  const tight = ranked.length >= 2 && ranked[1].timeMs - ranked[0].timeMs < PHOTO_FINISH_MS;
  const bits = [`${winner?.name ?? '?'} wins${tight ? ' in a photo finish' : ''}.`];
  bits.push(winnerBacked ? 'Its backers hand out their stakes.' : 'Nobody backed it, so every stake gets drunk.');
  if (loserId) bits.push(`${horseById(loserId)?.name ?? '?'} was the worst pick.`);
  const note = bits.join(' ');

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
    `Back a horse and say how many drinks you're putting on it, 1 to ${MAX_STAKE}. They run one lap. Pick the winner and you hand out your stake to whoever you like; pick anything else and you drink it, plus ${SPOON_SIPS} more if yours was the worst pick at the table.`,
  minPlayers: 3,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): HrState {
    const horses = buildField(ctx);
    return {
      phase: 'betting',
      horses,
      bets: {},
      stakes: {},
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
        const stake = stakeOf({ [event.uid]: input.stake ?? 1 }, event.uid);
        const next: HrState = { ...state, bets, stakes: { ...(state.stakes ?? {}), [event.uid]: stake } };
        const allIn = ctx.players.every((p) => bets[p.uid] != null);
        return allIn ? toRacing(next) : { state: next };
      }

      // gift: only the backers of the winning horse may hand one out
      if (state.phase !== 'gifting' || !state.winnerHorseId) return { state };
      if (!backersOf(state.bets ?? {}, state.winnerHorseId).includes(event.uid)) return { state };
      if ((state.gifts ?? {})[event.uid]) return { state }; // first payout is locked
      const stake = stakeOf(state.stakes, event.uid);
      const wanted: Record<string, number> =
        input.give && typeof input.give === 'object'
          ? input.give
          : typeof input.uid === 'string'
            ? { [input.uid]: stake }
            : {};
      // only whole drinks, only to other players at the table, never more than the stake
      const give: Record<string, number> = {};
      let left = stake;
      for (const p of ctx.players) {
        if (p.uid === event.uid || left <= 0) continue;
        const n = Math.min(left, Math.max(0, Math.floor(Number(wanted[p.uid]) || 0)));
        if (n > 0) {
          give[p.uid] = n;
          left -= n;
        }
      }
      if (Object.keys(give).length === 0) return { state };
      const gifts = { ...(state.gifts ?? {}), [event.uid]: give };
      const next: HrState = { ...state, gifts };
      const gifters = backersOf(state.bets ?? {}, state.winnerHorseId);
      const allGifted = gifters.every((uid) => gifts[uid] != null);
      return allGifted ? toResult(next, ctx) : { state: next };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'betting') return toRacing(withAutoBets(state, ctx));
      if (state.phase === 'racing') return resolve(state);
      if (state.phase === 'gifting') return toResult(state, ctx);
      if (state.phase === 'result') {
        const bets = state.bets ?? {};
        const winners = state.winnerHorseId ? backersOf(bets, state.winnerHorseId) : [];
        const losers = Object.keys(bets).filter((uid) => !winners.includes(uid));
        const winnerName = (state.horses ?? []).find((h) => h.id === state.winnerHorseId)?.name;
        return {
          state,
          effects: [
            {
              type: 'END',
              assignments: state.assignments ?? [],
              note: state.note,
              recap: {
                title: 'How the money went',
                groups: [
                  ...(winners.length
                    ? [{ label: `Backed ${winnerName ?? 'the winner'}, handed out their stake`, tone: 'good' as const, uids: winners }]
                    : []),
                  ...(losers.length
                    ? [{ label: 'Drank their own stake', tone: 'bad' as const, uids: losers }]
                    : []),
                ],
              },
            },
          ],
        };
      }
    }

    return { state };
  },

  View,
};

export default definition;
