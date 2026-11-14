/**
 * Render check for the Fake It Till You Make It screens.
 *
 * The reducer sim (scripts/fakeit-sim.mts) proves the phase machine; this
 * proves the SCREEN contract the overhaul is built on, by rendering every
 * screen through react-dom/server and reading the HTML:
 *   - the countdown screen is byte-identical for the faker and everyone else
 *   - the prompt is nowhere in the HTML on the faker's card or the countdown
 *   - the ballot is sealed, clockless, and marks nobody
 *   - CAUGHT names the faker and ends the game; a getaway (split ballot or a
 *     convicted innocent) is announced without saying who the faker is
 *
 * Run (no test runner in this repo, so bundle it with the esbuild that ships
 * with vite, then run the bundle):
 *   node_modules/.bin/esbuild scripts/fakeit-view-check.tsx --bundle \
 *     --platform=node --format=cjs --jsx=automatic '--define:import.meta.env={}' --outfile=$TMP/fk.cjs
 *   node $TMP/fk.cjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { View } from '../src/games/FakeIt/View';
import { definition, type FkInput, type FkState } from '../src/games/FakeIt/definition';
import { mulberry32 } from '../src/engine/rng';
import type { GameContext, GameViewProps, PlayerInfo, RoomMode } from '../src/engine/types';

const players: PlayerInfo[] = [0, 1, 2, 3].map((i) => ({
  uid: `p${i}`,
  name: `Player${i}`,
  emoji: '🍺',
  isHost: i === 0,
  connected: true,
  local: false,
  drinkCount: 0,
  score: 0,
  joinedAt: i,
}));

const ctx: GameContext = {
  players,
  actorUid: null,
  turnOrder: [],
  settings: { mode: 'party', pointsMode: false, sipMultiplier: 1, enabledGames: ['fakeit'] },
  rng: mulberry32(7),
  now: 1_000_000,
  roundId: 'r',
  phaseId: 'ph',
  revision: 0,
};

const base = definition.createInitialState(ctx);
const faker = base.fakerUid;
const cleanUid = players.find((p) => p.uid !== faker)!.uid;
const otherUid = players.find((p) => p.uid !== faker && p.uid !== cleanUid)!.uid;
const prompt = base.prompt;

let fails = 0;
function expect(cond: boolean, msg: string) {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}: ${msg}`);
}

function render(state: FkState, meUid: string, variant: RoomMode = 'party'): string {
  const props: GameViewProps<FkState, FkInput> = {
    state,
    me: players.find((p) => p.uid === meUid)!,
    players,
    actorUid: null,
    isActor: false,
    isAuthority: true,
    myInput: null,
    answeredUids: [],
    timerEndsAt: ctx.now + 8_000,
    submitInput: () => {},
    variant,
  };
  return renderToStaticMarkup(<View {...props} />);
}

/** Two screens must match even when their clocks tick a millisecond apart. */
const strip = (html: string) => html.replace(/\d+/g, '#');

expect(prompt.length > 5, `prompt picked: ${prompt}`);

/* ---- brief: the clean player gets the prompt, the faker gets the move ---- */
const cleanBrief = render(base, cleanUid);
const fakerBrief = render(base, faker);
expect(cleanBrief.includes(prompt), 'brief: the clean card carries the prompt');
expect(!fakerBrief.includes(prompt), 'brief: the faker card never carries the prompt');
expect(/blend in/i.test(fakerBrief) && /the faker/i.test(fakerBrief), 'brief: the faker is told to blend in');
expect(
  ['🖐', '👉', '✋'].some((e) => fakerBrief.includes(e)),
  'brief: the faker is told which move the table is playing',
);

/* ---- countdown: one screen for the whole table ---- */
const gesture: FkState = { ...base, phase: 'gesture' };
const gestureClean = strip(render(gesture, cleanUid));
const gestureFaker = strip(render(gesture, faker));
expect(gestureClean === gestureFaker, 'countdown: the faker sees the exact same screen as everyone else');
expect(!gestureClean.includes(prompt), 'countdown: no prompt on screen');
expect(!/you are the faker/i.test(gestureClean), 'countdown: no role badge');
expect(!gestureClean.includes('🗳️'), 'countdown: no ballot');
expect(/fx-count/.test(gestureClean), 'countdown: the clock is the screen');

