import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Effect, GameContext, GameDefinition, PlayerInfo } from '../src/engine/types.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import horseRace from '../src/games/HorseRace/definition.ts';
import wavelength from '../src/games/Wavelength/definition.ts';
import confessions from '../src/games/Confessions/definition.ts';
import boomCup from '../src/games/BoomCup/definition.ts';
import chicken from '../src/games/Chicken/definition.ts';
import sketchy from '../src/games/Sketchy/definition.ts';

/**
 * The drinks-screen line (engine/roast.ts) is only as specific as what a game
 * reports when it ends. These drive each reducer from a state one step before
 * its END and check the highlights and the `fromUid` on handed-out drinks.
 */

const players: PlayerInfo[] = ['host', 'p2', 'p3', 'p4'].map((uid, i) => ({
  uid,
  name: uid.toUpperCase(),
  emoji: '🍺',
  isHost: i === 0,
  connected: true,
  local: false,
  drinkCount: 0,
  score: 0,
  joinedAt: i,
}));

function ctx(over: Partial<GameContext> = {}): GameContext {
  return {
    players,
    actorUid: 'host',
    turnOrder: players.map((p) => p.uid),
    settings: { mode: 'party', pointsMode: false, sipMultiplier: 1, enabledGames: [] },
    rng: mulberry32(1),
    now: 1_000_000,
    roundId: 'r',
    phaseId: 'p',
    revision: 1,
    ...over,
  };
}

function endOf(def: GameDefinition<any, any>, state: unknown, c = ctx()) {
  const res = def.reduce(state, { type: 'TIME_UP', now: c.now }, c);
  const end = (res.effects ?? []).find((fx: Effect) => fx.type === 'END');
  assert.ok(end && end.type === 'END', `${def.id} ended`);
  return end;
}

const kinds = (end: { highlights?: { kind: string }[] }) => (end.highlights ?? []).map((h) => h.kind);

test('Horse Race: big stakes on either side are reported, and winnings name their giver', () => {
  const horses = [
    { id: 'h1', n: 1, name: 'Alpha', silk: 's1', timeMs: 19000 },
    { id: 'h2', n: 2, name: 'Bravo', silk: 's2', timeMs: 19100 },
  ];
  const base = {
    horses,
    bets: { host: 'h1', p2: 'h2', p3: 'h2' },
    stakes: { host: 5, p2: 7, p3: 2 },
    winnerHorseId: 'h1',
    order: ['h1', 'h2'],
    assignments: [],
    note: '',
  };
  // the gifting clock runs out with one hand-out on the table
  const gifted = (horseRace as GameDefinition<any, any>).reduce(
    { ...base, phase: 'gifting', gifts: { host: { p2: 3, p3: 2 } } },
    { type: 'TIME_UP', now: 1 },
    ctx(),
  );
  assert.equal(gifted.state.phase, 'result');
  for (const a of gifted.state.assignments) assert.equal(a.fromUid, 'host', 'every dealt drink names the winner');

  const end = endOf(horseRace, gifted.state);
  assert.deepEqual(end.highlights, [
    { kind: 'horse-lost-big', uid: 'p2', n: 7, text: 'Bravo' },
    { kind: 'horse-won-big', uid: 'host', n: 5, text: 'Alpha' },
  ]);

  const nobody = endOf(horseRace, { ...base, phase: 'result', bets: { p2: 'h2' }, stakes: { p2: 1 } });
  assert.deepEqual(nobody.highlights, [{ kind: 'horse-nobody-won', text: 'Alpha' }]);
});

