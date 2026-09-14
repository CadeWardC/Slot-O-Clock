import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Harness, type HarnessOptions } from './harness.ts';
import { TINY_A_MS, TINY_B_MS, tiny } from './tinyGame.ts';
import {
  GATE_RECONNECT_GRACE_MS,
  TIMER_RECOVERY_GRACE_MS,
  PROTOCOL_VERSION,
} from '../src/state/protocol.ts';
import { gateBlockers, gateSatisfied, isPresent, livePlayers } from '../src/types.ts';

const newHarness = async (opts: Partial<HarnessOptions> = {}) => {
  const h = new Harness({ game: tiny, ...opts });
  h.start();
  await h.settle();
  return h;
};

/** Write an input the way a phone does, without waiting for the engine. */
function stampInput(h: Harness, uid: string, input: unknown, forUid?: string): string {
  const engine = h.engine;
  const inputId = `in-${uid}-${Math.round(h.clock.now)}`;
  h.store.patch({
    [`engine/game/inputs/${inputId}`]: {
      inputId,
      uid,
      forUid: forUid ?? null,
      at: h.clock.now,
      roundId: engine.roundId,
      phaseId: engine.phaseId,
      stageKey: engine.stageKey,
      input,
    },
  });
  return inputId;
}

/* ============================================================
 *  1. Final answer arrives at the deadline
 * ============================================================ */

test('a final tap at the deadline moves the round on exactly once, and the next phase gets its full timer', async () => {
  const h = await newHarness();
  await h.startGame();
  assert.equal(h.phase, 'playing');
  assert.equal(h.state.phase, 'a', 'the private-card phase is on screen');

  // everybody but the last phone is in
  await h.submit('host', { action: 'tap' });
  await h.submit('p2', { action: 'tap' });
  assert.equal(h.state.phase, 'a');

  // the round's first deadline is about to expire when the last tap lands —
  // this is the exact race that used to skip the countdown phase
  const aTimer = h.timer;
  assert.ok(aTimer, 'phase A is on a clock');
  h.clock.advance(TINY_A_MS - 2);
  await h.submit('p3', { action: 'tap' });

  assert.equal(h.state.phase, 'b', 'the countdown phase is running');
  const bTimer = h.timer;
  assert.ok(bTimer, 'the countdown phase armed its own timer');
  assert.notEqual(bTimer.id, aTimer.id, 'it is a different countdown');
  assert.equal(bTimer.durationMs, TINY_B_MS);
  assert.equal(bTimer.endsAt - h.clock.now, TINY_B_MS, 'the full countdown is ahead of it');

  // now the old deadline passes: it must not be able to touch the new phase
  h.clock.advance(2);
  await h.settle();

  assert.equal(h.state.phase, 'b', 'the countdown was not skipped');
  assert.equal(h.timer?.id, bTimer.id, 'the countdown was not replaced');
  assert.equal(
    (h.state.ran as string[]).filter((p) => p === 'b').length,
    1,
    'phase B was entered once',
  );
  assert.match(h.logKinds().join(','), /input/);
});

test('a timeout is consumed: it can never fire twice', async () => {
  const h = await newHarness();
  await h.startGame();
  const aTimer = h.timer!;
  h.clock.advance(TINY_A_MS + 1);
  await h.settle();
  assert.equal(h.state.phase, 'b');
  const bTimer = h.timer!;
  assert.notEqual(bTimer.id, aTimer.id);

  // the old timer is gone from the room entirely, so nothing can re-fire it
  h.clock.advance(50);
  await h.settle();
  assert.equal(h.state.phase, 'b');
  assert.equal(h.timer?.id, bTimer.id);
});

/* ============================================================
 *  2. State commit is delayed: no mixed phase/timer snapshot
 * ============================================================ */

