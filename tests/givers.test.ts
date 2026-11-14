import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Effect, GameContext, GameDefinition, PlayerInfo, RoomMode } from '../src/engine/types.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import { GIFT_MAX, GIFT_MS, giftStageOf, reduceWithGifts } from '../src/engine/gifts.ts';
import reaction from '../src/games/Reaction/definition.ts';
import slots from '../src/games/Slots/definition.ts';
import wavelength from '../src/games/Wavelength/definition.ts';
import sketchy from '../src/games/Sketchy/definition.ts';
import categories from '../src/games/Categories/definition.ts';

/**
 * ============================================================
 *  Whoever did best hands drinks out
 * ============================================================
 * A game names `givers` on its END; `reduceWithGifts` holds the END back,
 * opens a hand-out stage, and releases it with the gifts added. Each game is
 * driven through the wrapper exactly as the engine drives it.
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
    rng: mulberry32(5),
    now: 1_000_000,
    roundId: 'r1',
    phaseId: 'ph1',
    revision: 1,
  };
}

type End = Extract<Effect, { type: 'END' }>;
const endOf = (effects: Effect[] | undefined) =>
  (effects ?? []).find((fx): fx is End => fx.type === 'END') ?? null;

/** fire the timer the state is sitting on */
function timeUp<S>(def: GameDefinition<S>, state: S, c = ctx()) {
  return reduceWithGifts(def, state, { type: 'TIME_UP', now: c.now }, c);
}

/** the stage opened: no END yet, a fresh input stage, the stage's own clock */
function assertStage(res: { state: unknown; effects?: Effect[] }, givers: [string, number][]) {
  assert.equal(endOf(res.effects), null, 'the END is held back');
  const stage = giftStageOf(res.state);
  assert.ok(stage, 'a hand-out stage is open');
  assert.deepEqual(stage.givers.map((g) => [g.uid, g.sips]), givers);
  assert.ok(res.effects?.some((fx) => fx.type === 'CLEAR_INPUTS'));
  assert.ok(res.effects?.some((fx) => fx.type === 'TIMER' && fx.ms === GIFT_MS));
  return stage;
}

/* ---------------- the wrapper itself ---------------- */

const toy: GameDefinition<{ phase: string }, { win?: string; sips?: number }> = {
  id: 'toy',
  name: 'Toy',
  emoji: '🧸',
  rules: '',
  minPlayers: 1,
  createInitialState: () => ({ phase: 'x' }),
  reduce(state, event) {
    if (event.type !== 'INPUT' || !event.input.win) return { state };
    return {
      state,
      effects: [
        {
          type: 'END',
          assignments: [{ uid: 'c', sips: 1, reason: 'lost' }],
          givers: [{ uid: event.input.win, sips: event.input.sips ?? 2, why: 'Won' }],
        },
      ],
    };
  },
  View: () => null,
};

test('a giver deals, the END comes through with the gifts added', () => {
  const c = ctx();
  const opened = reduceWithGifts(toy, { phase: 'x' }, { type: 'INPUT', uid: 'a', input: { win: 'a' } }, c);
  assertStage(opened, [['a', 2]]);
  // someone else cannot deal on the giver's behalf
  const forged = reduceWithGifts(toy, opened.state, { type: 'INPUT', uid: 'b', input: { gift: { c: 2 } } as never }, c);
  assert.equal(forged.state, opened.state);
  // asking for more than you hold, or giving to yourself, is trimmed
  const dealt = reduceWithGifts(
    toy,
    opened.state,
    { type: 'INPUT', uid: 'a', input: { gift: { a: 5, b: 1, c: 9 } } as never },
    c,
  );
  const end = endOf(dealt.effects);
  assert.ok(end);
  assert.deepEqual(
    end.assignments?.map((x) => [x.uid, x.sips, x.fromUid ?? null]),
    [
      ['c', 1, null],
      ['b', 1, 'a'],
      ['c', 1, 'a'],
    ],
  );
  assert.equal(end.givers, undefined, 'the END that comes out is plain');
  assert.equal(giftStageOf(dealt.state), null, 'the stage is gone');
});

test('the hand-out times out and nothing undealt is charged', () => {
  const c = ctx();
  const opened = reduceWithGifts(toy, { phase: 'x' }, { type: 'INPUT', uid: 'a', input: { win: 'a' } }, c);
  const end = endOf(timeUp(toy, opened.state, c).effects);
  assert.deepEqual(end?.assignments?.map((x) => x.uid), ['c']);
});

