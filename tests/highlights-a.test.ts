import { test } from 'node:test';
import assert from 'node:assert/strict';

import type {
  Effect,
  GameContext,
  GameDefinition,
  Highlight,
  PlayerInfo,
  RoomMode,
} from '../src/engine/types.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import slots from '../src/games/Slots/definition.ts';
import reaction from '../src/games/Reaction/definition.ts';
import trivia from '../src/games/Trivia/definition.ts';
import prompts from '../src/games/Prompts/definition.ts';
import categories from '../src/games/Categories/definition.ts';
import poison from '../src/games/Poison/definition.ts';
import fakeIt from '../src/games/FakeIt/definition.ts';

/**
 * The drinks screen's line is only as specific as what a game reports when it
 * ends. These drive each reducer straight to its END effect from a hand-built
 * state and check the moment it names (and, where a player handed the drink
 * out, who did).
 */

const players: PlayerInfo[] = ['a', 'b', 'c'].map((uid, i) => ({
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

function ctx(mode: RoomMode = 'party', actorUid = 'a'): GameContext {
  return {
    players,
    actorUid,
    turnOrder: players.map((p) => p.uid),
    settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: [] },
    rng: mulberry32(11),
    now: 1_000_000,
    roundId: 'r1',
    phaseId: 'ph1',
    revision: 1,
  };
}

type End = Extract<Effect, { type: 'END' }>;

function endOf(effects: Effect[] | undefined): End {
  const end = (effects ?? []).find((fx): fx is End => fx.type === 'END');
  assert.ok(end, 'the round ended');
  return end;
}

function timeUp<S>(def: GameDefinition<S, any>, state: S, c = ctx()) {
  return def.reduce(state, { type: 'TIME_UP', now: c.now }, c);
}

const kinds = (hs: Highlight[] | undefined) => (hs ?? []).map((h) => h.kind);

test('Slots: three skulls and the one safe machine are both named', () => {
  const state = {
    phase: 'hold' as const,
    startedAt: 0,
    spins: {
      a: { reels: [7, 7, 7], line: 'Triple 💀. Finish your drink.', sips: 5 },
      b: { reels: [0, 0, 3], line: 'Pair of 🍺. Drink 2.', sips: 2 },
      c: { reels: [1, 1, 1], line: 'Triple 🍻. Safe.', sips: 0 },
    },
  };
  const end = endOf(timeUp(slots, state).effects);
  assert.deepEqual(end.highlights, [
    { kind: 'slots-skulls', uid: 'a' },
    { kind: 'slots-only-safe', uid: 'c' },
  ]);
});

test('Slots: an ordinary round reports nothing', () => {
  const state = {
    phase: 'hold' as const,
    startedAt: 0,
    spins: {
      a: { reels: [0, 1, 2], line: 'No match. Drink 1.', sips: 1 },
      b: { reels: [0, 0, 3], line: 'Pair of 🍺. Drink 2.', sips: 2 },
      c: { reels: [3, 4, 5], line: 'No match. Drink 1.', sips: 1 },
    },
  };
  assert.deepEqual(endOf(timeUp(slots, state).effects).highlights, []);
});

test('Reaction: a false start is the highlight', () => {
  const state = {
    phase: 'done' as const,
    goAt: 0,
    taps: {
      a: { ms: null, early: true },
      b: { ms: 310, early: false },
      c: { ms: 420, early: false },
    },
    assignments: [{ uid: 'a', sips: 3, reason: 'Tapped before green' }],
    note: null,
  };
  assert.deepEqual(endOf(timeUp(reaction, state).effects).highlights, [{ kind: 'react-dq', uid: 'a' }]);
});

test('Reaction: a slow honest finger is named with its time, a quick one is not', () => {
  const round = (ms: number) => ({
    phase: 'done' as const,
    goAt: 0,
    taps: {
      a: { ms: 210, early: false },
      b: { ms, early: false },
      c: { ms: 200, early: false },
    },
    assignments: [{ uid: 'b', sips: 2, reason: 'Slowest finger' }],
    note: null,
  });
  assert.deepEqual(endOf(timeUp(reaction, round(812.4)).effects).highlights, [
    { kind: 'react-slow', uid: 'b', n: 812 },
  ]);
  assert.deepEqual(endOf(timeUp(reaction, round(330)).effects).highlights, []);
});

test('Reaction: someone who never tapped is named', () => {
  const state = {
    phase: 'done' as const,
    goAt: 0,
    taps: {
      a: { ms: 210, early: false },
      b: { ms: null, early: false },
      c: { ms: 300, early: false },
    },
    assignments: [{ uid: 'b', sips: 2, reason: 'Never tapped' }],
    note: null,
  };
  assert.deepEqual(kinds(endOf(timeUp(reaction, state).effects).highlights), ['react-asleep']);
});

test('Trivia: a lone winner hands the drinks out, and the blank sheet and the full house are named', () => {
  const c = ctx();
  const start = trivia.createInitialState(c);
  // the last question has just been marked: a got all five, b none, c two
  const marked = {
    ...start,
    phase: 'reveal' as const,
    idx: start.questions.length - 1,
    scores: { a: start.questions.length, c: 2 },
  };
  const final = timeUp(trivia, marked, c);
  assert.equal(final.state.phase, 'final');
  assert.deepEqual(
    final.state.assignments.map((x) => [x.uid, x.fromUid]),
    [['b', 'a']],
    'the one top scorer is the giver',
  );
  const end = endOf(timeUp(trivia, final.state, c).effects);
  assert.deepEqual(end.highlights, [
    { kind: 'trivia-zero', uid: 'b' },
    { kind: 'trivia-sweep', uid: 'a' },
  ]);
  assert.equal(end.assignments?.[0]?.fromUid, 'a');
});

test('Trivia: two players on nothing is nobody in particular', () => {
  const c = ctx();
  const start = trivia.createInitialState(c);
  const state = { ...start, phase: 'final' as const, scores: { a: 3 } };
  assert.deepEqual(endOf(timeUp(trivia, state, c).effects).highlights, []);
});

test('Never Have I Ever: the only one who has, the only one who has not, and a whole guilty table', () => {
  const round = (votes: Record<string, boolean>) => ({
    prompt: '…',
    rule: 'guilty' as const,
    phase: 'reveal' as const,
    votes,
    assignments: [],
    note: null,
  });
  const hs = (votes: Record<string, boolean>) =>
    endOf(timeUp(prompts, round(votes)).effects).highlights;
  assert.deepEqual(hs({ a: true, b: false, c: false }), [{ kind: 'nhie-only-guilty', uid: 'a' }]);
  assert.deepEqual(hs({ a: true, b: false, c: true }), [{ kind: 'nhie-only-innocent', uid: 'b' }]);
  assert.deepEqual(hs({ a: true, b: true, c: true }), [{ kind: 'nhie-all-guilty' }]);
  assert.deepEqual(hs({ a: false, b: false, c: false }), []);
});

test('Categories: giving up, a big stack and a clean run each say what happened', () => {
  const naming = (pool: number) => ({
    category: 'Vegetables nobody likes',
    phase: 'naming' as const,
    pool,
    punisherUid: 'b',
    nextAt: 0,
    lastHitUid: null,
    gaveUp: false,
    resultLine: null,
  });
  const play = (pool: number, action: 'done' | 'giveup') =>
    endOf(categories.reduce(naming(pool), { type: 'INPUT', uid: 'a', input: { action } }, ctx()).effects)
      .highlights;
  assert.deepEqual(play(3, 'giveup'), [
    { kind: 'cat-gave-up', uid: 'a', n: 3, text: 'vegetables nobody likes' },
  ]);
  assert.deepEqual(play(4, 'done'), [{ kind: 'cat-stacked', uid: 'a', n: 4 }]);
  assert.deepEqual(play(0, 'done'), [{ kind: 'cat-clean', uid: 'a', text: 'vegetables nobody likes' }]);
  assert.deepEqual(play(1, 'done'), []);
  // the safety-net timer is a give-up too
  assert.deepEqual(kinds(endOf(timeUp(categories, naming(2)).effects).highlights), ['cat-gave-up']);
});

test('Poison: one dose names its poisoner as the giver; a stacked cup, a clean cup and the antidote are told apart', () => {
  const table = (poisons: Record<string, number>, antidoteCup = 3) => ({
    phase: 'drinking' as const,
    cups: 4,
    drinkerUid: 'a',
    order: ['b', 'c'],
    turn: 2,
    poisons,
    antidoteCup,
    hover: null,
    sniff: null,
    reactions: {},
    pick: null,
    revealAt: null,
    outcome: null,
    assignments: [],
    note: null,
  });
  const drink = (state: ReturnType<typeof table>, cup: number) => {
    const revealed = poison.reduce(state, { type: 'INPUT', uid: 'a', input: { cup } }, ctx());
    assert.equal(revealed.state.phase, 'reveal');
    return { revealed: revealed.state, end: endOf(timeUp(poison, revealed.state).effects) };
  };

  const one = drink(table({ b: 1, c: 2 }), 1);
  assert.deepEqual(one.end.highlights, [{ kind: 'poison-hit', uid: 'a' }]);
  assert.equal(one.end.assignments?.[0]?.fromUid, 'b', 'the lone poisoner handed it out');

  const two = drink(table({ b: 1, c: 1 }), 1);
  assert.deepEqual(two.end.highlights, [{ kind: 'poison-stacked', uid: 'a', n: 2 }]);
  assert.equal(two.end.assignments?.[0]?.fromUid, undefined, 'two poisoners, no single giver');

  assert.deepEqual(drink(table({ b: 1, c: 2 }), 0).end.highlights, [{ kind: 'poison-clean', uid: 'a' }]);
  assert.deepEqual(drink(table({ b: 1, c: 2 }, 0), 0).end.highlights, [
    { kind: 'poison-antidote', uid: 'a' },
  ]);
});

test('Fake It: caught early, caught late, got away, and a convicted innocent', () => {
  const base = fakeIt.createInitialState(ctx());
  const record = (roundNo: number, result: 'caught' | 'split' | 'innocent', accusedUid: string | null) => ({
    roundNo,
    prompt: 'p',
    accusedUid,
    result,
    votes: {},
  });
  const faker = base.fakerUid;
  const innocent = players.find((p) => p.uid !== faker)!.uid;

  const early = {
    ...base,
    phase: 'verdict' as const,
    roundNo: 1,
    history: { 1: record(1, 'caught', faker) },
  };
  assert.deepEqual(endOf(timeUp(fakeIt, early).effects).highlights, [
    { kind: 'fake-caught', uid: faker },
  ]);

  const late = {
    ...base,
    phase: 'verdict' as const,
    roundNo: 2,
    history: { 1: record(1, 'split', null), 2: record(2, 'caught', faker) },
  };
  assert.deepEqual(endOf(timeUp(fakeIt, late).effects).highlights, [
    { kind: 'fake-caught-late', uid: faker, n: 2 },
  ]);

  const away = {
    ...base,
    phase: 'unmask' as const,
    roundNo: 3,
    history: {
      1: record(1, 'split', null),
      2: record(2, 'split', null),
      3: record(3, 'innocent', innocent),
    },
  };
  assert.deepEqual(endOf(timeUp(fakeIt, away).effects).highlights, [
    { kind: 'fake-escaped', uid: faker },
    { kind: 'fake-innocent', uid: innocent },
  ]);
});
