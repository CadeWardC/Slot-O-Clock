import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Harness } from './harness.ts';
import type { Effect, GameContext, PlayerInfo } from '../src/engine/types.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import type { CkState } from '../src/games/Chicken/definition.ts';
import chicken, {
  BAIL_GRACE_MS,
  LAST_THUMB_BONUS,
  MAX_VALUE,
  READY_MS,
  TICK_MS,
  timeOf,
  valueAt,
} from '../src/games/Chicken/definition.ts';

/**
 * Chicken: hold while the counter climbs, let go to bank it, bust if you
 * don't. These pin the money down: what a bail banks, who a bust lands on,
 * the last-thumb bonus, that a tap from another stage is ignored, and that
 * nobody can hand out more than they banked.
 */

async function climbing(players = ['host', 'p2', 'p3'], mode: 'party' | 'shared' = 'party') {
  const h = new Harness({ game: chicken, allGames: [chicken], players, mode });
  h.start();
  await h.settle();
  await h.startGame();
  assert.equal(h.phase, 'playing');
  assert.equal(h.state.phase, 'ready');
  assert.equal(h.timer?.durationMs, READY_MS, 'the lead-in is on the clock');
  h.clock.advance(READY_MS);
  await h.settle();
  assert.equal(h.state.phase, 'climb');
  return h;
}

/** move the clock to `ms` into the climb (never past the bust) */
async function at(h: Harness, ms: number) {
  const target = h.state.climbAt + ms;
  assert.ok(target < (h.timer?.endsAt ?? 0), 'this test moment is before the bust');
  h.clock.advance(target - h.clock.now);
  await h.settle();
}

test('Chicken: the counter climbs faster as it goes and stops at 10', () => {
  assert.equal(valueAt(0), 0);
  assert.equal(valueAt(TICK_MS - 1), 0);
  assert.equal(valueAt(TICK_MS), 1);
  assert.equal(valueAt(60_000), 10);
  for (let v = 1; v <= 10; v++) {
    assert.equal(valueAt(timeOf(v)), v, `the counter shows ${v} at its own tick`);
    assert.equal(valueAt(timeOf(v) - 2), v - 1);
  }
  assert.ok(timeOf(10) - timeOf(9) < timeOf(2) - timeOf(1), 'late ticks come quicker');
});

test('Chicken: the bust moment is armed as the timer and is not in the state', async () => {
  const h = await climbing();
  const bustIn = (h.timer?.endsAt ?? 0) - h.state.climbAt;
  assert.ok(bustIn >= 3000 && bustIn <= 14000, `bust lands in the 3-14s window (${bustIn})`);
  assert.ok(!JSON.stringify(h.state).includes(String(h.timer?.endsAt)), 'no phone can read it');
});

test('Chicken: a bail banks the counter at the moment the thumb came off', async () => {
  const h = await climbing(['host', 'p2', 'p3', 'p4']);
  await at(h, timeOf(2) + 10);
  // the write landed a little late; the phone's own reading is what counts
  await h.submit('p2', { action: 'bail', at: h.state.climbAt + timeOf(1) + 5 });
  assert.equal(h.state.banks.p2, 1, 'banked what the counter showed when they let go');

  // but not further back than the grace, and never from the future
  await at(h, BAIL_GRACE_MS + timeOf(2) + 50);
  await h.submit('p3', { action: 'bail', at: h.state.climbAt + 1 });
  assert.equal(h.state.banks.p3, valueAt(timeOf(2) + 50), 'an old timestamp is pulled up to the grace');
  await h.submit('p3', { action: 'bail', at: h.clock.now });
  assert.equal(h.state.banks.p3, valueAt(timeOf(2) + 50), 'and one bail is all you get');
  assert.equal(h.state.phase, 'climb', 'two thumbs are still down');
});