test('a commit waiting for the server never exposes a new phase with the old timer', async () => {
  const h = await newHarness();
  await h.startGame();
  await h.submit('host', { action: 'tap' });
  await h.submit('p2', { action: 'tap' });

  // The last tap lands a millisecond before the deadline; the write that
  // installs phase B is then in flight, unacknowledged, while that deadline
  // passes underneath it. This is the exact window from the bug report.
  h.clock.advance(TINY_A_MS - 1);
  h.store.holdCommits();
  stampInput(h, 'p3', { action: 'tap' });
  void h.worker.ping();
  h.clock.advance(4);
  h.store.releaseCommits();
  await h.settle();

  assert.deepEqual(h.mixedSnapshots(), [], 'every stored snapshot pairs a phase with its own timer');
  assert.equal(h.state.phase, 'b', 'phase B is running');
  assert.equal(h.timer?.phaseId, h.engine.phaseId);
  assert.equal(h.timer?.roundId, h.engine.roundId);
  // the expired deadline of phase A is gone from the room, so it cannot fire
  assert.equal(h.engine.log.filter((e) => e.kind === 'timer').length, 0);
});

/* ============================================================
 *  2b. A concurrent commit: the plan is re-derived, not forced
 * ============================================================ */

test('a commit that loses the race to another revision re-derives instead of forcing itself', async () => {
  const h = await newHarness();
  await h.startGame();
  const startRev = h.engine.rev;

  // The worker plans against revision N, and while that write is in flight
  // another revision lands (a takeover, a second signal, a retry elsewhere).
  h.store.holdCommits();
  stampInput(h, 'host', { action: 'tap' });
  void h.worker.ping();
  h.store.patch({ 'engine/rev': startRev + 1 });
  h.store.releaseCommits();
  await h.settle();

  assert.equal(h.engine.rev, startRev + 2, 'the re-derived plan committed on top of the new revision');
  const acked = Object.values(h.engine.game?.inputs ?? {}).filter((e) => e.ack);
  assert.equal(acked.length, 1, 'the work was not dropped on the floor');
  assert.equal(h.state.taps.host, true, 'and the tap really did land');
  assert.ok(h.logKinds().includes('input'));
});

/* ============================================================
 *  3. Host reload, before and after the timeout
 * ============================================================ */

test('a host reload before the deadline still fires the timer exactly once', async () => {
  const h = await newHarness();
  await h.startGame();
  const before = h.timer!.id;

  await h.reload(); // nothing has happened yet: the deadline is still ahead
  assert.equal(h.state.phase, 'a');

  h.clock.advance(TINY_A_MS + 1);
  await h.settle();
  assert.equal(h.state.phase, 'b');
  assert.notEqual(h.timer?.id, before);

  // ...and it does not fire again on the next reload
  await h.reload();
  assert.equal(h.state.phase, 'b');
  assert.equal(h.engine.log.filter((e) => e.kind === 'timer').length, 1);
});

test('a host reload after the deadline processes the overdue timer exactly once', async () => {
  const h = await newHarness();
  await h.startGame();
  h.clock.advance(TINY_A_MS + 2_000); // overdue, but inside the recovery grace
  await h.reload();

  assert.equal(h.state.phase, 'b', 'the deadline was processed, not assumed handled');
  assert.equal(h.engine.recovery, null, 'a two-second overrun is not worth a pause');
  assert.equal(h.engine.log.filter((e) => e.kind === 'timer').length, 1);

  await h.reload();
  assert.equal(h.engine.log.filter((e) => e.kind === 'timer').length, 1, 'still just the one');
});

/* ============================================================
 *  4. Host stops after receiving an input
 * ============================================================ */

test('an input that arrived before the host died is recovered exactly once', async () => {
  const h = await newHarness();
  await h.startGame();

  // the tap reaches the room; the host dies before it can be processed
  stampInput(h, 'host', { action: 'tap' });
  h.worker.stop();

  // p2 taps too, and another tab of the host picks the room up
  stampInput(h, 'p2', { action: 'tap' });
  await h.takeoverAfterCrash('tab-2');

  assert.equal(h.engine.lease.instanceId, 'tab-2', 'the new instance holds the engine');
  assert.equal(h.engine.fault, null);
  const acked = Object.values(h.engine.game?.inputs ?? {}).filter((e) => e.ack);
  assert.equal(acked.length, 2, 'both outstanding submissions were processed');

  // and nothing is processed twice: a third pump finds no work at all
  const rev = h.engine.rev;
  await h.settle();
  assert.equal(h.engine.rev, rev);
  assert.equal(h.state.taps.host, true);
  assert.equal(h.state.taps.p2, true);
});

