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
    'Three skulls. {name}, the machine would like a word with your family.',
    '{name} hit three skulls. Finish the drink. The machine does not negotiate.',
    'Three skulls for {name}. Statistically impressive. Medically unwise.',
  ],
  'slots-only-safe': [
    'The machine spared {name} and only {name}. It has always had favourites.',
    'Everyone drinks except {name}, who is already composing the speech.',
  ],

  // Reaction Duel
  'react-dq': [
    '{name} tapped before green. It is a one-rule game and {name} found the rule.',
    'The game is called wait for green. {name} got as far as wait.',
    '{name} went early. Somewhere a driving instructor just felt a chill.',
  ],
  'react-slow': [
    '{name}: {n}ms. Continents have moved faster.',
    '{n}ms from {name}. The green light has since retired.',
    '{name} took {n}ms. Were you waiting for a second opinion?',
  ],
  'react-asleep': [
    '{name} never tapped. Blink twice if you are still with us.',
    '{name} watched the light go green and chose peace.',
  ],

  // Trivia
  'trivia-zero': [
    '{name}: nought from five. A monkey with a dartboard gets one.',
    '{name} got none right. Guessing would have been an improvement.',
    'Five questions, five swings, no contact. {name}.',
  ],
  'trivia-sweep': [
    '{name} got all five and is waiting to be asked how.',
    'Five from five. {name} has clearly never been outside.',
  ],

  // Never Have I Ever
  'nhie-only-guilty': [
    'Only {name} has. Everyone else would like the full story, with dates.',
    'One guilty party and it is {name}. Nobody is shocked. Everybody is interested.',
    '{name}, alone, hand up. The floor is yours.',
  ],
  'nhie-only-innocent': [
    '{name} is the only one who never has. A saint or a liar. The table has voted liar.',
    'Everyone has done it except {name}, who was presumably at home.',
  ],
  'nhie-all-guilty': [
    'All of you. Every one. This is why you are friends.',
    'Unanimous guilt. Nobody at this table should run for office.',
  ],

  // Categories
  'cat-gave-up': [
    '{name} could not name four {text}. There are more than four. There are loads.',
    '{name} gave up on {text} with {n} on the pile. An expensive silence.',
    'Four {text}. That was the whole job. {name} drinks.',
  ],
  'cat-stacked': [
    '{name} got there eventually. The table billed {n} for the wait.',
    '{n} stacked on {name} while they thought about it. Lovely friends.',
  ],
  'cat-clean': [
    '{name} rattled off four {text} before anyone found the button. Suspiciously prepared.',
  ],

  // Poisoning the Drinks
  'poison-hit': [
    '{name} studied every cup like a sommelier and chose poison.',
    '{name} had a sniff, had a think, and drank the bad one anyway.',
    'One poisoned cup on the table and {name} found it first go. A gift, really.',
  ],
  'poison-stacked': [
    '{n} of you poisoned the same cup and {name} picked it like it had their name on.',
    'That cup had {n} doses in it. {name} is mostly poison now.',
  ],
  'poison-clean': [
    '{name} picked clean. The poisoners drink, and can think about what they did.',
    '{name} strolled past the poison like it was not there. The plotters pay.',
  ],
  'poison-antidote': [
    '{name} found the antidote. Whatever was coming went straight back to sender.',
  ],

  // Fake It
  'fake-caught': [
    '{name} was rumbled in round one. Do not take up poker.',
    'The table clocked {name} immediately. It was the face. It is always the face.',
    '{name} lasted one round as a liar, which is somehow a compliment.',
  ],
  'fake-caught-late': [
    '{name} made it to round {n} on pure nerve. Then the nerve ran out.',
    'It took you {n} rounds to notice {name} had no idea what was going on.',
  ],
  'fake-escaped': [
    '{name} had no clue what the prompt was for three rounds and you all nodded along.',
    'Three rounds, zero information, and {name} fooled every one of you. Worrying for everyone.',
  ],
  'fake-innocent': [
    'You all convicted {name}, who was innocent. Justice is a strong word for what happened here.',
  ],

  // Horse Race
  'horse-lost-big': [
    '{name} put {n} on {text}. {text} is still out there somewhere, having a lovely time.',
    '{n} on {text}. {name} has now seen the horse run and would like to revise that.',
    '{name} backed {text} with {n} and their whole chest. The horse felt none of it.',
    '{text} thanks {name} for the {n} and the faith. Mostly the faith.',
  ],
  'horse-won-big': [
    '{name} had {n} on {text} and has not stopped talking since.',
    '{text} came in for {name}. {n} to hand out and no humility whatsoever.',
  ],
  'horse-nobody-won': ['{text} won and nobody backed it. {text} does not need your approval.'],

  // Wavelength
  'wave-dead-on': [
    '{name} landed dead on. Telepathy, or a reflective surface behind the clue-giver.',
  ],
  'wave-miles-off': [
    '{name} was {n} out, on a scale of 100. That is not a guess, that is a different conversation.',
    '{name} missed by {n}. Did you hear the clue, or just the vibe?',
  ],
  'wave-bad-clue': [
    'The clue from {name} sent the whole table the wrong way. A tour guide of some skill.',
  ],

  // Confessions
  'conf-caught': [
    'Everyone knew it was {name}. The confession basically signed itself.',
    '{name} wrote it, and the table said {name} before the card stopped moving.',
  ],
  'conf-fooled': [
    '{name} wrote that and not one of you suspected. You do not know {name} at all.',
    'Nobody guessed {name}. {name} is taking that as a compliment. It was not one.',
  ],

  // Boom Cup
  'boom-last-beer': [
    '{name} took the last beer and the boom that came with it. Greedy and unlucky is a tough combination.',
  ],
  'boom-caught-most': ['{name} was caught {n} times. At some point it stops being bad luck.'],

  // Chicken
  'chicken-bust': [
    '{name} was still holding at {n} when it went off. Nobody has ever needed {n} that badly.',
    '{name} saw {n} and thought: one more. There was not one more.',
  ],
  'chicken-early': [
    '{name} let go at {n}. That is not chicken. Chicken has more fight in it.',
    '{name} bailed at {n}. The counter had barely sat down.',
  ],
  'chicken-last': [
    '{name} held out longest and walks off with {n} to hand out. Nerves of steel, friends of fear.',
  ],

  // Sketchy
  'sketch-nobody': [
    'That was {text}, apparently. {name} drinks for crimes against drawing.',
    'Nobody got {text}. In the table\'s defence, have you seen it?',
    '{name} drew {text}. The table saw several things. None of them were {text}.',
  ],
  'sketch-everyone': ['Everyone got {text}. {name} has been hiding a talent, or it was very easy.'],
  'sketch-one-missed': ['Everyone got {text} except {name}, who was looking at a different picture.'],

  // Most Likely To
  'mlt-unanimous': [
    'Every single vote went to {name}: most likely to {text}. No debate, no appeal.',
    'Unanimous. {name} is most likely to {text}, and {name} knows it.',
  ],
  'mlt-self-vote': [
    '{name} voted for themselves as most likely to {text}, and won. Self-awareness is a gift.',
  ],
  'mlt-clean': ['Three prompts and not one vote for {name}. Either blameless or forgettable.'],
  'mlt-magnet': ['{name} won all three with {n} votes. That is not a reputation, that is a file.'],

  // Know Me
  'know-best': [
    '{name} got all {n} right about {text}. Best friend or stalker. It is a fine line.',
  ],
  'know-stranger': [
    '{name} got {n} right about {text}. Have you two met?',
    '{name} knows {text} about as well as the bar staff do. {n} right.',
  ],
  'know-open-book': ['Everybody got everything right about {name}. No mystery left. Sorry.'],
  'know-mystery': ['Nobody at this table knows {name} at all. How long have you been friends?'],
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
              `${name} picked this game and drinks ${n} for it. Nobody to blame. Truly nobody.`,
              `${name} chose the game. The game chose ${name}. ${n}.`,
            ])
          : `${name} was on the spot and it cost ${n}. Catching up nicely.`,
      );
    } else {
      add(
        0,
        o.spotPicked
          ? `${name} picked the game and walked away dry. This is why nobody trusts ${name}.`
          : `${name} was on the spot, drinks doubled, and still dodged it. Slippery.`,
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
          `${name} has now drunk ${run} games running. The games are not cursed. Draw your own conclusions.`,
          `That is ${run} in a row for ${name}. At this point it is a subscription.`,
        ]),
      );
    }
    if (sips > 0 && safe >= 3) {
      add(2, `${name} went ${safe} games dry. It was a beautiful run. It is over.`);
    }
    if (sips === 0 && safe + 1 >= 4 && (o.totalsAfter[uid] ?? 0) === 0) {
      add(2, `${name} has not had a drink in ${safe + 1} games. Check the glass. Check it is not water.`);
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
      `${o.nameOf(leadAfter)} now leads the tab on ${o.totalsAfter[leadAfter]}. There is no trophy. There is a headache.`,
    );
  }
  // someone keeps picking on the same person
  for (const a of o.assignments) {
    if (!a.fromUid || a.fromUid === a.uid) continue;
    const total = (stats.pairs[a.fromUid]?.[a.uid] ?? 0) + a.sips;
    if (total >= 5 && total > a.sips) {
      add(
        2,
        `${o.nameOf(a.fromUid)} has now given ${o.nameOf(a.uid)} ${total} tonight. Somebody did something to somebody.`,
      );
    }
  }

  /* tier 3: the plain shape of the round */
  const drinkers = [...drank.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (drinkers.length === 0) {
    add(3, pick([
        'Nobody drinks. Enjoy the peace. It is the last you will get.',
        'A whole game and nobody drank. Whose idea was this one?',
      ]));
  } else if (drinkers.length === o.roundUids.length && o.roundUids.length > 2) {
    add(3, pick(['Everybody drinks. At least you are doing it together.', 'Nobody escaped. Equality at last.']));
  } else {
    const [top, n] = drinkers[0];
    const sole = drinkers.length === 1 || drinkers[1][1] < n;
    if (sole && n >= 5) add(3, `${o.nameOf(top)} drinks ${n}. That is not a penalty, that is a round.`);
    else if (sole && drinkers.length === 1 && o.roundUids.length > 2) {
      add(3, `Just ${o.nameOf(top)}, then. ${n}. Everyone else, look away politely.`);
    } else if (sole && n >= 3) add(3, `${o.nameOf(top)} takes ${n}, the worst of it. Thoughts and prayers.`);
    const gift = o.assignments.find((a) => a.fromUid && a.fromUid !== a.uid && a.sips >= 3);
    if (gift?.fromUid) {
      add(3, `${o.nameOf(gift.fromUid)} gave ${o.nameOf(gift.uid)} ${gift.sips}. ${o.nameOf(gift.uid)} will remember that.`);
    }
  }

  for (const tier of tiers) if (tier.length > 0) return pick(tier);
  return null;
}
