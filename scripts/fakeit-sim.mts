/**
 * Offline smoke test for the Fake It Till You Make It reducer.
 *
 * Drives three full rounds through a fake 4-player room and checks the
 * things the game's whole design rests on:
 *   - the blind move: a countdown phase with no app input at all, and no
 *     reset of the shared-phone gate in front of a running clock
 *   - the private card: the faker is never handed the prompt
 *   - the public ballot: switchable while open, unanimous-only, and the
 *     faker's own ballot never counted
 *   - the seal: unanimity never ends the round early, so the timing of the
 *     verdict can never tell the table whether they got the faker
 *   - the last-chance window, the shared-phone recast, and the final tab
 *
 * Run: npx tsx scripts/fakeit-sim.mts
 *  or, offline with the esbuild that ships with vite:
 *      node_modules/.bin/esbuild scripts/fakeit-sim.mts --bundle \
 *        --platform=node --format=cjs --outfile=$TMP/fk-sim.cjs && node $TMP/fk-sim.cjs
 * The screen contract has its own check: scripts/fakeit-view-check.tsx
 */
import {
  definition,
  GESTURE_MS,
  LOCK_MS,
  ROUNDS_COUNT,
  type FkInput,
  type FkState,
} from '../src/games/FakeIt/definition';
import { mulberry32 } from '../src/engine/rng';
import type { GameContext, GameEvent, PlayerInfo, ReduceResult } from '../src/engine/types';

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

function mkCtx(mode: 'party' | 'shared'): GameContext {
  return {
    players,
    actorUid: null,
    turnOrder: [],
    settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: ['fakeit'] },
    rng: mulberry32(42),
    now,
  };
}

const ctx = mkCtx('party');

function run(
  state: FkState,
  event: GameEvent<FkInput>,
  context: GameContext = ctx,
): ReduceResult<FkState> {
  const res = definition.reduce(state, event, { ...context, now });
  for (const fx of res.effects ?? []) {
    if (fx.type === 'TIMER') now += fx.ms; // pretend time passes instantly
  }
  return res;
}

function step(state: FkState, event: GameEvent<FkInput>, context: GameContext = ctx): FkState {
  return run(state, event, context).state;
}

const input = (s: FkState, uid: string, inp: FkInput, c: GameContext = ctx) =>
  step(s, { type: 'INPUT', uid, input: inp }, c);
const timeUp = (s: FkState, c: GameContext = ctx) => step(s, { type: 'TIME_UP', now }, c);
const hasFx = (res: ReduceResult<FkState>, type: string) =>
  (res.effects ?? []).some((fx) => fx.type === type);
const timerFx = (res: ReduceResult<FkState>) =>
  (res.effects ?? []).find((fx) => fx.type === 'TIMER');

