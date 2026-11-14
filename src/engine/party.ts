import type { DrinkAssignment } from './types';

/**
 * ============================================================
 *  The party layer: what happens *between* the games
 * ============================================================
 * Wild cards, the lightweight rule, and the night's running stats. All of it
 * is pure — the engine calls these while it plans a commit and stores the
 * result in its own subtree, so every phone sees the same card and the same
 * numbers, and a retried commit can never deal a second card.
 *
 * Nothing here knows about any particular game.
 */

/* ---------------- wild cards ---------------- */

export type WildEffect =
  /** every drink this game counts twice */
  | 'double'
  /** every drink this game is halved, rounded up */
  | 'half'
  /** whoever drinks most takes the next player in the order down with them */
  | 'buddy'
  /** the tab leader's drinks this game land on whoever has drunk least */
  | 'robin'
  /** nothing lands on the tab leader this game */
  | 'immune'
  /** everyone drinks 1 as the card is turned */
  | 'tax'
  /** a table rule the app cannot enforce: the players police it */
  | 'rule';

export interface WildCard {
  id: string;
  title: string;
  text: string;
  effect: WildEffect;
  /** robin / immune: the tab leader the card is about */
  uid?: string;
  /** robin: who the leader's drinks go to */
  toUid?: string;
}

/** Wild cards come out every third game. */
export const WILD_EVERY = 3;

interface WildTemplate {
  id: string;
  title: string;
  effect: WildEffect;
  /** `{lead}` and `{low}` are replaced with names */
  text: string;
  needs?: 'lead' | 'lead+low';
}

const WILD_DECK: WildTemplate[] = [
  { id: 'double', title: 'Double or nothing', effect: 'double', text: 'Every drink this game counts twice.' },
  { id: 'half', title: 'Happy hour', effect: 'half', text: 'Half measures. Every drink this game is halved.' },
  {
    id: 'buddy',
    title: 'Drinking buddy',
    effect: 'buddy',
    text: 'Whoever drinks most this game takes the next player in the order down with them.',
  },
  {
    id: 'robin',
    title: 'Robin Hood',
    effect: 'robin',
    text: "{lead} has drunk the most, {low} the least. This game, {lead}'s drinks go to {low}.",
    needs: 'lead+low',
  },
  {
    id: 'immune',
    title: 'Night off',
    effect: 'immune',
    text: '{lead} has drunk the most tonight. Nothing lands on them this game.',
    needs: 'lead',
  },
  { id: 'tax', title: 'Round on the house', effect: 'tax', text: 'Everyone drinks 1. Now. Then we play.' },
  {
    id: 'wrong-hand',
    title: 'Wrong hand',
    effect: 'rule',
    text: 'Drink with your wrong hand until the next card. Get caught and drink 1.',
  },
  {
    id: 'no-names',
    title: 'No names',
    effect: 'rule',
    text: "Nobody says anybody's name until the next card. Slip up and drink 1.",
  },
  {
    id: 'toast',
    title: 'Toastmaster',
    effect: 'rule',
    text: 'Until the next card, nobody drinks without toasting someone at the table. Out loud.',
  },
  {
    id: 't-rex',
    title: 'T-rex',
    effect: 'rule',
    text: 'Elbows stay glued to your ribs when you drink, until the next card.',
  },
  {
    id: 'thumb',
    title: 'Thumb on the table',
    effect: 'rule',
    text: '{lead} can put a thumb on the table at any point this game. Last one to copy drinks 1.',
    needs: 'lead',
  },
];

/** the single uid with the highest / lowest total, or null when it is shared */
function soleExtreme(
  totals: Record<string, number>,
  uids: string[],
  pick: 'max' | 'min',
): string | null {
  if (uids.length < 2) return null;
  const sorted = [...uids].sort((a, b) =>
    pick === 'max' ? (totals[b] ?? 0) - (totals[a] ?? 0) : (totals[a] ?? 0) - (totals[b] ?? 0),
  );
  const [first, second] = sorted;
  if ((totals[first] ?? 0) === (totals[second] ?? 0)) return null;
  return first;
}

/**
 * The card for `round`, or null when this is not a wild round. `uids` is who
 * is at the table, `totals` the tab so far.
 */