test('a giver is capped, and a giver who is not at the table is dropped', () => {
  const c = ctx();
  const big = reduceWithGifts(toy, { phase: 'x' }, { type: 'INPUT', uid: 'a', input: { win: 'a', sips: 50 } }, c);
  assert.equal(giftStageOf(big.state)?.givers[0].sips, GIFT_MAX);
  const ghost = reduceWithGifts(toy, { phase: 'x' }, { type: 'INPUT', uid: 'a', input: { win: 'zed' } }, c);
  assert.equal(giftStageOf(ghost.state), null);
  assert.ok(endOf(ghost.effects), 'no valid giver: the game just ends');
});

/* ---------------- each game's winner ---------------- */

test('Reaction Duel: the fastest honest finger hands out 2, never a false start', () => {
  const done = {
    phase: 'done' as const,
    goAt: 0,
    taps: { a: { ms: 400, early: false }, b: { ms: 250, early: false }, c: { ms: null, early: true } },
    assignments: [{ uid: 'c', sips: 3, reason: 'Tapped before green' }],
    note: null,
  };
  const stage = assertStage(timeUp(reaction, done), [['b', 2]]);
  assert.equal(stage.givers[0].why, 'Fastest finger');
  // everyone jumped: nobody to reward
  const allDq = { ...done, taps: { a: { ms: null, early: true }, b: { ms: null, early: true }, c: { ms: null, early: true } } };
  assert.ok(endOf(timeUp(reaction, allDq).effects));
});

test('Slot Machine: a safe triple hands out 2, three 🎰 hands out 4', () => {
  const hold = {
    phase: 'hold' as const,
    spins: {
      a: { reels: [6, 6, 6], line: 'Triple 🎰. Safe.', sips: 0 },
      b: { reels: [1, 1, 1], line: 'Triple. Safe.', sips: 0 },
      c: { reels: [1, 2, 3], line: 'No match. Drink 1.', sips: 1 },
    },
  };
  const stage = assertStage(timeUp(slots, hold as never), [
    ['a', 4],
    ['b', 2],
  ]);
  assert.deepEqual(stage.givers.map((g) => g.why), ['Jackpot', 'Triple']);
  const nobody = { ...hold, spins: { c: hold.spins.c } };
  assert.ok(endOf(timeUp(slots, nobody as never).effects));
});

test('Wavelength: closest hands out 1, dead on hands out 2, a tie gives each 1', () => {
  const reveal = {
    phase: 'reveal',
    target: 50,
    left: 'cold',
    right: 'hot',
    guesses: { b: 51, c: 90 },
    closestUids: ['b'],
    assignments: [{ uid: 'c', sips: 2, reason: 'far' }],
    average: 70,
    note: '',
  };
  assert.equal(giftStageOf(timeUp(wavelength, reveal as never).state)?.givers[0].why, 'Dead on');
  assertStage(timeUp(wavelength, { ...reveal, guesses: { b: 60, c: 90 } } as never), [['b', 1]]);
  assertStage(timeUp(wavelength, { ...reveal, guesses: { b: 40, c: 60 }, closestUids: ['b', 'c'] } as never), [
    ['b', 1],
    ['c', 1],
  ]);
  // one guess on its own has nobody to beat
  assert.ok(endOf(timeUp(wavelength, { ...reveal, guesses: { b: 50 } } as never).effects));
});

test('Sketchy: the first to get it hands out 1; shared phone has no guesser', () => {
  const reveal = {
    phase: 'reveal',
    options: ['shark'],
    word: 'shark',
    n: 0,
    got: ['c', 'b'],
    strokes: [],
    feed: [],
    verdict: null,
    note: '',
    assignments: [],
  };
  assertStage(timeUp(sketchy, reveal as never), [['c', 1]]);
  assert.ok(endOf(timeUp(sketchy, { ...reveal, got: [] } as never).effects), 'nobody got it');
  const shared = ctx('shared');
  assert.ok(endOf(timeUp(sketchy, { ...reveal, verdict: 'got' } as never, shared).effects));
});

test('Categories: a clean run hands out 2; giving up never does', () => {
  const naming = { category: 'Cheeses', phase: 'naming', pool: 0, punisherUid: 'b', nextAt: 0 };
  const done = reduceWithGifts(categories, naming as never, { type: 'INPUT', uid: 'a', input: { action: 'done' } }, ctx());
  assertStage(done, [['a', 2]]);
  const stacked = reduceWithGifts(
    categories,
    { ...naming, pool: 2 } as never,
    { type: 'INPUT', uid: 'a', input: { action: 'done' } },
    ctx(),
  );
  assert.ok(endOf(stacked.effects));
  const gaveUp = reduceWithGifts(categories, naming as never, { type: 'INPUT', uid: 'a', input: { action: 'giveup' } }, ctx());
  assert.ok(endOf(gaveUp.effects));
});
