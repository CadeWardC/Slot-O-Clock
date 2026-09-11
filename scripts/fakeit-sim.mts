/**
 * Offline smoke test for the Fake It Till You Make It reducer.
 * Drives 3 full rounds through a fake 4-player room:
 *   R1: faker caught (majority vote)
 *   R2: faker survives (tie vote)
 *   R3: played out -> END with summary
 * Run: npx tsx scripts/fakeit-sim.mts
 */
import { definition, type FkInput, type FkState } from '../src/games/FakeIt/definition';
import { mulberry32 } from '../src/engine/rng';
import type { GameContext, GameEvent, PlayerInfo } from '../src/engine/types';

let now = 1_000_000;

function mkPlayer(i: number): PlayerInfo {
  return {
    uid: `p${i}`,
    name: `Player${i}`,
    emoji: '🍺',
    isHost: i === 0,
    connected: true,
    local: false,
    drinkCount: 0,
    score: 0,
    joinedAt: i,
  };
}

const players = [0, 1, 2, 3].map(mkPlayer);
const ctx: GameContext = {
  players,
  actorUid: null,
  turnOrder: [],
  settings: { mode: 'party', pointsMode: false, sipMultiplier: 1, enabledGames: ['fakeit'] },
  rng: mulberry32(42),
  now,
};

function step(state: FkState, event: GameEvent<FkInput>): FkState {
  const res = definition.reduce(state, event, { ...ctx, now });
  if (res.effects) {
    for (const fx of res.effects) {
      if (fx.type === 'TIMER') now += fx.ms; // pretend time passes instantly
    }
  }
  return res.state as FkState;
}

function input(state: FkState, uid: string, inp: FkInput): FkState {
  return step(state, { type: 'INPUT', uid, input: inp });
}

function expect(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

// ---- round 1 -------------------------------------------------------------
let s = definition.createInitialState(ctx) as FkState;
expect(s.phase === 'secret' && s.roundNo === 1, 'starts at round 1 secret phase');
expect(new Set(s.modes).size === 3 && s.modes.length === 3, 'three distinct modes in order');

s = step(s, { type: 'BEGIN' });
for (const p of players) s = input(s, p.uid, { action: 'ready' });
expect(s.phase === 'task', 'all-ready moves to task');

const r1faker = s.fakerUid;
for (const p of players) {
  const v = s.mode === 'numbers' ? 3 : s.mode === 'raise' ? 1 : players.find((x) => x.uid !== p.uid)!.uid;
  s = input(s, p.uid, { action: 'answer', value: v });
}
expect(s.phase === 'vote', 'all-answered moves to vote');

// all three non-fakers accuse the real faker, faker throws a misdirection vote
const voters = players.filter((p) => p.uid !== r1faker);
s = input(s, voters[0].uid, { action: 'vote', value: r1faker });
s = input(s, voters[1].uid, { action: 'vote', value: r1faker });
s = input(s, voters[2].uid, { action: 'vote', value: r1faker });
s = input(s, r1faker, { action: 'vote', value: voters[0].uid });
expect(s.phase === 'verdict', 'all-voted resolves to verdict');
expect(s.roundResult?.caught === true, `round 1 faker caught (faker was ${r1faker})`);

// ---- round 2: survive via tie -------------------------------------------
s = step(s, { type: 'TIME_UP', now });
expect(s.phase === 'secret' && s.roundNo === 2, 'advances to round 2');
expect(s.fakerUid !== r1faker, 'new faker (no repeats while possible)');

s = step(s, { type: 'TIME_UP', now }); // secret stall net fires
expect(s.phase === 'task', 'secret net force-advances to task');
s = step(s, { type: 'TIME_UP', now }); // nobody answers
expect(s.phase === 'vote', 'task timer force-advances to vote');
const r2faker = s.fakerUid;
// 2v2 tie -> nobody accused -> survived
const v2 = players.filter((p) => p.uid !== r2faker);
s = input(s, v2[0].uid, { action: 'vote', value: v2[1].uid });
s = input(s, v2[1].uid, { action: 'vote', value: v2[0].uid });
s = input(s, r2faker, { action: 'vote', value: v2[0].uid });
s = input(s, players.find((p) => p.uid === r2faker)!.uid, { action: 'vote', value: v2[1].uid });
// note: faker already voted above; re-send is ignored
s = step(s, { type: 'TIME_UP', now });
expect(s.phase === 'verdict', 'round 2 resolves');
expect(s.roundResult?.caught === false, 'tie vote means the faker survives');

// ---- round 3: play out and end ------------------------------------------
s = step(s, { type: 'TIME_UP', now });
expect(s.phase === 'secret' && s.roundNo === 3, 'advances to round 3');
for (const p of players) s = input(s, p.uid, { action: 'ready' });
for (const p of players) {
  const v = s.mode === 'numbers' ? 7 : s.mode === 'raise' ? 0 : players.find((x) => x.uid !== p.uid)!.uid;
  s = input(s, p.uid, { action: 'answer', value: v });
}
const r3faker = s.fakerUid;
for (const p of players) {
  // the faker can't self-vote; they throw a misdirection vote instead
  const target = p.uid === r3faker ? players.find((x) => x.uid !== r3faker)!.uid : r3faker;
  s = input(s, p.uid, { action: 'vote', value: target });
}
expect(s.phase === 'verdict' && s.roundResult?.caught === true, 'round 3: unanimous catch');

const ended = definition.reduce(s, { type: 'TIME_UP', now }, ctx);
const endFx = (ended.effects ?? []).find((fx) => fx.type === 'END');
expect(!!endFx, 'final TIME_UP emits END');
if (endFx && endFx.type === 'END') {
  expect((endFx.assignments ?? []).length > 0, 'END carries round-3 assignments');
  expect(!!endFx.note && endFx.note.includes('1/3'), `summary note ok: ${endFx.note}`);
}

// reducer rejects junk inputs
const junk = definition.reduce(
  { ...s, phase: 'task' },
  { type: 'INPUT', uid: 'p0', input: { action: 'answer', value: 99 } },
  ctx,
);
expect((junk.state as FkState).answers?.p0 !== 99, 'out-of-range number rejected');

console.log('\nAll smoke checks passed.');