test('Chicken: the bust lands on everyone still holding', async () => {
  const h = await climbing(['host', 'p2', 'p3', 'p4']);
  await at(h, timeOf(1) + 10);
  await h.submit('p2', { action: 'bail', at: h.clock.now });
  const bustIn = (h.timer?.endsAt ?? 0) - h.state.climbAt;
  h.clock.advance((h.timer?.endsAt ?? 0) - h.clock.now);
  await h.settle();
  assert.equal(h.state.phase, 'bust');
  assert.deepEqual([...h.state.busted].sort(), ['host', 'p3', 'p4']);
  assert.equal(h.state.bustValue, valueAt(bustIn));

  // the bust is shown, then p2 hands out, then the round ends
  h.clock.advance((h.timer?.endsAt ?? 0) - h.clock.now);
  await h.settle();
  assert.equal(h.state.phase, 'gift');
  await h.submit('p2', { action: 'gift', give: { host: 1 } });
  assert.equal(h.phase, 'outcome');
  const drinks = h.engine.outcome?.assignments ?? [];
  for (const uid of ['p3', 'p4']) {
    assert.equal(drinks.filter((a) => a.uid === uid).reduce((n, a) => n + a.sips, 0), valueAt(bustIn));
  }
  assert.equal(
    drinks.filter((a) => a.uid === 'host').reduce((n, a) => n + a.sips, 0),
    valueAt(bustIn) + 1,
    'the bust and the gift both land',
  );
  assert.equal(drinks.filter((a) => a.uid === 'p2').length, 0, 'whoever got out drinks nothing');
});

test('Chicken: the last thumb left wins the counter plus the bonus, with no bust', async () => {
  const h = await climbing(['host', 'p2', 'p3']);
  await at(h, timeOf(1) + 10);
  await h.submit('p2', { action: 'bail', at: h.clock.now });
  assert.equal(h.state.phase, 'climb');
  await at(h, timeOf(2) + 10);
  await h.submit('p3', { action: 'bail', at: h.clock.now });
  assert.equal(h.state.phase, 'gift', 'the climb ends the moment one thumb is left');
  assert.equal(h.state.lastThumb, 'host');
  assert.equal(h.state.banks.host, 2 + LAST_THUMB_BONUS);
  assert.equal(h.state.banks.p3, 2);
  assert.deepEqual(h.state.busted ?? [], []);
});

test('Chicken: a bail from another stage, or before the counter starts, is ignored', async () => {
  const h = new Harness({ game: chicken, allGames: [chicken], players: ['host', 'p2', 'p3'] });
  h.start();
  await h.settle();
  await h.startGame();
  // still in the lead-in: there is nothing to bail from
  await h.submit('p2', { action: 'bail', at: h.clock.now });
  assert.deepEqual(h.state.banks ?? {}, {});

  h.clock.advance(READY_MS);
  await h.settle();
  const before = JSON.stringify(h.state);
  const staleId = h.submitStale('p2', { action: 'bail', at: h.clock.now }, 'old-round', 'old-phase');
  await h.settle();
  assert.equal((h.engine.game?.inputs ?? {})[staleId], undefined);
  assert.equal(JSON.stringify(h.state), before, 'a late write from an earlier stage changes nothing');

  // and a gift while the counter is still running is not a thing
  await h.submit('p2', { action: 'gift', give: { host: 5 } });
  assert.equal(JSON.stringify(h.state), before);
});

test('Chicken: nobody hands out more than they banked, or to themselves', async () => {
  const h = await climbing(['host', 'p2', 'p3']);
  await at(h, timeOf(3) + 10);
  await h.submit('p2', { action: 'bail', at: h.clock.now });
  await h.submit('p3', { action: 'bail', at: h.clock.now });
  assert.equal(h.state.phase, 'gift');
  assert.equal(h.state.banks.p2, 3);
  assert.equal(h.state.banks.host, 3 + LAST_THUMB_BONUS);

  await h.submit('p2', { action: 'gift', give: { p2: 2, host: 2, p3: 9, nobody: 4 } });
  assert.deepEqual(h.state.gifts.p2, { host: 2, p3: 1 }, 'clamped to the 3 they banked');
  await h.submit('p2', { action: 'gift', give: { host: 3 } });
  assert.deepEqual(h.state.gifts.p2, { host: 2, p3: 1 }, 'and the first hand-out is final');

  await h.submit('p3', { action: 'gift', give: { host: 3 } });
  await h.submit('host', { action: 'gift', give: { p2: 99 } });
  assert.equal(h.phase, 'outcome', 'the round ends when every banker has dealt');
  const drinks = h.engine.outcome?.assignments ?? [];
  const total = (uid: string) => drinks.filter((a) => a.uid === uid).reduce((n, a) => n + a.sips, 0);
  assert.equal(total('host'), 5);
  assert.equal(total('p3'), 1);
  assert.equal(total('p2'), 3 + LAST_THUMB_BONUS);
});