export function dealWild(o: {
  round: number;
  uids: string[];
  totals: Record<string, number>;
  nameOf: (uid: string) => string;
  lastWild: string | null;
  rng: () => number;
}): WildCard | null {
  if (o.round < WILD_EVERY || o.round % WILD_EVERY !== 0 || o.uids.length < 2) return null;
  const lead = soleExtreme(o.totals, o.uids, 'max');
  const low = soleExtreme(o.totals, o.uids, 'min');
  const pool = WILD_DECK.filter((c) => {
    if (c.id === o.lastWild) return false;
    if (c.needs === 'lead') return lead != null;
    if (c.needs === 'lead+low') return lead != null && low != null && lead !== low;
    return true;
  });
  if (pool.length === 0) return null;
  const card = pool[Math.floor(o.rng() * pool.length) % pool.length];
  const text = card.text
    .replaceAll('{lead}', lead ? o.nameOf(lead) : '')
    .replaceAll('{low}', low ? o.nameOf(low) : '');
  const dealt: WildCard = { id: card.id, title: card.title, text, effect: card.effect };
  if (card.needs && lead) dealt.uid = lead;
  if (card.needs === 'lead+low' && low) dealt.toUid = low;
  return dealt;
}

function sumByUid(assignments: DrinkAssignment[]): Map<string, number> {
  const by = new Map<string, number>();
  for (const a of assignments) by.set(a.uid, (by.get(a.uid) ?? 0) + a.sips);
  return by;
}

/**
 * What the card does to a finished round's drinks. Returns the new list and a
 * short line for the drinks screen saying what changed (null when nothing did).
 */
export function applyWild(
  wild: WildCard | null | undefined,
  assignments: DrinkAssignment[],
  order: string[],
  nameOf: (uid: string) => string,
): { assignments: DrinkAssignment[]; did: string | null } {
  if (!wild || assignments.length === 0) return { assignments, did: null };
  switch (wild.effect) {
    case 'double':
      return {
        assignments: assignments.map((a) => ({ ...a, sips: a.sips * 2 })),
        did: 'Everything doubled.',
      };
    case 'half':
      return {
        assignments: assignments.map((a) => ({ ...a, sips: Math.max(1, Math.ceil(a.sips / 2)) })),
        did: 'Everything halved.',
      };
    case 'buddy': {
      const by = sumByUid(assignments);
      const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
      if (ranked.length === 0) return { assignments, did: null };
      // a shared top spot has no single buddy to drag down
      if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
        return { assignments, did: 'Nobody drank the most, so nobody got dragged down.' };
      }
      const [top, sips] = ranked[0];
      const at = order.indexOf(top);
      if (at < 0 || order.length < 2) return { assignments, did: null };
      const buddy = order[(at + 1) % order.length];
      if (buddy === top) return { assignments, did: null };
      return {
        assignments: [
          ...assignments,
          { uid: buddy, sips, reason: `Drinking buddy of ${nameOf(top)}`, fromUid: top },
        ],
        did: `${nameOf(top)} took ${nameOf(buddy)} down too.`,
      };
    }
    case 'robin': {
      const from = wild.uid;
      const to = wild.toUid;
      if (!from || !to) return { assignments, did: null };
      const moved = assignments.filter((a) => a.uid === from).reduce((n, a) => n + a.sips, 0);
      if (moved === 0) return { assignments, did: `${nameOf(from)} had nothing to pass on.` };
      return {
        assignments: assignments.map((a) =>
          a.uid === from ? { ...a, uid: to, reason: `${a.reason} (meant for ${nameOf(from)})` } : a,
        ),
        did: `${nameOf(to)} drank ${moved} that belonged to ${nameOf(from)}.`,
      };
    }
    case 'immune': {
      const who = wild.uid;
      if (!who) return { assignments, did: null };
      const spared = assignments.filter((a) => a.uid === who).reduce((n, a) => n + a.sips, 0);
      if (spared === 0) return { assignments, did: null };
      return {
        assignments: assignments.filter((a) => a.uid !== who),
        did: `${nameOf(who)} was let off ${spared}.`,
      };
    }
    default:
      return { assignments, did: null };
  }
}

/* ---------------- the lightweight rule ---------------- */

export interface SpotInfo {
  uid: string;
  /** true when they chose this game themselves */
  picked: boolean;
}

export interface NextUp {
  /** who gets to pick the next game (and drinks double in it) */
  pickerUid: string | null;
}

/** how far behind the next-lowest drinker someone must be to get singled out */
export const SPOT_GAP = 3;
/** games between two turns on the spot */
export const SPOT_COOLDOWN = 3;