test('Wavelength: dead on, miles off and a useless clue', () => {
  const end = endOf(wavelength, {
    phase: 'reveal',
    target: 50,
    left: 'a',
    right: 'b',
    guesses: { p2: 51, p3: 97 },
    assignments: [{ uid: 'host', sips: 2, reason: 'Useless clue' }],
    note: '',
  });
  assert.deepEqual(end.highlights, [
    { kind: 'wave-dead-on', uid: 'p2' },
    { kind: 'wave-miles-off', uid: 'p3', n: 47 },
    { kind: 'wave-bad-clue', uid: 'host' },
  ]);
  const quiet = endOf(wavelength, { phase: 'reveal', target: 50, guesses: { p2: 60, p3: 70 }, assignments: [] });
  assert.deepEqual(quiet.highlights, []);
});

test('Confessions: the last trial is the one reported, and the gift names the winner', () => {
  const end = endOf(confessions, {
    phase: 'finale',
    roundNo: 2,
    prompt: 'x',
    history: { 1: { authorUid: 'p2', caught: true }, 2: { authorUid: 'p3', caught: false } },
    tally: { host: 0, p2: 2, p3: 1, p4: 1 },
    winnerUids: ['host'],
    giftUid: 'p2',
  });
  assert.deepEqual(end.highlights, [{ kind: 'conf-fooled', uid: 'p3' }]);
  assert.equal(end.assignments?.[0].uid, 'p2');
  assert.equal(end.assignments?.[0].fromUid, 'host');
});

test('Boom Cup: the BOOM and the most-caught player are reported', () => {
  const state = {
    phase: 'shooting',
    ring: ['host', 'p2', 'p3', 'p4'],
    hold: ['host', 'p3'],
    miss: [0, 0],
    middle: 0,
    caught: { p2: 2, p4: 1 },
    caughtOrder: ['p2', 'p4'],
    catchers: ['host'],
    boomUid: 'p2',
  };
  const end = endOf(boomCup, state);
  assert.deepEqual(end.highlights, [
    { kind: 'boom-last-beer', uid: 'p2' },
    { kind: 'boom-caught-most', uid: 'p2', n: 2 },
  ]);
  const level = endOf(boomCup, { ...state, boomUid: null, caught: { p2: 2, p4: 2 } });
  assert.deepEqual(level.highlights, [], 'a shared record is nobody’s record');
});

test('Chicken: a bust, an early bail and the hand-outs', () => {
  const end = endOf(chicken, {
    phase: 'gift',
    climbAt: 0,
    banks: { host: 1, p2: 6 },
    lastThumb: null,
    bustValue: 8,
    busted: ['p3', 'p4'],
    gifts: { p2: { host: 4 } },
  });
  assert.deepEqual(end.highlights, [
    { kind: 'chicken-bust', uid: 'p3', n: 8 },
    { kind: 'chicken-early', uid: 'host', n: 1 },
  ]);
  const dealt = (end.assignments ?? []).find((a) => a.uid === 'host');
  assert.equal(dealt?.fromUid, 'p2');

  const last = endOf(chicken, {
    phase: 'gift',
    climbAt: 0,
    banks: { host: 3, p2: 4, p3: 9 },
    lastThumb: 'p3',
    bustValue: null,
    busted: [],
    gifts: {},
  });
  assert.deepEqual(kinds(last), ['chicken-last']);
});

test('Sketchy: nobody, everybody, and the one who missed', () => {
  const base = { phase: 'reveal', word: 'shark', options: ['shark'], strokes: [], feed: [], assignments: [] };
  assert.deepEqual(endOf(sketchy, { ...base, got: [] }).highlights, [
    { kind: 'sketch-nobody', uid: 'host', text: '"shark"' },
  ]);
  assert.deepEqual(kinds(endOf(sketchy, { ...base, got: ['p2', 'p3', 'p4'] })), ['sketch-everyone']);
  assert.deepEqual(endOf(sketchy, { ...base, got: ['p2', 'p4'] }).highlights, [
    { kind: 'sketch-one-missed', uid: 'p3', text: '"shark"' },
  ]);
  assert.deepEqual(endOf(sketchy, { ...base, got: ['p2'] }).highlights, []);
});