/* ---- reveal: the prompt is public for everyone now ---- */
const reveal: FkState = { ...base, phase: 'reveal' };
expect(render(reveal, cleanUid).includes(prompt), 'reveal: the prompt is public to the clean players');
expect(render(reveal, faker).includes(prompt), 'reveal: the faker sees the prompt with everyone else');

/* ---- vote: sealed ballots, a lock-in, and no clock ---- */
const voteState: FkState = {
  ...base,
  phase: 'vote',
  votes: { [faker]: cleanUid, [otherUid]: faker },
};
const vote = render(voteState, cleanUid);
expect(vote.includes('PICK A SUSPECT'), 'vote: the lock-in button waits for a pick');
expect(vote.includes('Player0') && vote.includes('2/4 locked in'), 'vote: the table sees who has locked in');
expect(!/you are the faker/i.test(vote), 'vote: nothing marks the faker on a clean phone');
expect(!vote.includes('timerbar'), 'vote: there is no countdown on the ballot');
expect(vote.includes('3 votes convict'), 'vote: a table of 4 is told it takes 3 votes');
const lockedHtml = render(voteState, otherUid);
expect(lockedHtml.includes('LOCKED') && lockedHtml.includes('You named'), 'vote: a locked ballot reads as locked');
expect(render(voteState, otherUid, 'shared').includes('Your ballot is sealed') && !render(voteState, otherUid, 'shared').includes('You named'), 'vote: a shared phone never shows a sealed ballot back');
expect(render({ ...base, phase: 'vote' } as FkState, cleanUid).includes('0/4 locked in'), 'vote: an empty ballot box (dropped by RTDB) renders');

/* ---- verdict: the result is said out loud ---- */
const allOnFaker = Object.fromEntries(players.map((p) => [p.uid, p.uid === faker ? cleanUid : faker]));
const fakerName = players.find((p) => p.uid === faker)!.name;
const caught: FkState = {
  ...base,
  phase: 'verdict',
  votes: allOnFaker,
  history: { '1': { roundNo: 1, prompt, accusedUid: faker, result: 'caught', votes: allOnFaker } },
};
const caughtHtml = render(caught, cleanUid);
expect(caughtHtml.includes('CAUGHT!') && caughtHtml.includes(fakerName), 'verdict: CAUGHT names the faker to the table');
expect(caughtHtml.includes('no more rounds'), 'verdict: a catch ends the game');

const split: FkState = {
  ...caught,
  history: { '1': { roundNo: 1, prompt, accusedUid: null, result: 'split', votes: {} } },
};
const splitHtml = render(split, cleanUid);
expect(splitHtml.includes('GOT AWAY'), 'verdict: a split ballot says the faker got away');
expect(strip(splitHtml) === strip(render(split, faker)), 'verdict: a getaway looks the same on the faker\'s phone');
expect(!/you are the faker/i.test(render(split, faker)), 'verdict: a getaway never says who the faker is');

const innocent: FkState = {
  ...caught,
  history: { '1': { roundNo: 1, prompt, accusedUid: cleanUid, result: 'innocent', votes: {} } },
};
const innocentHtml = render(innocent, otherUid);
expect(innocentHtml.includes('INNOCENT') && innocentHtml.includes('the faker got away'), 'verdict: a wrong conviction is called out');

/* ---- unmask: a faker nobody caught ---- */
const unmaskHtml = render({ ...split, phase: 'unmask' }, cleanUid);
expect(unmaskHtml.includes(fakerName) && unmaskHtml.includes('GOT AWAY'), 'unmask: the survivor is named');
expect(unmaskHtml.includes(prompt), 'unmask: the round record prints');
expect(render({ ...base, phase: 'unmask', history: undefined } as unknown as FkState, cleanUid).includes(fakerName), 'unmask: renders without a history');

/* ---- shared phone: nothing private leaks onto the pass-around screen ---- */
const sharedBrief = render(base, cleanUid, 'shared');
expect(!sharedBrief.includes(prompt), 'shared brief: the prompt stays behind the hold-to-peek gate');
expect(/hold to peek/i.test(sharedBrief), 'shared brief: the peek gate renders');
expect(!render(gesture, cleanUid, 'shared').includes(prompt), 'shared countdown: still no prompt');

/* ---- a room mid-round on an older build must not crash ---- */
const legacy = render({ ...base, phase: 'task' } as unknown as FkState, cleanUid);
expect(legacy.length > 0, 'legacy phase renders instead of crashing');

console.log(fails === 0 ? '\nView render checks passed.' : `\n${fails} view check(s) FAILED.`);
if (fails > 0) process.exit(1);