/**
 * Whoever has had it easiest gets a target: they pick the next game and
 * drink double in it. Only when one player is clearly behind the rest, not on
 * a wild round, and not twice in quick succession.
 */
export function lightweightFor(o: {
  stats: PartyStats;
  totals: Record<string, number>;
  uids: string[];
  nextRound: number;
}): string | null {
  if (o.uids.length < 3 || o.stats.rounds < 3) return null;
  if (o.nextRound % WILD_EVERY === 0) return null;
  if (o.stats.lastSpotRound > 0 && o.nextRound - o.stats.lastSpotRound < SPOT_COOLDOWN) return null;
  const sorted = [...o.uids].sort((a, b) => (o.totals[a] ?? 0) - (o.totals[b] ?? 0));
  const gap = (o.totals[sorted[1]] ?? 0) - (o.totals[sorted[0]] ?? 0);
  return gap >= SPOT_GAP ? sorted[0] : null;
}

/** On the spot: this player's drinks count double. */
export function applySpot(spotUid: string | null | undefined, assignments: DrinkAssignment[]): DrinkAssignment[] {
  if (!spotUid) return assignments;
  return assignments.map((a) => (a.uid === spotUid ? { ...a, sips: a.sips * 2 } : a));
}

/* ---------------- the night so far ---------------- */

export interface PlayerStats {
  /** games they were in */
  rounds: number;
  /** games they drank in */
  drankRounds: number;
  /** current and longest run of games in a row with a drink */
  drinkRun: number;
  bestDrinkRun: number;
  /** current and longest run of games in a row without one */
  safeRun: number;
  bestSafeRun: number;
  /** the most they took from one game, and which game it was */
  biggest: number;
  biggestGame: string;
  /** drinks they handed to other people */
  given: number;
}

export interface PartyStats {
  /** games finished tonight */
  rounds: number;
  lastSpotRound: number;
  lastWild: string | null;
  players: Record<string, PlayerStats>;
  /** who gave whom how many: pairs[from][to] */
  pairs: Record<string, Record<string, number>>;
}

export function emptyStats(): PartyStats {
  return { rounds: 0, lastSpotRound: 0, lastWild: null, players: {}, pairs: {} };
}

function emptyPlayer(): PlayerStats {
  return {
    rounds: 0,
    drankRounds: 0,
    drinkRun: 0,
    bestDrinkRun: 0,
    safeRun: 0,
    bestSafeRun: 0,
    biggest: 0,
    biggestGame: '',
    given: 0,
  };
}

/** RTDB drops empty objects, so stats read back with holes in them. */
export function statsOf(stats: PartyStats | null | undefined): PartyStats {
  return {
    rounds: stats?.rounds ?? 0,
    lastSpotRound: stats?.lastSpotRound ?? 0,
    lastWild: stats?.lastWild ?? null,
    players: stats?.players ?? {},
    pairs: stats?.pairs ?? {},
  };
}

/** Fold one finished game into the night's stats. */
export function updateStats(
  prev: PartyStats | null | undefined,
  o: { gameName: string; assignments: DrinkAssignment[]; roundUids: string[] },
): PartyStats {
  const base = statsOf(prev);
  const players: Record<string, PlayerStats> = { ...base.players };
  const pairs: Record<string, Record<string, number>> = { ...base.pairs };
  const drank = sumByUid(o.assignments);
  const uids = new Set([...o.roundUids, ...drank.keys()]);

  for (const uid of uids) {
    const p = { ...emptyPlayer(), ...(players[uid] ?? {}) };
    const sips = drank.get(uid) ?? 0;
    p.rounds += 1;
    if (sips > 0) {
      p.drankRounds += 1;
      p.drinkRun += 1;
      p.safeRun = 0;
      p.bestDrinkRun = Math.max(p.bestDrinkRun, p.drinkRun);
      if (sips > p.biggest) {
        p.biggest = sips;
        p.biggestGame = o.gameName;
      }
    } else {
      p.safeRun += 1;
      p.drinkRun = 0;
      p.bestSafeRun = Math.max(p.bestSafeRun, p.safeRun);
    }
    players[uid] = p;
  }

  for (const a of o.assignments) {
    if (!a.fromUid || a.fromUid === a.uid || a.sips <= 0) continue;
    const giver = { ...emptyPlayer(), ...(players[a.fromUid] ?? {}) };
    giver.given += a.sips;
    players[a.fromUid] = giver;
    pairs[a.fromUid] = { ...(pairs[a.fromUid] ?? {}), [a.uid]: (pairs[a.fromUid]?.[a.uid] ?? 0) + a.sips };
  }

  return { ...base, rounds: base.rounds + 1, players, pairs };
}