function expect(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

/** Every player taps through the phase they are on (read the card / said enough). */
function allReady(s: FkState, c: GameContext = ctx): ReduceResult<FkState> {
  let last: ReduceResult<FkState> = { state: s };
  let cur = s;
  for (const p of players) {
    last = run(cur, { type: 'INPUT', uid: p.uid, input: { action: 'ready' } }, c);
    cur = last.state;
  }
  return last;
}

const cleanOf = (s: FkState) => players.filter((p) => p.uid !== s.fakerUid);

// ---- round 1: private card → blind countdown → unanimous catch -------------
let s = definition.createInitialState(ctx);
expect(s.phase === 'brief' && s.roundNo === 1, 'starts on the private card of round 1');
expect(!!s.fakerUid && !!s.prompt, 'round 1 has a faker and a prompt');
s = step(s, { type: 'BEGIN' });
const prompt1 = s.prompt;
const faker = s.fakerUid;

const opened = allReady(s);
s = opened.state;
expect(s.phase === 'gesture', 'every card read → the blind countdown');
expect(
  (opened.effects ?? []).some((fx) => fx.type === 'TIMER' && fx.ms === GESTURE_MS),
  `the countdown runs GESTURE_MS (${GESTURE_MS / 1000}s)`,
);
expect(!hasFx(opened, 'CLEAR_INPUTS'), 'the countdown does not park a shared-phone gate over the clock');
expect(!('answers' in s), 'no move is ever designated in the app');

// nothing lands during the countdown
const earlyVote = input(s, players[0].uid, { action: 'vote', value: players[1].uid });
expect(
  earlyVote.phase === 'gesture' && Object.keys(earlyVote.votes ?? {}).length === 0,
  'votes are ignored while the clock runs',
);

s = timeUp(s);
expect(s.phase === 'reveal' && s.prompt === prompt1, 'the clock dies → the prompt goes public to everyone');
expect(Object.keys(s.argued ?? {}).length === 0, 'the discussion starts empty');

const revealed = allReady(s);
s = revealed.state;
expect(s.phase === 'vote', 'everyone said enough → the ballot opens');
expect(hasFx(revealed, 'CLEAR_INPUTS'), 'opening the ballot restarts the shared-phone pass-around');

const clean = cleanOf(s);
// a ballot is live and switchable while it is open
s = input(s, clean[0].uid, { action: 'vote', value: clean[1].uid });
s = input(s, clean[0].uid, { action: 'vote', value: faker });
expect(s.votes[clean[0].uid] === faker, 'a ballot can be switched while the ballot is open');
s = input(s, clean[0].uid, { action: 'vote', value: clean[0].uid });
expect(s.votes[clean[0].uid] === faker, 'nobody can name themselves');
s = input(s, clean[0].uid, { action: 'vote', value: 'ghost' });
expect(s.votes[clean[0].uid] === faker, 'a vote for a non-player is rejected');
// the faker throws a decoy, then the rest of the clean votes land
s = input(s, faker, { action: 'vote', value: clean[0].uid });
let lastBallot: ReduceResult<FkState> = { state: s };
for (const p of clean.slice(1)) {
  lastBallot = run(s, { type: 'INPUT', uid: p.uid, input: { action: 'vote', value: faker } });
  s = lastBallot.state;
}
expect(s.allIn === true, 'every ballot in → the last-chance window opens');
expect(timerFx(lastBallot)?.ms === LOCK_MS, 'the window is one LOCK_MS, granted when the last ballot lands');
expect(s.phase === 'vote', 'unanimity never ends the round early — the verdict cannot time the answer');
const switched = run(s, { type: 'INPUT', uid: clean[0].uid, input: { action: 'vote', value: faker } });
expect(
  !hasFx(switched, 'TIMER') && (switched.state as FkState).allIn === true,
  'switching inside the window does not extend it',
);

s = timeUp(s);
expect(s.phase === 'verdict', 'the window closes → the silent verdict');
expect(
  s.history['1']?.hit === true && s.history['1']?.unanimous === true,
  'round 1 was a unanimous hit (recorded, never rendered mid-game)',
);
expect(s.history['1']?.accusedUid === faker, 'the accusation landed on the faker');

s = timeUp(s);
expect(s.phase === 'brief' && s.roundNo === 2, 'round 2 starts on a fresh private card');
expect(s.prompt !== prompt1, 'round 2 gets a brand new prompt');
expect(s.fakerUid === faker, 'the same faker plays all three rounds');
expect(Object.keys(s.votes ?? {}).length === 0, 'the ballot is wiped for round 2');
expect(Object.keys(s.seen ?? {}).length === 0, 'everyone reads their card again in round 2');

// ---- round 2: one doubter → the ballot is split, the faker walks -----------
const prompt2 = s.prompt;
s = allReady(s).state; // cards
s = timeUp(s); // countdown
s = allReady(s).state; // discussion
expect(s.phase === 'vote', 'round 2 reaches the ballot');
const clean2 = cleanOf(s);
s = input(s, clean2[0].uid, { action: 'vote', value: faker });
s = input(s, clean2[1].uid, { action: 'vote', value: faker });
s = input(s, clean2[2].uid, { action: 'vote', value: clean2[0].uid }); // the doubter
s = input(s, faker, { action: 'vote', value: clean2[0].uid });
expect(s.allIn === true && s.phase === 'vote', 'a split settles on the clock exactly like a hit');
s = timeUp(s);
expect(
  s.history['2']?.unanimous === false && s.history['2']?.hit === false,
  'one doubter is all it takes to save the faker',
);
expect(s.history['2']?.prompt === prompt2, 'each round record keeps its own prompt');

// ---- round 3: nobody votes → the timer settles the last round --------------
s = timeUp(s);
expect(s.phase === 'brief' && s.roundNo === ROUNDS_COUNT, `round ${ROUNDS_COUNT} is the last one`);
expect(Object.keys(s.seen ?? {}).length === 0, 'round 3 opens on a fresh private card');
s = timeUp(s);
expect(s.phase === 'gesture', 'brief timer force-advances to the countdown');
s = timeUp(s);
expect(s.phase === 'reveal', 'countdown timer force-advances to the reveal');
s = timeUp(s);
expect(s.phase === 'vote', 'reveal timer force-advances to the ballot');
s = timeUp(s);
expect(s.phase === 'verdict' && s.history['3']?.unanimous === false, 'an empty ballot is no accusation');

s = timeUp(s);
expect(s.phase === 'unmask', 'all three rounds done → the unmask');

// ---- the tab ---------------------------------------------------------------
const ended = run(s, { type: 'TIME_UP', now });
const endFx = (ended.effects ?? []).find((fx) => fx.type === 'END');
expect(!!endFx, 'the unmask timer emits END');
if (endFx && endFx.type === 'END') {
  const assignments = endFx.assignments ?? [];
  const fakerRow = assignments.find((a) => a.uid === faker);
  expect(fakerRow?.sips === 3, 'the faker drinks 3 for the one round they were caught');
  const cleanRows = assignments.filter((a) => a.uid !== faker);
  expect(cleanRows.length === players.length - 1, 'every clean player drinks for the two rounds they were fooled');
  expect(cleanRows.every((a) => a.sips === 2), 'a round the faker gets away costs everyone else 1');
  expect(!!endFx.note && endFx.note.includes('1/3'), `summary note ok: ${endFx.note}`);
}
expect(ended.state.phase === 'done', 'the game closes out');

// ---- shared phone: one tap opens the ballot, and the recast walks it again --
const sharedCtx = mkCtx('shared');
let sh = definition.createInitialState(sharedCtx);
sh = step(sh, { type: 'BEGIN' }, sharedCtx);
sh = allReady(sh, sharedCtx).state;
sh = timeUp(sh, sharedCtx);
sh = input(sh, players[0].uid, { action: 'ready' }, sharedCtx);
expect(sh.phase === 'vote', 'shared phone: one tap calls the table to the ballot');
const shClean = cleanOf(sh);
for (const p of players) {
  const target = p.uid === sh.fakerUid ? shClean[0].uid : sh.fakerUid;
  sh = input(sh, p.uid, { action: 'vote', value: target }, sharedCtx);
}
expect(sh.allIn === true && sh.phase === 'vote', 'shared phone: every ballot in');
const recast = run(sh, { type: 'INPUT', uid: players[0].uid, input: { action: 'recast' } }, sharedCtx);
expect(
  hasFx(recast, 'CLEAR_INPUTS') && (recast.state as FkState).allIn === false,
  'shared phone: the recast hands the phone round again',
);
expect(
  Object.keys((recast.state as FkState).votes ?? {}).length === players.length,
  'the ballot stays on screen while the phone goes round again',
);
const partyRecast = run(sh, { type: 'INPUT', uid: players[0].uid, input: { action: 'recast' } }, ctx);
expect(!hasFx(partyRecast, 'CLEAR_INPUTS'), 'party mode has no recast — everyone switches their own ballot');

// ---- a room left mid-round by an older build folds into a fresh card -------
const legacy = definition.reduce(
  { ...s, phase: 'task' } as unknown as FkState,
  { type: 'TIME_UP', now },
  ctx,
);
expect(legacy.state.phase === 'brief' && hasFx(legacy, 'CLEAR_INPUTS'), 'a legacy phase recovers into a fresh private card');

console.log('\nAll smoke checks passed.');