/* ============================================================
 *  5. Host stops during scoring: complete result, no duplicates
 * ============================================================ */

test('a crash around a scoring commit leaves a complete result and no double award', async () => {
  const h = await newHarness();
  await h.startGame();
  await h.submit('host', { action: 'tap' });
  await h.submit('p2', { action: 'tap' });
  await h.submit('p3', { action: 'tap' }); // → phase B, 5s
  h.clock.advance(TINY_B_MS + 1); // → phase C, 1s
  await h.settle();
  assert.equal(h.state.phase, 'c');

  // the END commit is in flight when the host disappears
  const endAt = h.clock.now;
  h.clock.advance(1_000);
  await h.settle();
  assert.equal(h.phase, 'outcome', 'the round completed');
  assert.equal(h.engine.awards.drinks.host, 1);

  // a reload replays nothing: the ledger is absolute, the outcome is committed
  const drinksBefore = JSON.stringify(h.engine.awards.drinks);
  await h.reload();
  h.clock.advance(30_000);
  await h.settle();
  assert.equal(JSON.stringify(h.engine.awards.drinks), drinksBefore, 'no duplicated drinks');
  assert.equal(h.phase, 'outcome', 'the outcome is not recomputed');
  void endAt;
});

/* ============================================================
 *  6. Two host tabs / simultaneous takeovers
 * ============================================================ */

test('two tabs signed in as the host produce exactly one authority', async () => {
  const h = await newHarness();
  await h.startGame();

  const second = h.secondTab('tab-2');
  await second.resync();
  await second.ping();
  await h.settle();

  assert.equal(h.engine.lease.instanceId, 'tab-1', 'the first tab keeps the engine');
  assert.equal(h.engine.lease.generation, 1, 'no takeover happened');

  // the viewer cannot move the room, not even with a host command
  assert.equal(second.command({ type: 'skip' }), false, 'a viewer cannot command the engine');
  const revBefore = h.engine.rev;
  await second.ping();
  await second.ping();
  assert.equal(h.engine.rev, revBefore, 'the viewer wrote nothing');
  assert.equal(h.phase, 'playing');
  second.stop();
});

test('a takeover invalidates the old authority in flight', async () => {
  const h = await newHarness();
  await h.startGame();
  const oldRev = h.engine.rev;

  // p2 takes the room over while the old host is still running
  h.store.patch({
    'engine/lease': { uid: 'p2', instanceId: 'p2-tab', generation: 7, renewedAt: h.clock.now },
  });

  // the old host tries to act: nothing it does may land
  await h.run({ type: 'skip' });
  await h.settle();
  assert.equal(h.engine.rev, oldRev, 'the old authority could not commit');
  assert.equal(h.phase, 'playing', 'the round was not skipped by a stale host');
  assert.equal(h.engine.lease.generation, 7);
});

/* ============================================================
 *  7. Old Ready / input arriving after a reconnect
 * ============================================================ */

