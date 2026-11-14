// Headless smoke test for the Poison reducer (ring of cups, sniff, heckles,
// stacked doses, the antidote). Runs the real source through the test loader:
//   node --import ./tests-loader.mjs scripts/tmp-poison-test.mjs
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/engine/rng.ts';
import definition, { SIPS, STACK_SIPS, MISS_SIPS, ANTIDOTE_MISS_SIPS } from '../src/games/Poison/definition.ts';

const mkCtx = (n, mode = 'party', seed = 7) => ({
  players: Array.from({ length: n }, (_, i) => ({
    uid: `u${i}`, name: `P${i}`, emoji: '🙂', isHost: i === 0, connected: true,
    local: mode === 'shared', drinkCount: 0, score: 0, joinedAt: i,
  })),
  actorUid: null,
  turnOrder: [],
  settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: [] },
  rng: mulberry32(seed),
  now: 1_000,
  roundId: 'r', phaseId: 'p', revision: 0,
});
const run = (st, uid, input, ctx) => definition.reduce(st, { type: 'INPUT', uid, input }, ctx);

// ---- party: everyone pours at once, in any order ----
let ctx = mkCtx(4);
let st = definition.createInitialState(ctx);
assert.equal(st.cups, 5);
assert.equal(st.order.length, 3);
const safe = [0, 1, 2, 3, 4].find((c) => c !== st.antidoteCup && c !== 0);
const [a, b, c] = st.order;
st = run(st, c, { cup: 0 }, ctx).state; // out of order is fine in party mode
st = run(st, a, { cup: 0 }, ctx).state;
st = run(st, a, { cup: 3 }, ctx).state; // a second pour is ignored
assert.equal(st.poisons[a], 0);
assert.equal(st.phase, 'pouring');
st = run(st, st.drinkerUid, { cup: 1 }, ctx).state; // the victim can't act yet
assert.equal(st.pick, null);
st = run(st, b, { cup: safe === 4 ? 3 : 4 }, ctx).state;
assert.equal(st.phase, 'drinking');

// hover is public, the sniff works once, heckles only come from the crew
st = run(st, st.drinkerUid, { hover: 2 }, ctx).state;
assert.equal(st.hover, 2);
st = run(st, st.drinkerUid, { sniff: 0 }, ctx).state;
assert.equal(st.sniff.cup, 0);
const before = st.sniff;
st = run(st, st.drinkerUid, { sniff: 2 }, ctx).state;
assert.deepEqual(st.sniff, before, 'one sniff only');
st = run(st, a, { react: '😈' }, ctx).state;
assert.equal(st.reactions[a].e, '😈');
st = run(st, a, { react: '<script>' }, ctx).state;
assert.equal(st.reactions[a].e, '😈', 'unknown heckles are dropped');
st = run(st, a, { cup: 0 }, ctx).state;
assert.equal(st.pick, null, 'a poisoner cannot drink for the victim');

// a stacked cup hits harder (unless it happens to hide the antidote)
const drinking = st;
let r = run(drinking, st.drinkerUid, { cup: 0 }, ctx);
assert.equal(r.state.phase, 'reveal');
assert.equal(r.effects[0].type, 'TIMER');
if (st.antidoteCup === 0) {
  assert.equal(r.state.outcome, 'antidote');
  assert.equal(r.state.assignments.length, 2);
} else {
  assert.equal(r.state.outcome, 'hit');
  assert.deepEqual(r.state.assignments.map((x) => [x.uid, x.sips]), [[st.drinkerUid, SIPS + STACK_SIPS]]);
}
// a clean cup: the whole crew drinks
r = run(drinking, st.drinkerUid, { cup: safe }, ctx);
assert.equal(r.state.outcome, 'clean');
assert.ok(r.state.assignments.length === 3 && r.state.assignments.every((x) => x.sips === MISS_SIPS));
// the antidote, with nobody in it: the crew pays more
if (![0, drinking.poisons[b]].includes(st.antidoteCup)) {
  r = run(drinking, st.drinkerUid, { cup: st.antidoteCup }, ctx);
  assert.equal(r.state.outcome, 'antidote');
  assert.ok(r.state.assignments.every((x) => x.sips === ANTIDOTE_MISS_SIPS));
}
// the reveal's clock ends the round with the same drinks
const end = definition.reduce(r.state, { type: 'TIME_UP', now: 99_000 }, ctx);
assert.equal(end.effects[0].type, 'END');
assert.deepEqual(end.effects[0].assignments, r.state.assignments);

// ---- shared phone: strictly one pourer at a time ----
ctx = mkCtx(3, 'shared');
st = definition.createInitialState(ctx);
assert.equal(definition.sharedHolderUid(st, ctx), st.order[0]);
st = run(st, st.order[1], { cup: 1 }, ctx).state;
assert.equal(st.turn, 0, 'out of turn is refused on a shared phone');
st = run(st, st.order[0], { cup: 1 }, ctx).state;
assert.equal(definition.sharedHolderUid(st, ctx), st.order[1]);
st = run(st, st.order[1], { cup: 1 }, ctx).state;
assert.equal(definition.sharedHolderUid(st, ctx), st.drinkerUid);

// ---- a vanished victim: TIME_UP lets fate pick ----
r = definition.reduce(st, { type: 'TIME_UP', now: 5_000 }, ctx);
assert.equal(r.state.phase, 'reveal');
assert.ok(r.state.pick != null);

console.log('poison smoke test: ok');