/* ---------------- the awards ---------------- */

export interface Award {
  id: string;
  title: string;
  /** the winner, or a pair for the nemesis award */
  uids: string[];
  /** the number the award is about */
  n: number;
  line: string;
}

/**
 * The end-of-night awards. Only awards somebody actually earned are handed
 * out: a table that never gave each other a drink gets no nemesis.
 */
export function awardsFor(
  stats: PartyStats | null | undefined,
  totals: Record<string, number>,
  uids: string[],
  nameOf: (uid: string) => string,
): Award[] {
  const s = statsOf(stats);
  const out: Award[] = [];
  if (uids.length === 0) return out;
  const top = <T>(items: T[], score: (t: T) => number): T | null => {
    let best: T | null = null;
    for (const it of items) if (best == null || score(it) > score(best)) best = it;
    return best != null && score(best) > 0 ? best : null;
  };
  const ps = (uid: string): PlayerStats => ({ ...emptyPlayer(), ...(s.players[uid] ?? {}) });

  const sponge = top(uids, (u) => totals[u] ?? 0);
  if (sponge) {
    out.push({
      id: 'sponge',
      title: 'The sponge',
      uids: [sponge],
      n: totals[sponge] ?? 0,
      line: `${nameOf(sponge)} put away ${totals[sponge]}. Nobody else got close enough to worry.`,
    });
  }

  const driest = [...uids].sort((a, b) => (totals[a] ?? 0) - (totals[b] ?? 0))[0];
  if (driest && driest !== sponge) {
    const n = totals[driest] ?? 0;
    out.push({
      id: 'driver',
      title: 'Designated driver',
      uids: [driest],
      n,
      line:
        n === 0
          ? `${nameOf(driest)} did not drink once. Were they even playing?`
          : `${nameOf(driest)} got through the whole night on ${n}.`,
    });
  }

  const hit = top(uids, (u) => ps(u).biggest);
  if (hit && ps(hit).biggest >= 3) {
    const p = ps(hit);
    out.push({
      id: 'hit',
      title: 'Worst single game',
      uids: [hit],
      n: p.biggest,
      line: `${nameOf(hit)} took ${p.biggest} in one go${p.biggestGame ? `, in ${p.biggestGame}` : ''}.`,
    });
  }

  const run = top(uids, (u) => ps(u).bestDrinkRun);
  if (run && ps(run).bestDrinkRun >= 3) {
    out.push({
      id: 'run',
      title: 'Could not catch a break',
      uids: [run],
      n: ps(run).bestDrinkRun,
      line: `${nameOf(run)} drank ${ps(run).bestDrinkRun} games in a row.`,
    });
  }

  const dry = top(uids, (u) => ps(u).bestSafeRun);
  if (dry && ps(dry).bestSafeRun >= 3) {
    out.push({
      id: 'dry',
      title: 'Teflon',
      uids: [dry],
      n: ps(dry).bestSafeRun,
      line: `${nameOf(dry)} went ${ps(dry).bestSafeRun} games without a drop.`,
    });
  }

  const giver = top(uids, (u) => ps(u).given);
  if (giver && ps(giver).given >= 3) {
    out.push({
      id: 'giver',
      title: 'Most generous',
      uids: [giver],
      n: ps(giver).given,
      line: `${nameOf(giver)} handed out ${ps(giver).given}. None of it was kindness.`,
    });
  }

  let pair: { from: string; to: string; n: number } | null = null;
  for (const [from, tos] of Object.entries(s.pairs)) {
    for (const [to, n] of Object.entries(tos ?? {})) {
      if (!pair || n > pair.n) pair = { from, to, n };
    }
  }
  if (pair && pair.n >= 3) {
    out.push({
      id: 'nemesis',
      title: 'Nemesis',
      uids: [pair.from, pair.to],
      n: pair.n,
      line: `${nameOf(pair.from)} gave ${nameOf(pair.to)} ${pair.n} tonight. Sort it out between you.`,
    });
  }

  return out;
}