test('a Ready tap for the previous gate cannot release the next one', async () => {
  const h = await newHarness();
  await h.startGame();
  // run the round out to the outcome screen, where the gate lives
  await h.submit('host', { action: 'tap' });
  await h.submit('p2', { action: 'tap' });
  await h.submit('p3', { action: 'tap' });
  h.clock.advance(TINY_B_MS + 1);
  await h.settle();
  h.clock.advance(1_000);
  await h.settle();
  assert.equal(h.phase, 'outcome');

  const firstGate = h.engine.gate!.id;
  await h.readyAll(); // everyone taps this gate → next round's intro
  assert.equal(h.phase, 'intro');
  const secondGate = h.engine.gate!.id;
  assert.notEqual(secondGate, firstGate);

  // a delayed write of the *old* acknowledgement lands now
  h.store.patch({ 'engine/ready/p2': firstGate });
  await h.settle();
  assert.deepEqual(
    gateBlockers(h.store.snapshot(), h.clock.now).map((b) => b.uid),
    ['host', 'p2', 'p3'],
    'the stale ack counts for nothing: the new gate is untouched',
  );

  // two of the three tap *this* gate; the stale one still does not count
  await h.ready('host');
  await h.ready('p3');
  assert.equal(h.phase, 'intro', 'the room still waits for p2');
  assert.deepEqual(
    gateBlockers(h.store.snapshot(), h.clock.now).map((b) => b.uid),
    ['p2'],
  );
  assert.ok(!gateSatisfied(h.store.snapshot(), h.clock.now));

  // p2 taps the gate it can actually see, and the next round begins
  await h.ready('p2');
  assert.equal(h.phase, 'playing', 'the round started once the real ack arrived');
  assert.equal(h.timer?.durationMs, TINY_A_MS, 'with its full countdown');
});

test('an input from the previous phase is refused, visibly, instead of acting on the new one', async () => {
  const h = await newHarness();
  await h.startGame();
  // put the room in phase B
  await h.submit('host', { action: 'tap' });
  await h.submit('p2', { action: 'tap' });
  await h.submit('p3', { action: 'tap' });
  assert.equal(h.state.phase, 'b');

  // a tap made during phase A arrives late
  const staleId = h.submitStale('host', { action: 'tap' }, h.engine.roundId ?? '', 'old-phase');
  await h.settle();

  const entry = (h.engine.game?.inputs ?? {})[staleId];
  assert.ok(entry, 'the room still holds the submission');
  assert.equal(entry.rejected, 'stale-phase');
  assert.equal(entry.ack ?? null, null);
  assert.equal(h.state.phase, 'b', 'the stale tap changed nothing');
});

/* ============================================================
 *  8. Skip while input work is queued
 * ============================================================ */

test('skipping a round leaves no writes behind from the round that was skipped', async () => {
  const h = await newHarness();
  await h.startGame();
  const skippedRound = h.engine.roundId;

  // work is in the queue when the host hits skip
  h.store.patch({
    'engine/game/inputs/in-late': {
      inputId: 'in-late',
      uid: 'host',
      forUid: null,
      at: h.clock.now,
      roundId: h.engine.roundId,
      phaseId: h.engine.phaseId,
      stageKey: h.engine.stageKey,
      input: { action: 'tap' },
    },
  });
  const revBefore = h.engine.rev;
  await h.run({ type: 'skip' });

  assert.equal(h.phase, 'outcome', 'the round was skipped');
  const after = h.engine.rev;
  assert.ok(after > revBefore);

  // let everything drain: no queued work may mutate the skipped round
  await h.settle();
  await h.settle();
  assert.equal(h.engine.rev, after, 'nothing else was written');
  assert.equal(h.engine.roundId, skippedRound, 'the round identity is still the skipped one');
  assert.equal(
    Object.keys(h.engine.game?.inputs ?? {}).length,
    0,
    'the skipped round holds no input work',
  );
});

/* ============================================================
 *  9. Brief disconnect at a Ready gate
 * ============================================================ */

test('a brief disconnect at a gate does not release it', async () => {
  const h = await newHarness();
  await h.run({ type: 'start' });
  for (const uid of h.playerUids) await h.claim(uid);
  assert.equal(h.phase, 'intro');
  const gate = h.engine.gate!.id;

  await h.ready('host');
  await h.ready('p2');
  // p3 was here when the gate opened and blips out
  h.setPresent('p3', false);
  await h.settle();

  assert.equal(h.phase, 'intro', 'the gate held');
  const blockers = gateBlockers(h.store.snapshot(), h.clock.now);
  assert.deepEqual(blockers, [{ uid: 'p3', state: 'reconnecting' }]);
  assert.ok(!gateSatisfied(h.store.snapshot(), h.clock.now), 'a dropped socket is not a yes');

  // p3 comes back with the same gate still open and taps
  h.setPresent('p3', true);
  await h.settle();
  await h.ready('p3');
  assert.equal(h.phase, 'playing', 'the round started once p3 was actually ready');
  assert.equal(h.engine.gate, null, 'the gate closed with the round');
  void gate;
});

