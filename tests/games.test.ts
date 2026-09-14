import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Harness } from './harness.ts';
import { tiny } from './tinyGame.ts';
import { activeTimer } from '../src/types.ts';
import { stageKeyOf } from '../src/state/protocol.ts';

import fakeIt, { BRIEF_MS, GESTURE_MS } from '../src/games/FakeIt/definition.ts';
import horseRace, { BET_MS, RACE_MS } from '../src/games/HorseRace/definition.ts';
import slots, { HOLD_MS } from '../src/games/Slots/definition.ts';
import boomCup, { IDLE_MS } from '../src/games/BoomCup/definition.ts';

/**
 * ============================================================
 *  The same protocol, across the real games
 * ============================================================
 * The scenario tests pin the engine down with a test-only game. These run the
 * four games named in the plan — the ones whose failures were reported — and
 * check the invariants that used to break:
 *
 *   - every stage's countdown belongs to that stage (the Horse Race "the race
 *     already finished" view bug),
 *   - the phase id moves when the internal phase moves,
 *   - a submission from an earlier stage is refused rather than replayed,
 *   - a host reload never re-rolls a round that is already running.
 */

const games = [fakeIt, horseRace, slots, boomCup, tiny];

async function started(game: (typeof games)[number], players = ['host', 'p2', 'p3']) {
  const h = new Harness({ game, allGames: games, players });
  h.start();
  await h.settle();
  await h.startGame();
  assert.equal(h.phase, 'playing', `${game.id} is on screen`);
  return h;
}

/** A valid input for the game, in the phase it opens in. */
function openingInput(def: (typeof games)[number]): unknown {
  switch (def.id) {
    case 'fakeit':
      return { action: 'ready' };
    case 'horse-race':
      return { action: 'bet', horseId: 'h1' };
    case 'slots':
      return { action: 'spin' };
    case 'boom-cup':
      return { shot: { dx: 0, dy: -260, ms: 120 } };
    default:
      return { action: 'tap' };
  }
}

for (const game of [fakeIt, horseRace, slots, boomCup]) {
  test(`${game.name}: its opening stage carries its own countdown, on its own phase`, async () => {
    const h = await started(game);
    const timer = h.timer;
    assert.ok(timer, `${game.id} armed a countdown on BEGIN`);
    assert.equal(timer.roundId, h.engine.roundId);
    assert.equal(timer.phaseId, h.engine.phaseId);
    assert.equal(h.engine.stageKey, stageKeyOf(h.engine.roundId, h.engine.phaseId));
    assert.deepEqual(h.mixedSnapshots(), [], 'no snapshot ever paired a stage with another stage’s timer');

    const expected = {
      fakeit: BRIEF_MS,
      'horse-race': BET_MS,
      // Slots' lever window is module-private (SPIN_WINDOW_MS = 30s)
      slots: 30_000,
      'boom-cup': IDLE_MS,
    }[game.id];
    assert.equal(timer.durationMs, expected, 'the game’s own duration is on the clock');

    // the view layer only ever draws a deadline that belongs to this stage
    assert.equal(activeTimer(h.store.snapshot())?.id, timer.id);
  });

  test(`${game.name}: an input from the previous phase is refused, not replayed`, async () => {
    const h = await started(game);
    const stateBefore = JSON.stringify(h.state);
    // a submission stamped with a stage this room is not in — a delayed write
    // that survived a reconnect, arriving after the phase moved on
    const staleId = h.submitStale('host', openingInput(game), 'old-round', 'old-phase');
    await h.settle();
    const entry = (h.engine.game?.inputs ?? {})[staleId];
    assert.equal(entry, undefined, 'a submission from a finished round is dropped, not kept');
    assert.equal(JSON.stringify(h.state), stateBefore, 'and it changed nothing');
    assert.deepEqual(h.mixedSnapshots(), []);
    assert.ok(
      h.logKinds().includes('input-rejected'),
      'the refusal is on the record: the phone that sent it can be told why',
    );
  });

  test(`${game.name}: a host reload mid-round does not re-roll the round`, async () => {
    const h = await started(game);
    const roundId = h.engine.roundId;
    const timerId = h.timer?.id;
    const stateBefore = JSON.stringify(h.state);

    await h.reload();

    assert.equal(h.engine.roundId, roundId, 'the same round instance');
    assert.equal(h.timer?.id, timerId, 'the same countdown (not re-armed)');
    assert.equal(JSON.stringify(h.state), stateBefore, 'and the same state');
    assert.equal(h.engine.recovery, null);
  });

  test(`${game.name}: a skipped round leaves no work from that round behind`, async () => {
    const h = await started(game);
    // queue work in this stage, then skip
    h.store.patch({
      [`engine/game/inputs/queued`]: {
        inputId: 'queued',
        uid: 'host',
        forUid: null,
        at: h.clock.now,
        roundId: h.engine.roundId,
        phaseId: h.engine.phaseId,
        stageKey: h.engine.stageKey,
        input: openingInput(game),
      },
    });
    await h.run({ type: 'skip' });
    assert.equal(h.phase, 'outcome', 'the round was skipped');
    await h.settle();
    await h.settle();
    assert.equal(
      Object.keys(h.engine.game?.inputs ?? {}).length,
      0,
      'no submissions survive into the outcome screen',
    );
    assert.equal(h.timer, null, 'and the round’s countdown is gone with it');
  });
}

