import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Effect, GameContext, PlayerInfo, RoomMode } from '../src/engine/types.ts';
import { mulberry32 } from '../src/engine/rng.ts';
import mostLikely, { MAX_SIPS, type MlState } from '../src/games/MostLikely/definition.ts';
import knowMe, { type KmState } from '../src/games/KnowMe/definition.ts';

/**
 * Most Likely To and Know Me, reducer by reducer: the votes and picks, the
 * reveal, the bill at the end, and the moments they report for the roast.
 */

const players: PlayerInfo[] = ['a', 'b', 'c', 'd'].map((uid, i) => ({
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

function ctx(mode: RoomMode = 'party', seed = 3): GameContext {
  return {
    players,
    actorUid: 'a',
    turnOrder: players.map((p) => p.uid),
    settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: [] },
    rng: mulberry32(seed),
    now: 1_000_000,
    roundId: 'r1',
    phaseId: 'ph1',
    revision: 1,
  };
}

type End = Extract<Effect, { type: 'END' }>;
const endOf = (effects: Effect[] | undefined) =>
  (effects ?? []).find((fx): fx is End => fx.type === 'END') ?? null;

/* ---------------- Most Likely To ---------------- */

function vote(s: MlState, uid: string, target: string) {
  return mostLikely.reduce(s, { type: 'INPUT', uid, input: { vote: target } }, ctx());
}
function tick(s: MlState) {
  return mostLikely.reduce(s, { type: 'TIME_UP', now: 0 }, ctx());
}
/** play one prompt: these votes, then the reveal timer */
function prompt(s: MlState, votes: Record<string, string>) {
  let r = { state: s } as ReturnType<typeof vote>;
  for (const [voter, target] of Object.entries(votes)) r = vote(r.state, voter, target);
  if (r.state.phase === 'vote') r = tick(r.state);
  assert.equal(r.state.phase, 'reveal');
  return tick(r.state);
}

test('Most Likely To: three different prompts, a vote is final and secret until everyone is in', () => {
  const s = mostLikely.createInitialState(ctx());
  assert.equal(new Set(s.prompts).size, 3);
  let r = vote(s, 'a', 'b');
  r = vote(r.state, 'a', 'c');
  assert.equal(r.state.votes.a, 'b', 'one vote each, final');
  assert.equal(vote(r.state, 'a', 'zed').state, r.state);
  for (const v of ['b', 'c']) r = vote(r.state, v, 'b');
  assert.equal(r.state.phase, 'vote', 'still waiting on d');
  r = vote(r.state, 'd', 'a');
  assert.equal(r.state.phase, 'reveal', 'last vote turns them over');
  assert.deepEqual(r.state.rounds[0].winners, ['b']);
  assert.equal(r.state.rounds[0].sips, 3);
});

test('Most Likely To: ties drink together, the cap holds, a silent prompt costs nothing, one bill at the end', () => {
  let s = mostLikely.createInitialState(ctx());
  let r = prompt(s, { a: 'b', b: 'b', c: 'b', d: 'b' }); // 4 votes, capped
  assert.ok(r.effects?.some((fx) => fx.type === 'CLEAR_INPUTS'), 'next prompt opens a new stage');
  r = prompt(r.state, { a: 'c', b: 'd' }); // tie, 1 each
  r = prompt(r.state, {}); // nobody voted
  const end = endOf(r.effects);
  assert.ok(end);
  const bill = Object.fromEntries((end.assignments ?? []).map((a) => [a.uid, a.sips]));
  assert.deepEqual(bill, { b: Math.min(MAX_SIPS, 4), c: 1, d: 1 });
  assert.ok((end.highlights ?? []).some((h) => h.kind === 'mlt-unanimous' && h.uid === 'b'));
});

test('Most Likely To: winning all three is a reputation', () => {
  let r = { state: mostLikely.createInitialState(ctx()) } as ReturnType<typeof vote>;
  for (let i = 0; i < 3; i++) r = prompt(r.state, { a: 'c', b: 'c', d: 'a' });
  const end = endOf(r.effects);
  const magnet = end?.highlights?.find((h) => h.kind === 'mlt-magnet');
  assert.equal(magnet?.uid, 'c');
  assert.equal(magnet?.n, 6);
});

/* ---------------- Know Me ---------------- */

function pick(s: KmState, uid: string, p: 0 | 1, mode: RoomMode = 'party') {
  return knowMe.reduce(s, { type: 'INPUT', uid, input: { pick: p } }, ctx(mode));
}
function kTick(s: KmState) {
  return knowMe.reduce(s, { type: 'TIME_UP', now: 0 }, ctx());
}
/** one question: the hot seat (a) answers `truth`, the others pick as given */
function question(s: KmState, truth: 0 | 1 | null, guesses: Record<string, 0 | 1>) {
  let r = { state: s } as ReturnType<typeof pick>;
  if (truth != null) r = pick(r.state, 'a', truth);
  for (const [uid, g] of Object.entries(guesses)) r = pick(r.state, uid, g);
  if (r.state.phase === 'answer') r = kTick(r.state);
  assert.equal(r.state.phase, 'reveal');
  const reveal = r.state.reveal;
  return { reveal, next: kTick(r.state) };
}

test('Know Me: the actor is in the hot seat, with four different questions', () => {
  const s = knowMe.createInitialState(ctx());
  assert.equal(s.seatUid, 'a');
  assert.equal(s.questions.length, 4);
  assert.equal(new Set(s.questions.map((q) => `${q.q}|${q.a}`)).size, 4);
});

test('Know Me: the worst guesser drinks per miss, the best hands out, nobody-knows-you costs the hot seat', () => {
  let r = { state: knowMe.createInitialState(ctx()) } as ReturnType<typeof pick>;
  // b gets all four, c gets two, d gets one; on q4 everyone but b is wrong
  const rounds: [0 | 1, Record<string, 0 | 1>][] = [
    [0, { b: 0, c: 0, d: 0 }],
    [1, { b: 1, c: 1, d: 0 }],
    [0, { b: 0, c: 1, d: 1 }],
    [1, { b: 1, c: 0, d: 0 }],
  ];
  for (const [truth, guesses] of rounds) r = question(r.state, truth, guesses).next;
  const end = endOf(r.effects);
  assert.ok(end);
  assert.deepEqual(end.assignments?.map((a) => [a.uid, a.sips]), [['d', 3]], 'd missed 3');
  assert.deepEqual(end.givers, [{ uid: 'b', sips: 2, why: 'Knows them best' }]);
  assert.ok(end.highlights?.some((h) => h.kind === 'know-best' && h.uid === 'b' && h.n === 4));
  assert.ok(end.highlights?.some((h) => h.kind === 'know-stranger' && h.uid === 'd'));
});

test('Know Me: a question nobody calls is on the hot seat, and a frozen hot seat gets picked for', () => {
  let r = { state: knowMe.createInitialState(ctx()) } as ReturnType<typeof pick>;
  const q1 = question(r.state, 0, { b: 1, c: 1, d: 1 });
  assert.equal(q1.reveal?.right.length ?? 0, 0);
  assert.equal(q1.next.state.seatSips, 1);
  const q2 = question(q1.next.state, null, { b: 0, c: 1 });
  assert.equal(q2.reveal?.froze, true, 'they froze, the app picked');
  assert.ok((q2.reveal?.silent ?? []).includes('d'), 'a missing guess is a miss');
});

test('Know Me: one pick each, nothing after the reveal, and the shared phone stays with the hot seat for the reveal', () => {
  const s = knowMe.createInitialState(ctx());
  const once = pick(s, 'b', 0);
  assert.equal(pick(once.state, 'b', 1).state, once.state);
  assert.equal(knowMe.sharedHolderUid?.(once.state, { players, actorUid: 'a' }), 'a', 'next unpicked player');
  const shown = question(s, 1, { b: 1, c: 1, d: 1 });
  void shown;
  let rev = pick(s, 'a', 1).state;
  for (const u of ['b', 'c', 'd']) rev = pick(rev, u, 1).state;
  assert.equal(rev.phase, 'reveal');
  assert.equal(pick(rev, 'b', 0).state, rev, 'a pick in the reveal is ignored');
  assert.equal(knowMe.sharedHolderUid?.(rev, { players, actorUid: 'a' }), 'a');
});