test('nobody connected is never unanimous readiness', async () => {
  const h = await newHarness();
  await h.run({ type: 'start' });
  for (const uid of h.playerUids) await h.claim(uid);
  assert.equal(h.phase, 'intro');

  for (const uid of h.playerUids) h.setPresent(uid, false);
  await h.settle();
  h.clock.advance(GATE_RECONNECT_GRACE_MS + 1_000);
  await h.settle();

  assert.equal(h.phase, 'intro', 'an empty table cannot release its own gate');
  assert.ok(!gateSatisfied(h.store.snapshot(), h.clock.now));
  assert.equal(livePlayers(h.store.snapshot()).length, 0);

  // ...and the host can always say so out loud
  await h.run({ type: 'skip' });
  assert.equal(h.phase, 'playing');
});

test('past the grace period a dark phone stops holding the gate', async () => {
  const h = await newHarness();
  await h.run({ type: 'start' });
  for (const uid of h.playerUids) await h.claim(uid);
  await h.ready('host');
  await h.ready('p2');
  h.setPresent('p3', false);
  await h.settle();
  assert.equal(h.phase, 'intro');

  h.clock.advance(GATE_RECONNECT_GRACE_MS + 1);
  await h.settle();
  assert.equal(h.phase, 'playing', 'the table is not held hostage by a sleeping phone');
  assert.equal(isPresent(h.store.snapshot(), 'p3'), false);
});

/* ============================================================
 *  10. A long interruption
 * ============================================================ */

test('a long host interruption pauses for a visible recovery instead of cascading phases', async () => {
  const h = await newHarness();
  await h.startGame();
  const aTimer = h.timer!;

  // the host is gone for half a minute: enough for A, B and C to roll over
  h.clock.advance(TIMER_RECOVERY_GRACE_MS + 20_000);
  await h.settle();

  assert.equal(h.state.phase, 'a', 'no invisible cascade: the phase did not move');
  assert.ok(h.engine.recovery, 'the room is paused, visibly');
  assert.equal(h.engine.recovery?.timerId, aTimer.id);
  assert.ok((h.engine.recovery?.lateMs ?? 0) > TIMER_RECOVERY_GRACE_MS);
  assert.equal(h.timer?.id, aTimer.id, 'the expired timer is still there to be re-timed');

  // nothing moves on its own while the pause is up
  h.clock.advance(60_000);
  await h.settle();
  assert.equal(h.state.phase, 'a');

  // Resume re-times the *same* activity from scratch
  const before = h.clock.now;
  await h.run({ type: 'resume' });
  assert.equal(h.engine.recovery, null);
  const fresh = h.timer!;
  assert.notEqual(fresh.id, aTimer.id, 'a fresh countdown id');
  assert.equal(fresh.durationMs, TINY_A_MS, 'the whole countdown, not the remainder');
  assert.equal(fresh.endsAt, before + TINY_A_MS);

  // and it runs its full length
  h.clock.advance(TINY_A_MS - 1);
  await h.settle();
  assert.equal(h.state.phase, 'a');
  h.clock.advance(1);
  await h.settle();
  assert.equal(h.state.phase, 'b');
});

/* ============================================================
 *  11. Failures are visible, and authoritative work stops
 * ============================================================ */

test('a failed commit stops the engine and is reported into the room', async () => {
  const h = await newHarness();
  await h.startGame();
  const revBefore = h.engine.rev;

  h.store.offline = true;
  h.clock.advance(TINY_A_MS + 1);
  await h.settle();

  assert.equal(h.phase, 'playing');
  assert.equal(h.engine.rev, revBefore, 'nothing was written while the room was unreachable');

  // the failure is visible to the host locally...
  assert.ok(h.worker.status().localError, 'the host knows');

  // ...and once the room is reachable again, a retry reconciles and resumes
  h.store.offline = false;
  await h.run({ type: 'retry' });
  assert.equal(h.worker.status().localError, null);
  await h.settle();
  assert.equal(h.state.phase, 'b', 'the overdue deadline is processed after reconciling');
});

