import type { DrinkAssignment, Highlight } from './types';
import { statsOf, type PartyStats } from './party';

/**
 * ============================================================
 *  The line on the drinks screen
 * ============================================================
 * One dry sentence about what just happened, built from facts and nothing
 * else: what the game said happened (`highlights`), who drank what, and how
 * the night has been going (`stats`). It runs on the host while the round's
 * result is being committed, so every phone reads the same line.
 *
 * The rule for writing these: say the fact, then stop. The fact is the joke.
 * No exclamation marks, no emoji, nothing a person at the table would not
 * say out loud. `{name}` is the player, `{n}` a number, `{text}` a word the
 * game supplied (a horse, a category, the thing someone tried to draw).
 */

type Line = string;

/** Lines for the moments a game can report. See each game's END effect. */
const BY_KIND: Record<string, Line[]> = {
  // Slots
  'slots-skulls': [
    'Three skulls for {name}. The machine has made its feelings clear.',
    '{name} pulled three skulls. Finish it. The whole thing.',
  ],
  'slots-only-safe': [
    '{name} was the only one the machine liked.',
    'Everyone drinks except {name}, who will be insufferable about it.',
  ],

  // Reaction Duel
  'react-dq': [
    '{name} tapped before green. There is one rule.',
    '{name} went early. It is a game about waiting.',
  ],
  'react-slow': [
    '{name} took {n}ms. Things have been built faster.',
    '{name}, {n}ms. Were you reading something?',
  ],
  'react-asleep': ['{name} never tapped at all. Someone check for a pulse.'],

  // Trivia
  'trivia-zero': [
    '{name} got none right. None.',
    'Five questions, and {name} knew none of them. A clean sheet, in a way.',
  ],
  'trivia-sweep': [
    '{name} got all five and would like it known that they were easy.',
    'Five from five for {name}. Nobody likes a show-off.',
  ],

  // Never Have I Ever
  'nhie-only-guilty': [
    '{name} was the only one who has. Go on then, tell the story.',
    'Only {name} put a hand up. The table has questions.',
  ],
  'nhie-only-innocent': [
    '{name} is the only one who never has. Sure.',
    'Everyone has except {name}. Nobody believes {name}.',
  ],
  'nhie-all-guilty': ['Every single one of you has. This table has a type.'],

  // Categories
  'cat-gave-up': [
    '{name} could not name four {text}. They are everywhere.',
    '{name} gave up on {text} with {n} stacked. Costly.',
  ],
  'cat-stacked': [
    'The table stacked {n} on {name} while they were thinking. Friends.',
    '{name} got there in the end. It cost {n}.',
  ],
  'cat-clean': ['{name} named four {text} before anyone could stack a thing.'],

  // Poisoning the Drinks
  'poison-hit': [
    '{name} looked at every cup and picked the poisoned one.',
    '{name} sniffed, thought about it, and drank poison anyway.',
  ],
  'poison-stacked': ['{n} of you poisoned the same cup and {name} still picked it.'],
  'poison-clean': [
    '{name} found the one clean cup. The poisoners drink to that.',
    '{name} walked straight past the poison. Annoying.',
  ],
  'poison-antidote': ['{name} found the antidote. That one went back where it came from.'],

  // Fake It
  'fake-caught': [
    '{name} lasted one round as the faker. A short career.',
    'The table saw through {name} at the first attempt.',
  ],
  'fake-caught-late': ['{name} got to round {n} before anyone worked it out.'],
  'fake-escaped': [
    '{name} faked it for three rounds and none of you noticed. Think about that.',
    '{name} had no idea what the prompt was and still fooled the lot of you.',
  ],
  'fake-innocent': ['The whole table convicted {name}, who had done nothing wrong.'],

  // Horse Race
  'horse-lost-big': [
    '{name} put {n} on {text}. {text} did not share the confidence.',
    '{name} had {n} riding on {text}, a horse with other plans.',
    '{n} on {text}. {name} will be thinking about that for a while.',
  ],
  'horse-won-big': [
    '{name} had {n} on {text} and is being unbearable about it.',
    '{name} backed {text} for {n} and gets to ruin someone else\'s evening.',
  ],
  'horse-nobody-won': ['{text} won and not one of you backed it.'],

  // Wavelength
  'wave-dead-on': ['{name} was dead on. Either a mind reader or a peeker.'],
  'wave-miles-off': [
    '{name} was {n} out. On a scale that only goes to 100.',
    '{name} missed by {n}. Was that a guess or a protest?',
  ],
  'wave-bad-clue': ['{name} gave a clue so bad the whole table went the wrong way.'],

  // Confessions
  'conf-caught': [
    'The table knew it was {name} straight away. Nobody was surprised.',
    '{name} wrote it, and everybody knew {name} wrote it.',
  ],
  'conf-fooled': [
    '{name} wrote that and not one of you guessed. Worrying.',
    'Nobody thought {name} had it in them.',
  ],

  // Boom Cup
  'boom-last-beer': ['{name} took the last beer and everything that came with it.'],
  'boom-caught-most': ['{name} got caught {n} times. The cup knows where you live.'],
  'boom-first-try': ['{name} sank it first try and chose violence.'],

  // Chicken
  'chicken-bust': [
    '{name} held on to {n} and it went off in their hand.',
    '{name} was still holding at {n}. Greed has a price and it is {n}.',
  ],
  'chicken-early': [
    '{name} let go at {n}. That is not chicken, that is a different bird entirely.',
    '{name} bailed at {n}. Brave.',
  ],
  'chicken-last': ['{name} was the last thumb down and walked away with {n} to give.'],

  // Sketchy
  'sketch-nobody': [
    'That was meant to be {text}. {name} drinks for the drawing.',
    'Nobody got {text}. In fairness, {name} drew it.',
  ],
  'sketch-everyone': ['Everyone got {text}. {name} can draw, apparently.'],
  'sketch-one-missed': ['Everyone got {text} except {name}.'],
};

