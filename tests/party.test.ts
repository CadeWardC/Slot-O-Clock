import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Harness } from './harness.ts';
import type { GameDefinition, DrinkAssignment, Highlight } from '../src/engine/types.ts';
import {
  applySpot,
  applyWild,
  awardsFor,
  dealWild,
  emptyStats,
  lightweightFor,
  updateStats,
  type WildCard,
} from '../src/engine/party.ts';
import { roastFor } from '../src/engine/roast.ts';

/**
 * ============================================================
 *  Between the games: wild cards, the spot, the roast, the awards
 * ============================================================
 * The pure pieces are tested directly; the engine wiring is tested with a
 * one-move game whose single input says exactly who drinks what, so each
 * round's result is whatever the test needs it to be.
 */

type BillInput = { bill: DrinkAssignment[]; highlights?: Highlight[] };
const bill: GameDefinition<{ phase: 'open' }, BillInput> = {
  id: 'bill',
  name: 'Bill',
  emoji: '🧾',
  rules: 'test-only',
  minPlayers: 1,
  createInitialState: () => ({ phase: 'open' }),
  reduce(state, event) {
    if (event.type !== 'INPUT') return { state };
    return {
      state,
      effects: [{ type: 'END', assignments: event.input.bill, highlights: event.input.highlights }],
    };
  },
  View: () => null,
};

const names: Record<string, string> = { host: 'Hana', p2: 'Pat', p3: 'Quin', p4: 'Rio' };
const nameOf = (uid: string) => names[uid] ?? uid;
const rng = () => 0;

async function table(players = ['host', 'p2', 'p3', 'p4']) {
  const h = new Harness({ game: bill, players });
  h.start();
  await h.settle();
  await h.startGame();
  return h;
}

/** play the round on screen to its drinks screen */
async function play(h: Harness, b: DrinkAssignment[], highlights?: Highlight[]) {
  assert.equal(h.phase, 'playing');
  await h.submit('host', { bill: b, highlights });
  await h.settle();
  assert.equal(h.phase, 'outcome');
}

/** from the drinks screen to the next round being playable */
async function next(h: Harness) {
  await h.readyAll();
  assert.equal(h.phase, 'intro');
  await h.readyAll();
  assert.equal(h.phase, 'playing');
}

/* ---------------- pure pieces ---------------- */

test('wild cards only come out every third game, and never the same one twice running', () => {
  const base = { uids: ['a', 'b', 'c'], totals: { a: 5, b: 2, c: 0 }, nameOf, lastWild: null };
  assert.equal(dealWild({ ...base, round: 1, rng }), null);
  assert.equal(dealWild({ ...base, round: 2, rng }), null);
  const first = dealWild({ ...base, round: 3, rng });
  assert.ok(first, 'round 3 turns a card');
  const again = dealWild({ ...base, round: 6, rng, lastWild: first.id });
  assert.ok(again);
  assert.notEqual(again.id, first.id);
});

test('a card about the tab leader is never dealt when the lead is shared', () => {
  for (let i = 0; i < 40; i++) {
    const card = dealWild({
      round: 3,
      uids: ['a', 'b', 'c'],
      totals: { a: 2, b: 2, c: 2 },
      nameOf,
      lastWild: null,
      rng: () => i / 40,
    });
    assert.ok(card);
    assert.equal(card.uid, undefined, `${card.id} names nobody`);
    assert.ok(!card.text.includes('{'), 'no unfilled placeholder');
  }
});

test('what each card does to the drinks', () => {
  const drinks: DrinkAssignment[] = [
    { uid: 'a', sips: 3, reason: 'x' },
    { uid: 'b', sips: 1, reason: 'y' },
  ];
  const card = (effect: WildCard['effect'], extra: Partial<WildCard> = {}): WildCard => ({
    id: effect,
    title: effect,
    text: '',
    effect,
    ...extra,
  });
  const order = ['a', 'b', 'c'];
  assert.deepEqual(
    applyWild(card('double'), drinks, order, nameOf).assignments.map((a) => a.sips),
    [6, 2],
  );
  assert.deepEqual(
    applyWild(card('half'), drinks, order, nameOf).assignments.map((a) => a.sips),
    [2, 1],
  );
  const buddy = applyWild(card('buddy'), drinks, order, nameOf).assignments;
  assert.deepEqual(buddy[2], { uid: 'b', sips: 3, reason: 'Drinking buddy of a', fromUid: 'a' });
  const robin = applyWild(card('robin', { uid: 'a', toUid: 'c' }), drinks, order, nameOf).assignments;
  assert.deepEqual(robin.map((a) => a.uid), ['c', 'b']);
  const immune = applyWild(card('immune', { uid: 'a' }), drinks, order, nameOf).assignments;
  assert.deepEqual(immune.map((a) => a.uid), ['b']);
  assert.equal(applyWild(card('rule'), drinks, order, nameOf).assignments, drinks);
  assert.equal(applyWild(null, drinks, order, nameOf).did, null);
});

