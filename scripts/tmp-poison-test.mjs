// Temporary headless smoke test for the Poison game reducer.
// Bundles definition.ts with the React View stubbed out, then simulates
// a full round through the real reduce() on a fake GameContext.
import * as esbuild from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const defPath = join(root, 'src/games/Poison/definition.ts');
const outDir = mkdtempSync(join(tmpdir(), 'poison-test-'));

const result = await esbuild.build({
  entryPoints: [defPath],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: join(outDir, 'poison.mjs'),
  plugins: [
    {
      name: 'stub-view',
      setup(build) {
        build.onResolve({ filter: /^\.\/View$/ }, () => ({
          path: 'stub-view',
          namespace: 'stub',
        }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export const View = () => null;',
          loader: 'js',
        }));
      },
    },
  ],
});
if (result.errors.length) throw new Error('build failed');

// deterministic rng mirroring mulberry32 usage in the host loop
let seedState = 42;
const rng = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648;
  return seedState / 2147483648;
};

const mkCtx = (players, mode = 'party') => ({
  players: players.map((name, i) => ({
    uid: `u${i}`, name, emoji: '🙂', isHost: i === 0, connected: true,
    local: false, drinkCount: 0, score: 0, joinedAt: i,
  })),
  actorUid: null,
  turnOrder: [],
  settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: [] },
  rng,
  now: 1_000,
});

const { definition } = await import(pathToFileURL(join(outDir, 'poison.mjs')));

const assert = (cond, msg) => { if (!cond) throw new Error('FAIL: ' + msg); };
const step = (state, event, ctx) => {
  const res = definition.reduce(state, event, ctx);
  return res;
};

// ---------- even group: 4 players → 2 pairs ----------
let ctx = mkCtx(['Ann', 'Bob', 'Cid', 'Dee']);
let st = definition.createInitialState(ctx);
let r = step(st, { type: 'BEGIN' }, ctx);
assert(r.effects?.[0]?.type === 'TIMER', 'BEGIN arms a timer');
st = r.state;
assert(st.pairs.length === 2, '4 players → 2 pairs');
const poisoners = st.pairs.map((p) => p.poisonerUid);
const drinkers = st.pairs.map((p) => p.drinkerUid);
assert(new Set([...poisoners, ...drinkers]).size === 4, 'all 4 players used exactly once');

// poisoner 0 poisons cup 2, poisoner 1 poisons cup 0
r = step(st, { type: 'INPUT', uid: poisoners[0], input: { cup: 2 } }, ctx); st = r.state;
assert(st.poisons[poisoners[0]] === 2, 'poison recorded');
assert(st.phase === 'pouring', 'not everyone in yet');
r = step(st, { type: 'INPUT', uid: poisoners[1], input: { cup: 0 } }, ctx); st = r.state;
// drinker 0 (pair 0) picks SAFE cup 0; drinker 1 (pair 1) picks POISON cup 0
r = step(st, { type: 'INPUT', uid: drinkers[0], input: { cup: 0 } }, ctx); st = r.state;
assert(st.phase === 'pouring', 'still waiting for last drinker');
r = step(st, { type: 'INPUT', uid: drinkers[1], input: { cup: 0 } }, ctx); st = r.state;
assert(st.phase === 'reveal', 'last pick triggers reveal');

const hit0 = st.assignments.find((a) => a.uid === drinkers[0]);
const poisoner0Drinks = st.assignments.find((a) => a.uid === poisoners[0]);
const hit1 = st.assignments.find((a) => a.uid === drinkers[1]);
assert(!hit0, 'drinker 0 dodged → no drinks for them');
assert(poisoner0Drinks && poisoner0Drinks.sips === 2, 'dodged pair → poisoner drinks 2');
assert(hit1 && hit1.sips === 2, 'poisoned pair → drinker drinks 2');
assert(st.note === '☠️ 1 poisoned · 🍷 1 dodged', 'note counts: ' + st.note);
const scores = (r.effects ?? []).filter((e) => e.type === 'SCORE');
assert(scores.length === 2, 'both pair winners score');
assert(r.effects?.[0]?.type === 'TIMER', 'reveal arms its timer');

// 5s later → END with the same assignments
r = step(st, { type: 'TIME_UP', now: 6000 }, ctx);
assert(r.effects?.[0]?.type === 'END', 'reveal timer ends the round');
assert(r.effects[0].assignments?.length === 2, 'END carries both assignments');

// ---------- odd group: 3 players → 1 pair + The House ----------
ctx = mkCtx(['Ann', 'Bob', 'Cid']);
st = definition.createInitialState(ctx);
assert(st.pairs.length === 2, '3 players → 2 pairs (one vs house)');
const housePair = st.pairs.find((p) => p.poisonerUid === null);
const realPair = st.pairs.find((p) => p.poisonerUid !== null);
assert(!!housePair && !!realPair, 'one house pair, one real pair');
st = step(st, { type: 'BEGIN' }, ctx).state;
// only the real poisoner + both drinkers submit; house needs no input
st = step(st, { type: 'INPUT', uid: realPair.poisonerUid, input: { cup: 1 } }, ctx).state;
st = step(st, { type: 'INPUT', uid: realPair.drinkerUid, input: { cup: 1 } }, ctx).state;
assert(st.phase === 'pouring', 'house drinker still pending');
r = step(st, { type: 'INPUT', uid: housePair.drinkerUid, input: { cup: 3 } }, ctx); st = r.state;
assert(st.phase === 'reveal', 'house drinker pick completes the round');
assert(st.pairs.find((p) => p.poisonerUid === null).houseCup != null, 'house cup rolled at reveal');
const houseDrinkerAssignment = st.assignments.find((a) => a.uid === housePair.drinkerUid);
const houseCup = st.pairs.find((p) => p.poisonerUid === null).houseCup;
assert(
  (houseCup === 3) === !!houseDrinkerAssignment,
  'house drinker drinks iff they picked the rolled cup',
);
// real pair both picked cup 1 → drinker hit the poison
assert(st.assignments.find((a) => a.uid === realPair.drinkerUid)?.sips === 2, 'real pair resolved');

// ---------- timer rescue: 2 players, drinker vanishes ----------
ctx = mkCtx(['Ann', 'Bob']);
st = definition.createInitialState(ctx);
st = step(st, { type: 'BEGIN' }, ctx).state;
const p2 = st.pairs[0];
st = step(st, { type: 'INPUT', uid: p2.poisonerUid, input: { cup: 3 } }, ctx).state;
r = step(st, { type: 'TIME_UP', now: 61000 }, ctx); st = r.state;
assert(st.phase === 'reveal', 'TIME_UP force-reveals');
assert(st.picks[p2.drinkerUid] != null, 'fate picked for the vanished drinker');
assert(st.assignments.length === 1, 'pair still resolves to exactly one drinker');

// duplicate + junk inputs are ignored
st = definition.createInitialState(mkCtx(['Ann', 'Bob']));
st = step(st, { type: 'BEGIN' }, ctx).state;
let st2 = step(st, { type: 'INPUT', uid: st.pairs[0].poisonerUid, input: { cup: 9 } }, ctx).state;
assert(st2.poisons[st.pairs[0].poisonerUid] == null, 'out-of-range cup rejected');
st2 = step(st, { type: 'INPUT', uid: 'ghost', input: { cup: 1 } }, ctx).state;
assert(st2.pairs.length === 1 && st2.phase === 'pouring', 'unknown uid ignored');

console.log('ALL POISON REDUCER TESTS PASSED ✔');
writeFileSync(join(outDir, 'done'), '');
