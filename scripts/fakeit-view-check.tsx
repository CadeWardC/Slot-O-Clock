/**
 * Render check for the Fake It Till You Make It screens.
 *
 * The reducer sim (scripts/fakeit-sim.mts) proves the phase machine; this
 * proves the SCREEN contract the overhaul is built on, by rendering every
 * screen through react-dom/server and reading the HTML:
 *   - the countdown screen is byte-identical for the faker and everyone else
 *   - the prompt is nowhere in the HTML on the faker's card or the countdown
 *   - the public ballot marks nobody, and the sealed verdict reads the same
 *     whether the group caught the faker or blew it
 *
 * Run (no test runner in this repo, so bundle it with the esbuild that ships
 * with vite, then run the bundle):
 *   node_modules/.bin/esbuild scripts/fakeit-view-check.tsx --bundle \
 *     --platform=node --format=cjs --jsx=automatic --outfile=$TMP/fk.cjs
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
expect(fakerBrief.includes('BLEND IN'), 'brief: the faker is told to blend in');
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
expect(/fk-clock/.test(gestureClean), 'countdown: the clock is the screen');

/* ---- reveal: the prompt is public for everyone now ---- */
const reveal: FkState = { ...base, phase: 'reveal' };
expect(render(reveal, cleanUid).includes(prompt), 'reveal: the prompt is public to the clean players');
expect(render(reveal, faker).includes(prompt), 'reveal: the faker sees the prompt with everyone else');

/* ---- vote: the public board, and no faker marking anywhere ---- */
const voteState: FkState = {
  ...base,
  phase: 'vote',
  votes: { [faker]: cleanUid, [cleanUid]: faker, [otherUid]: faker },
  allIn: false,
};
const vote = render(voteState, cleanUid);
expect(vote.includes('NAME THE FAKER'), 'vote: the ballot heading renders');
expect(vote.includes('Player0'), 'vote: the live board names everyone');
expect(!vote.includes('fk-row-faker') && !/you are the faker/i.test(vote), 'vote: the board gives the faker away to nobody');
expect(vote.includes('still thinking'), 'vote: players who have not voted read as such');

const locked: FkState = { ...voteState, votes: { ...voteState.votes, p3: faker }, allIn: true };
const lockedHtml = render(locked, cleanUid);
expect(lockedHtml.includes('EVERY BALLOT IS IN'), 'vote: the last-chance window renders');
expect(!/unanimous/i.test(lockedHtml), 'vote: the window never announces unanimity');
expect(render(locked, cleanUid, 'shared').includes('HAND THE PHONE ROUND AGAIN'), 'vote: the shared phone can go round again');

/* ---- verdict: silent in both directions ---- */
const hit: FkState = {
  ...base,
  phase: 'verdict',
  votes: { [faker]: cleanUid, [cleanUid]: faker, [otherUid]: faker, p3: faker },
  history: { '1': { roundNo: 1, prompt, accusedUid: faker, unanimous: true, hit: true, votes: {} } },
};
const miss: FkState = {
  ...hit,
  history: { '1': { roundNo: 1, prompt, accusedUid: null, unanimous: false, hit: false, votes: {} } },
};
const hitHtml = render(hit, cleanUid);
const missHtml = render(miss, cleanUid);
expect(hitHtml === missHtml, 'verdict: a catch and a miss render identically (the seal holds)');
expect(!/CAUGHT|GOT AWAY/.test(hitHtml), 'verdict: no per-case announcement leaks the result');
expect(hitHtml.includes('sealed'), 'verdict: the app says the verdict is sealed');

/* ---- unmask: the only screen that prints the truth ---- */
const unmaskHtml = render({ ...hit, phase: 'unmask' }, cleanUid);
expect(unmaskHtml.includes(prompt) && /CAUGHT/.test(unmaskHtml), 'unmask: the round record prints');
expect(unmaskHtml.includes(players.find((p) => p.uid === faker)!.name), 'unmask: the faker is named');
expect(render({ ...miss, phase: 'unmask' }, cleanUid).includes('GOT AWAY'), 'unmask: a missed round prints too');

/* ---- shared phone: nothing private leaks onto the pass-around screen ---- */
const sharedBrief = render(base, cleanUid, 'shared');
expect(!sharedBrief.includes(prompt), 'shared brief: the prompt stays behind the hold-to-peek gate');
expect(sharedBrief.includes('hold to peek'), 'shared brief: the peek gate renders');
expect(!render(gesture, cleanUid, 'shared').includes(prompt), 'shared countdown: still no prompt');

/* ---- a room mid-round on an older build must not crash ---- */
const legacy = render({ ...base, phase: 'task' } as unknown as FkState, cleanUid);
expect(legacy.length > 0, 'legacy phase renders instead of crashing');

console.log(fails === 0 ? '\nView render checks passed.' : `\n${fails} view check(s) FAILED.`);
if (fails > 0) process.exit(1);