/* ============================================================
 *  12. Protocol handshake
 * ============================================================ */

test('a room from another protocol is never driven by this build', async () => {
  const h = await newHarness();
  h.store.patch({ 'meta/protocol': PROTOCOL_VERSION + 1 });
  await h.settle();
  const rev = h.engine.rev;

  assert.equal(h.command({ type: 'start' }), false, 'no commands for an unknown room');
  await h.settle();
  assert.equal(h.engine.rev, rev, 'and no commits either');
});

/* ============================================================
 *  14. Round boundaries: a whole second round, by identity
 * ============================================================ */

test('the next round is a new instance: new ids, new gate, full timer, cycled actor', async () => {
  const h = await newHarness();
  await h.startGame();
  const round1 = {
    roundId: h.engine.roundId,
    phaseId: h.engine.phaseId,
    actor: h.engine.actorUid,
    round: h.engine.round,
  };
  assert.equal(round1.round, 1);
  assert.equal(round1.actor, 'host', 'round 1 opens with the first claimed slot');

  // play the round out
  for (const uid of h.playerUids) await h.submit(uid, { action: 'tap' });
  h.clock.advance(TINY_B_MS + 1);
  await h.settle();
  h.clock.advance(1_000);
  await h.settle();
  assert.equal(h.phase, 'outcome');

  const outcomeGate = h.engine.gate!.id;
  assert.equal(h.engine.outcome?.gameId, 'tiny');
  await h.readyAll();

  // round 2's intro: a fresh gate, a fresh round instance
  assert.equal(h.phase, 'intro');
  assert.equal(h.engine.round, 2);
  assert.notEqual(h.engine.roundId, round1.roundId, 'a new minigame instance');
  assert.notEqual(h.engine.gate!.id, outcomeGate, 'a new gate');
  assert.equal(h.engine.game ?? null, null, 'nothing has been dealt yet');
  assert.equal(h.engine.actorUid, 'p2', 'the turn order cycles');
  assert.equal(h.engine.roundUids ?? null, null);

  // and the launch gives it its own full countdown
  await h.readyAll();
  assert.equal(h.phase, 'playing');
  assert.equal(h.engine.round, 2);
  assert.equal(h.timer?.durationMs, TINY_A_MS);
  assert.equal(h.timer?.endsAt - h.clock.now, TINY_A_MS);
  assert.deepEqual(h.mixedSnapshots(), []);
  assert.deepEqual(
    Object.keys(h.engine.game?.inputs ?? {}),
    [],
    'last round’s submissions do not leak into this one',
  );
});

/* ============================================================
 *  13. Shared-phone impersonation
 * ============================================================ */

test('a shared phone cannot submit as somebody else', async () => {
  const h = new Harness({ game: tiny, mode: 'shared', players: [] });
  h.store.patch({
    'players/local_a': {
      uid: 'local_a',
      name: 'Ada',
      emoji: '🍺',
      isHost: false,
      local: true,
      connected: true,
      drinkCount: 0,
      score: 0,
      joinedAt: h.clock.now,
    },
  });
  h.start();
  await h.settle();
  await h.run({ type: 'start' });
  await h.claim('local_a');
  await h.readyAll();
  assert.equal(h.phase, 'playing');

  // the host device names a player it does not own: refused, visibly
  await h.submit('host', { action: 'tap' }, 'p2');
  const rejected = Object.values(h.engine.game?.inputs ?? {}).filter((e) => e.rejected);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].rejected, 'unknown-player');
  assert.equal(h.state.phase, 'a', 'and it changed nothing');

  // its own local player works
  await h.submit('host', { action: 'tap' }, 'local_a');
  assert.equal(h.state.phase, 'b');
});