test('Fake It: the final card-read tap at the deadline hands over a full gesture countdown', async () => {
  const h = await started(fakeIt);
  assert.equal(h.state.phase, 'brief');

  await h.submit('host', { action: 'ready' });
  await h.submit('p2', { action: 'ready' });
  const briefTimer = h.timer!;

  // the last phone taps with the private card's deadline a millisecond away
  h.clock.advance(BRIEF_MS - 1);
  await h.submit('p3', { action: 'ready' });

  assert.equal(h.state.phase, 'gesture', 'the countdown phase started');
  const gesture = h.timer!;
  assert.notEqual(gesture.id, briefTimer.id, 'a countdown of its own');
  assert.equal(gesture.durationMs, GESTURE_MS);
  assert.equal(gesture.endsAt - h.clock.now, GESTURE_MS, 'the table gets all ten seconds');

  // the private card's deadline expires; the gesture countdown is untouched
  h.clock.advance(1);
  await h.settle();
  assert.equal(h.state.phase, 'gesture');
  assert.equal(h.timer?.id, gesture.id);
});

test('Horse Race: the racing phase is never handed the betting deadline', async () => {
  const h = await started(horseRace);
  assert.equal(h.state.phase, 'betting');
  const betTimer = h.timer!;
  assert.equal(betTimer.durationMs, BET_MS);

  h.clock.advance(BET_MS - 1);
  for (const uid of h.playerUids) await h.submit(uid, { action: 'bet', horseId: 'h2' });

  assert.equal(h.state.phase, 'racing', 'every bet is in → the field runs');
  const race = h.timer!;
  assert.notEqual(race.phaseId, betTimer.phaseId, 'the race is a new stage');
  assert.equal(race.durationMs, RACE_MS);
  // a phone drawing the race from this snapshot computes elapsed = 0, not "already over"
  assert.ok(race.endsAt > h.clock.now, 'the race has not finished yet');
  assert.equal(activeTimer(h.store.snapshot())?.id, race.id);

  // ...and when the betting deadline passes, nothing about the race changes
  h.clock.advance(1);
  await h.settle();
  assert.equal(h.state.phase, 'racing');
  assert.equal(h.timer?.id, race.id);

  // the race runs out: the result stage arrives with its own clock
  h.clock.advance(RACE_MS + 1);
  await h.settle();
  assert.notEqual(h.state.phase, 'racing');
  assert.deepEqual(h.mixedSnapshots(), []);
});

test('Slots: the reels hold on their own clock, and a reload keeps them holding', async () => {
  const h = await started(slots);
  const window = h.timer!;
  assert.equal(window.durationMs, 30_000);

  // everybody spins → the reels hold for a look, on a fresh stage and clock
  for (const uid of h.playerUids) await h.submit(uid, { action: 'spin' });
  assert.equal(h.state.phase, 'hold');
  const hold = h.timer!;
  assert.notEqual(hold.id, window.id);
  assert.equal(hold.durationMs, HOLD_MS);
  assert.notEqual(hold.phaseId, window.phaseId, 'the hold is its own stage');

  await h.reload();
  assert.equal(h.timer?.id, hold.id, 'a reload does not restart the hold');
  assert.deepEqual(h.mixedSnapshots(), []);
});