test('the spot doubles one player and nobody else', () => {
  const out = applySpot('a', [
    { uid: 'a', sips: 2, reason: '' },
    { uid: 'b', sips: 2, reason: '' },
  ]);
  assert.deepEqual(out.map((a) => a.sips), [4, 2]);
});

test('the lightweight is only named when one player is clearly behind', () => {
  const stats = { ...emptyStats(), rounds: 4 };
  const uids = ['a', 'b', 'c'];
  assert.equal(lightweightFor({ stats, totals: { a: 6, b: 5, c: 1 }, uids, nextRound: 5 }), 'c');
  assert.equal(lightweightFor({ stats, totals: { a: 6, b: 2, c: 1 }, uids, nextRound: 5 }), null, 'gap too small');
  assert.equal(lightweightFor({ stats, totals: { a: 6, b: 5, c: 1 }, uids, nextRound: 6 }), null, 'wild round');
  assert.equal(
    lightweightFor({ stats: { ...stats, lastSpotRound: 4 }, totals: { a: 6, b: 5, c: 1 }, uids, nextRound: 5 }),
    null,
    'too soon after the last one',
  );
  assert.equal(
    lightweightFor({ stats: { ...stats, rounds: 2 }, totals: { a: 6, b: 5, c: 1 }, uids, nextRound: 4 }),
    null,
    'too early in the night',
  );
});

test('stats follow streaks, biggest hits and who gave whom', () => {
  let s = emptyStats();
  const round = (assignments: DrinkAssignment[]) =>
    (s = updateStats(s, { gameName: 'G', assignments, roundUids: ['a', 'b'] }));
  round([{ uid: 'a', sips: 2, reason: '' }]);
  round([{ uid: 'a', sips: 5, reason: '', fromUid: 'b' }]);
  round([{ uid: 'b', sips: 1, reason: '' }]);
  assert.equal(s.rounds, 3);
  assert.equal(s.players.a.bestDrinkRun, 2);
  assert.equal(s.players.a.drinkRun, 0);
  assert.equal(s.players.a.biggest, 5);
  assert.equal(s.players.b.bestSafeRun, 2);
  assert.equal(s.players.b.given, 5);
  assert.equal(s.pairs.b.a, 5);

  const awards = awardsFor(s, { a: 7, b: 1 }, ['a', 'b'], nameOf);
  const ids = awards.map((a) => a.id);
  assert.ok(ids.includes('sponge') && ids.includes('driver') && ids.includes('nemesis'));
  assert.deepEqual(awards.find((a) => a.id === 'nemesis')?.uids, ['b', 'a']);
  assert.ok(!ids.includes('run'), 'a run of two is not an award');
});

test('the roast prefers what the game reported, and fills it in', () => {
  const line = roastFor({
    assignments: [{ uid: 'p2', sips: 6, reason: '' }],
    highlights: [{ kind: 'horse-lost-big', uid: 'p2', n: 6, text: 'Pony Danza' }],
    roundUids: ['host', 'p2', 'p3'],
    nameOf,
    totalsBefore: {},
    totalsAfter: { p2: 6 },
    statsBefore: null,
    rng,
  });
  assert.ok(line);
  assert.ok(line.includes('Pat') && line.includes('Pony Danza') && line.includes('6'), line);
  assert.ok(!line.includes('{'), 'no unfilled placeholder');
});

test('the roast falls back to the night so far, then to the shape of the round', () => {
  const base = { roundUids: ['host', 'p2', 'p3'], nameOf, totalsBefore: {}, rng, highlights: [] };
  const streak = roastFor({
    ...base,
    assignments: [{ uid: 'p3', sips: 1, reason: '' }],
    totalsAfter: { p3: 3 },
    statsBefore: {
      ...emptyStats(),
      rounds: 2,
      players: { p3: { ...updateStats(null, { gameName: '', assignments: [], roundUids: ['p3'] }).players.p3, drinkRun: 2 } },
    },
  });
  assert.ok(streak?.includes('Quin') && streak.includes('3'), streak ?? '');
  const nobody = roastFor({ ...base, assignments: [], totalsAfter: {}, statsBefore: null });
  assert.ok(nobody?.startsWith('Nobody') || nobody?.includes('nobody'), nobody ?? '');
  const unknown = roastFor({
    ...base,
    assignments: [
      { uid: 'p2', sips: 1, reason: '' },
      { uid: 'p3', sips: 1, reason: '' },
    ],
    highlights: [{ kind: 'not-a-kind', uid: 'p2' }],
    totalsAfter: { p2: 1, p3: 1 },
    statsBefore: null,
  });
  assert.equal(unknown, null, 'an unknown highlight and a dull round say nothing');
});

/* ---------------- through the engine ---------------- */