function fill(line: Line, v: { name?: string; n?: number; text?: string }): string {
  return line
    .replaceAll('{name}', v.name ?? 'Someone')
    .replaceAll('{n}', v.n != null ? String(v.n) : '')
    .replaceAll('{text}', v.text ?? '');
}

export interface RoastInput {
  /** the drinks as they landed, after wild cards and multipliers */
  assignments: DrinkAssignment[];
  highlights: Highlight[];
  /** who played this game */
  roundUids: string[];
  nameOf: (uid: string) => string;
  /** the tab before and after this game */
  totalsBefore: Record<string, number>;
  totalsAfter: Record<string, number>;
  /** the night's stats *before* this game was folded in */
  statsBefore: PartyStats | null | undefined;
  /** who was on the spot this game (drinks doubled), if anyone */
  spotUid?: string | null;
  spotPicked?: boolean;
  rng: () => number;
}

/**
 * The line, or null when nothing worth saying happened. Candidates are
 * gathered in tiers and the best tier wins: something the game itself
 * reported beats a streak, which beats a plain "X drank the most".
 */
export function roastFor(o: RoastInput): string | null {
  const stats = statsOf(o.statsBefore);
  const drank = new Map<string, number>();
  for (const a of o.assignments) drank.set(a.uid, (drank.get(a.uid) ?? 0) + a.sips);
  const pick = <T>(items: T[]): T => items[Math.floor(o.rng() * items.length) % items.length];

  const tiers: string[][] = [[], [], [], []];
  const add = (tier: number, text: string | null) => {
    if (text) tiers[tier].push(text);
  };

  /* tier 0: the lightweight rule paid off, or didn't */
  if (o.spotUid) {
    const n = drank.get(o.spotUid) ?? 0;
    const name = o.nameOf(o.spotUid);
    if (n > 0) {
      add(
        0,
        o.spotPicked
          ? pick([
              `${name} picked this game and drinks ${n} for it. Good choice.`,
              `${name} chose the game. ${name} drinks ${n}. Nobody made them.`,
            ])
          : `${name} was on the spot and it cost ${n}.`,
      );
    } else {
      add(
        0,
        o.spotPicked
          ? `${name} picked the game and walked away dry. Of course.`
          : `${name} was on the spot and still got away with it.`,
      );
    }
  }

  /* tier 1: what the game said happened */
  for (const h of o.highlights) {
    const lines = BY_KIND[h.kind];
    if (!lines) continue;
    add(1, fill(pick(lines), { name: h.uid ? o.nameOf(h.uid) : undefined, n: h.n, text: h.text }));
  }

  /* tier 2: the night so far */
  for (const uid of o.roundUids) {
    const name = o.nameOf(uid);
    const sips = drank.get(uid) ?? 0;
    const before = stats.players[uid];
    const run = (before?.drinkRun ?? 0) + (sips > 0 ? 1 : 0);
    const safe = before?.safeRun ?? 0;
    if (sips > 0 && run >= 3) {
      add(
        2,
        pick([
          `${name} has now drunk ${run} games running. Somebody check on them.`,
          `That is ${run} in a row for ${name}. The games are not the problem.`,
        ]),
      );
    }
    if (sips > 0 && safe >= 3) {
      add(2, `${name} had gone ${safe} games without a drink. That is over now.`);
    }
    if (sips === 0 && safe + 1 >= 4 && (o.totalsAfter[uid] ?? 0) === 0) {
      add(2, `${name} has not had a drink in ${safe + 1} games. Suspicious.`);
    }
  }
  // the lead on the tab changed hands
  const leaderOf = (totals: Record<string, number>): string | null => {
    const sorted = [...o.roundUids].sort((a, b) => (totals[b] ?? 0) - (totals[a] ?? 0));
    if (sorted.length < 2 || (totals[sorted[0]] ?? 0) === (totals[sorted[1]] ?? 0)) return null;
    return sorted[0];
  };
  const leadBefore = leaderOf(o.totalsBefore);
  const leadAfter = leaderOf(o.totalsAfter);
  if (leadAfter && leadAfter !== leadBefore && stats.rounds >= 2) {
    add(
      2,
      `${o.nameOf(leadAfter)} takes the lead on the tab with ${o.totalsAfter[leadAfter]}. Not a race anyone wanted to win.`,
    );
  }
  // someone keeps picking on the same person
  for (const a of o.assignments) {
    if (!a.fromUid || a.fromUid === a.uid) continue;
    const total = (stats.pairs[a.fromUid]?.[a.uid] ?? 0) + a.sips;
    if (total >= 5 && total > a.sips) {
      add(
        2,
        `${o.nameOf(a.fromUid)} has now given ${o.nameOf(a.uid)} ${total} tonight. This is personal.`,
      );
    }
  }

  /* tier 3: the plain shape of the round */
  const drinkers = [...drank.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (drinkers.length === 0) {
    add(3, pick(['Nobody drinks. It will not last.', 'A whole game and nobody drank. Do better.']));
  } else if (drinkers.length === o.roundUids.length && o.roundUids.length > 2) {
    add(3, pick(['Everybody drinks. Democracy.', 'Nobody got out of that one.']));
  } else {
    const [top, n] = drinkers[0];
    const sole = drinkers.length === 1 || drinkers[1][1] < n;
    if (sole && n >= 5) add(3, `${o.nameOf(top)} drinks ${n}. That is most of a pint.`);
    else if (sole && drinkers.length === 1 && o.roundUids.length > 2) {
      add(3, `Just ${o.nameOf(top)}, then. ${n} of them.`);
    } else if (sole && n >= 3) add(3, `${o.nameOf(top)} takes the worst of it with ${n}.`);
    const gift = o.assignments.find((a) => a.fromUid && a.fromUid !== a.uid && a.sips >= 3);
    if (gift?.fromUid) {
      add(3, `${o.nameOf(gift.fromUid)} gave ${o.nameOf(gift.uid)} ${gift.sips}. Noted.`);
    }
  }

  for (const tier of tiers) if (tier.length > 0) return pick(tier);
  return null;
}