test('Chicken: on a shared phone only the actor plays, alone', async () => {
  const h = await climbing(['host', 'p2', 'p3'], 'shared');
  const actor = h.engine.actorUid as string;
  const other = ['host', 'p2', 'p3'].find((u) => u !== actor) as string;
  await at(h, timeOf(2) + 10);
  await h.submit('host', { action: 'bail', at: h.clock.now }, other);
  assert.deepEqual(h.state.banks ?? {}, {}, 'a bystander has no thumb in it');
  await h.submit('host', { action: 'bail', at: h.clock.now }, actor);
  assert.equal(h.state.phase, 'gift');
  assert.equal(h.state.banks[actor], 2, 'no last-thumb bonus for playing alone');
});

/* ---------- nothing in Chicken goes past 10 ---------- */

const table: PlayerInfo[] = ['a', 'b', 'c', 'd'].map((uid, i) => ({
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
function tableCtx(now: number): GameContext {
  return {
    players: table,
    actorUid: 'a',
    turnOrder: table.map((p) => p.uid),
    settings: { mode: 'party', pointsMode: false, sipMultiplier: 1, enabledGames: [] },
    rng: mulberry32(7),
    now,
    roundId: 'r1',
    phaseId: 'ph1',
    revision: 1,
  } as GameContext;
}
const base: CkState = {
  phase: 'climb',
  climbAt: 1_000_000,
  banks: {},
  lastThumb: null,
  bustValue: null,
  busted: [],
  gifts: {},
};

test('Chicken: the last thumb at a full counter banks 10, not 12', () => {
  // the counter has been flat at 10 for a while; three have let go, one is left
  const now = base.climbAt! + 60_000;
  const state: CkState = { ...base, banks: { b: 4, c: 6 } };
  const r = chicken.reduce(state, { type: 'INPUT', uid: 'd', input: { action: 'bail', at: now } }, tableCtx(now));
  assert.equal(r.state.lastThumb, 'a');
  assert.equal(r.state.banks.d, MAX_VALUE);
  assert.equal(r.state.banks.a, MAX_VALUE, 'the bonus does not push a bank past the cap');
  // one tick below the cap, the bonus still only reaches it
  const at9 = base.climbAt! + timeOf(9) + 5;
  const r9 = chicken.reduce(state, { type: 'INPUT', uid: 'd', input: { action: 'bail', at: at9 } }, tableCtx(at9));
  assert.equal(r9.state.banks.d, 9);
  assert.equal(r9.state.banks.a, MAX_VALUE);
});

test('Chicken: nobody drinks more than 10 from one round, however many bankers pick on them', () => {
  const state: CkState = {
    ...base,
    phase: 'gift',
    banks: { a: 10, b: 8, c: 6 },
    gifts: { a: { d: 10 }, b: { d: 8 }, c: { d: 3, a: 3 } },
  };
  const r = chicken.reduce(state, { type: 'TIME_UP', now: 0 }, tableCtx(2_000_000));
  const end = (r.effects ?? []).find((fx): fx is Extract<Effect, { type: 'END' }> => fx.type === 'END');
  assert.ok(end);
  const total = (uid: string) => (end.assignments ?? []).filter((x) => x.uid === uid).reduce((n, x) => n + x.sips, 0);
  assert.equal(total('d'), MAX_VALUE);
  assert.equal(total('a'), 3, 'everyone else is untouched');
  assert.ok((end.assignments ?? []).every((x) => x.sips > 0), 'no empty lines on the drinks screen');
  // a bust on top of gifts is capped the same way
  const bust: CkState = { ...state, busted: ['d'], bustValue: 9, gifts: { a: { d: 10 } } };
  const rb = chicken.reduce(bust, { type: 'TIME_UP', now: 0 }, tableCtx(2_000_000));
  const endB = (rb.effects ?? []).find((fx): fx is Extract<Effect, { type: 'END' }> => fx.type === 'END');
  assert.equal((endB?.assignments ?? []).filter((x) => x.uid === 'd').reduce((n, x) => n + x.sips, 0), MAX_VALUE);
});