test('a finished round carries a roast, and the stats move on', async () => {
  const h = await table();
  await play(h, [{ uid: 'p2', sips: 5, reason: 'lost' }]);
  const outcome = h.engine.outcome;
  assert.ok(outcome);
  assert.equal(typeof outcome.roast, 'string');
  assert.equal(h.engine.stats?.rounds, 1);
  assert.equal(h.engine.stats?.players.p2.biggest, 5);
  assert.equal(h.engine.wild ?? null, null);
});

test('the third game turns a wild card and the card bends that game’s drinks', async () => {
  const h = await table();
  await play(h, [{ uid: 'p2', sips: 1, reason: '' }]);
  await next(h);
  await play(h, [{ uid: 'p2', sips: 1, reason: '' }]);
  await h.readyAll();
  assert.equal(h.phase, 'intro');
  assert.equal(h.engine.round, 3);
  const wild = h.engine.wild;
  assert.ok(wild, 'round 3 has a wild card on the rules screen');
  const before = { ...(h.engine.awards?.drinks ?? {}) };
  await h.readyAll();
  await play(h, [
    { uid: 'p3', sips: 4, reason: '' },
    { uid: 'p4', sips: 2, reason: '' },
  ]);
  const outcome = h.engine.outcome;
  assert.equal(outcome?.wild?.title, wild.title);
  assert.equal(h.engine.wild ?? null, null, 'the card is spent');
  assert.equal(h.engine.stats?.lastWild, wild.id);
  // whatever the card was, the ledger was charged exactly what the screen shows
  const after = h.engine.awards?.drinks ?? {};
  const shown: Record<string, number> = {};
  for (const a of outcome?.assignments ?? []) shown[a.uid] = (shown[a.uid] ?? 0) + a.sips;
  for (const uid of h.playerUids) {
    const tax: number = wild.effect === 'tax' ? 1 : 0;
    assert.equal((after[uid] ?? 0) - (before[uid] ?? 0), (shown[uid] ?? 0) + tax, `${uid} was charged what was shown`);
  }
});

test('the lightweight picks the next game and drinks double in it', async () => {
  const h = await table();
  // three games in which everyone but p4 drinks
  for (let i = 0; i < 3; i++) {
    await play(h, [
      { uid: 'host', sips: 2, reason: '' },
      { uid: 'p2', sips: 2, reason: '' },
      { uid: 'p3', sips: 2, reason: '' },
    ]);
    if (i < 2) await next(h);
  }
  assert.equal(h.engine.round, 3);
  assert.equal(h.engine.next?.pickerUid, 'p4', 'p4 is far enough behind after game 3');
  // somebody else's pick is ignored; p4's counts
  const gateId = h.engine.gate?.id as string;
  h.store.patch({ 'social/pick': { uid: 'p2', gateId, gameId: 'bill' } });
  await h.settle();
  h.store.patch({ 'social/pick': { uid: 'p4', gateId, gameId: 'bill' } });
  await h.settle();
  await h.readyAll();
  assert.equal(h.phase, 'intro');
  assert.deepEqual(h.engine.spot, { uid: 'p4', picked: true });
  await h.readyAll();
  await play(h, [
    { uid: 'p4', sips: 2, reason: '' },
    { uid: 'p2', sips: 2, reason: '' },
  ]);
  const shown = h.engine.outcome?.assignments ?? [];
  assert.equal(shown.find((a) => a.uid === 'p4')?.sips, 4, 'on the spot: doubled');
  assert.equal(shown.find((a) => a.uid === 'p2')?.sips, 2);
  assert.equal(h.engine.outcome?.spotUid, 'p4');
  assert.equal(h.engine.next?.pickerUid ?? null, null, 'not twice in a row');
});

test('a pick stamped with an old gate is not honoured', async () => {
  const h = await table();
  for (let i = 0; i < 3; i++) {
    await play(h, [
      { uid: 'host', sips: 2, reason: '' },
      { uid: 'p2', sips: 2, reason: '' },
      { uid: 'p3', sips: 2, reason: '' },
    ]);
    if (i < 2) await next(h);
  }
  h.store.patch({ 'social/pick': { uid: 'p4', gateId: 'some-old-gate', gameId: 'bill' } });
  await h.settle();
  await h.readyAll();
  assert.deepEqual(h.engine.spot, { uid: 'p4', picked: false }, 'still on the spot, but the rotation chose');
});

test('ending the night parks every phone on the awards, and the host can go again', async () => {
  const h = await table();
  await play(h, [{ uid: 'p2', sips: 3, reason: '' }]);
  await h.run({ type: 'finish' });
  assert.equal(h.phase, 'ended');
  assert.equal(h.engine.stats?.rounds, 1, 'the stats survive for the awards');
  assert.equal(h.engine.awards?.drinks?.p2, 3);
  await h.run({ type: 'reopen' });
  assert.equal(h.phase, 'lobby');
  assert.deepEqual(h.engine.awards?.drinks ?? {}, {});
  assert.equal(h.engine.stats ?? null, null);
});
