/**
 * Render check for the Boom Cup screens.
 *
 * The reducer sim (scripts/boomcup-sim.mts) proves the phase machine; this
 * proves the SCREEN contract, by rendering every state through
 * react-dom/server and reading the HTML:
 *   - the two shooters get a table, everyone else gets the chase
 *   - a player holding both cups is told so, and offered cup 1 first
 *   - the aim assist only shows up when a cup has actually missed
 *   - a first-try sink offers the choice to the shooter and nobody else,
 *     with the other ball's holder marked as the catch
 *   - a state that came back from RTDB empty (dropped objects/arrays, or a
 *     round left over from an older build) renders instead of crashing
 *
 * Run (no test runner in this repo, so bundle it with the esbuild that ships
 * with vite, then run the bundle):
 *   node node_modules/esbuild/bin/esbuild scripts/boomcup-view-check.tsx --bundle \
 *     --platform=node --format=cjs --jsx=automatic --outfile=node_modules/.tmp-bc-view.cjs
 *   node node_modules/.tmp-bc-view.cjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { View } from '../src/games/BoomCup/View';
import {
  definition,
  SHOT_COOLDOWN_MS,
  type BcInput,
  type BcState,
} from '../src/games/BoomCup/definition';
import { IDEAL_SWIPE } from '../src/games/BoomCup/physics';
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

let now = 1_000_000;

function ctx(mode: RoomMode = 'party'): GameContext {
  return {
    players,
    actorUid: 'p0',
    turnOrder: players.map((p) => p.uid),
    settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: ['boom-cup'] },
    rng: mulberry32(7),
    now,
  };
}

const IN: BcInput['shot'] = { dx: 0, dy: IDEAL_SWIPE, ms: 200 };

function play(mode: RoomMode, steps: ((s: BcState) => BcInput | null)[]): BcState {
  let s = definition.createInitialState(ctx(mode));
  for (const step of steps) {
    const input = step(s);
    if (!input) break;
    now += SHOT_COOLDOWN_MS + 50;
    const uid = s.give?.uid ?? (s.hold[s.turn] ?? 'p0');
    s = definition.reduce(s, { type: 'INPUT', uid, input }, ctx(mode)).state;
  }
  return s;
}

let fails = 0;
function expect(cond: boolean, msg: string) {
  if (!cond) fails++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}: ${msg}`);
}

function render(state: BcState, meUid: string, variant: RoomMode = 'party'): string {
  const props: GameViewProps<BcState, BcInput> = {
    state,
    me: players.find((p) => p.uid === meUid)!,
    players,
    actorUid: 'p0',
    isActor: meUid === 'p0',
    isAuthority: true,
    myInput: null,
    answeredUids: [],
    timerEndsAt: now + 8_000,
    submitInput: () => {},
    variant,
  };
  return renderToStaticMarkup(<View {...props} />);
}

/* ---- the opening screen: two shooters, two watchers ---- */
const opening = definition.createInitialState(ctx());
expect(opening.hold[0] === 'p0' && opening.hold[1] === 'p2', 'the two starting holders are the far pair');
const p0Html = render(opening, 'p0');
const p1Html = render(opening, 'p1');
expect(p0Html.includes('bc-table'), 'a holder gets the table to swipe on');
expect(p0Html.includes('swipe up'), 'the holder is told what to do');
expect(!p1Html.includes('bc-table'), 'a player with no cup does not get a dead table');
expect(p1Html.includes('watch the chase'), 'the player with no cup watches the chase');
expect((p0Html.match(/class="bc-dot /g) ?? []).length === 2, 'both cups are marked on the seating ring');
expect(p0Html.includes('4 left in the middle'), 'the middle reads out');
expect(!p0Html.includes('bc-mercy'), 'no aim assist on a fresh cup');
expect(p0Html.includes('Player2'), 'the other ball is named on your table');

/* ---- a miss widens the mouth, and says so ---- */
const missed = play('party', [() => ({ shot: { dx: 0, dy: IDEAL_SWIPE * 0.6, ms: 200 } })]);
const missedHtml = render(missed, 'p0');
expect(missedHtml.includes('bc-mercy'), 'a missed cup shows its aim assist');
expect(missedHtml.includes('aim assist'), 'and the number is on screen');
expect(missedHtml.includes('miss 1'), 'the miss streak is on the HUD');

/* ---- the pass moves the table to the next player ---- */
const passed = play('party', [
  () => ({ shot: { dx: 0, dy: IDEAL_SWIPE * 0.6, ms: 200 } }),
  () => ({ shot: IN }),
]);
expect(passed.hold[0] === 'p1', 'the sunk cup moved on');
expect(!render(passed, 'p0').includes('bc-table'), 'the passer lost their table');
expect(render(passed, 'p1').includes('bc-table'), 'the next player got it');

/* ---- first try: the choice, and only the shooter gets it ---- */
const choosing = play('party', [() => ({ shot: IN })]);
expect(choosing.phase === 'handoff', 'a first-try sink opens the choice');
const chooserHtml = render(choosing, 'p0');
const otherHtml = render(choosing, 'p2');
expect(chooserHtml.includes('bc-give'), 'the shooter gets the picker');
expect(chooserHtml.includes('CATCH them!'), 'the other ball is marked as the catch');
expect(chooserHtml.includes('next in line'), 'the default pass is marked');
expect((chooserHtml.match(/class="pick-person"/g) ?? []).length === 3, 'the picker offers everyone but you');
expect(!otherHtml.includes('bc-give'), 'nobody else can spend the choice');
expect(otherHtml.includes('hold tight'), 'everyone else waits it out');
expect(otherHtml.includes('timerbar'), 'the choice is visibly on a clock');

/* ---- the catch ---- */
const caught = play('party', [
  () => ({ shot: IN }),
  (s) => ({ give: s.hold[1] }), // straight onto the other ball
]);
expect(caught.caught.p2 === 1, 'the catch landed on p2');
const caughtHtml = render(caught, 'p2');
expect(caughtHtml.includes('got caught'), 'the catch is announced on every phone');
expect(caughtHtml.includes('both cups are yours'), 'the caught player is told they hold both');
expect(caughtHtml.includes('cup 1 first'), 'and which cup to clear first');

/* ---- the BOOM flash, off a round the chase already drained ---- */
const chase = play('party', [
  () => ({ shot: IN }),
  (s) => ({ give: s.hold[1] }),
  () => ({ shot: IN }),
  (s) => ({ give: nextOf(s, 'p2') }),
  () => ({ shot: IN }),
  (s) => ({ give: nextOf(s, 'p2') }),
  () => ({ shot: IN }),
  (s) => ({ give: nextOf(s, 'p3') }),
  () => ({ shot: IN }),
  (s) => ({ give: nextOf(s, 'p3') }),
]);
expect(chase.middle < 4, `the middle drains as the chase runs (${chase.middle} left)`);
expect(render(chase, 'p0').includes('got caught'), 'the catch flash renders');

/* ---- shared phone ---- */
const shared = play('shared', [() => ({ shot: { dx: 0, dy: IDEAL_SWIPE * 0.6, ms: 200 } })]);
expect(shared.turn === 1, 'a shared-phone miss hands the attempt over');
expect(render(shared, 'p2', 'shared').includes('bc-table'), 'the phone goes to the other shooter');

/* ---- old / half-empty state off the wire must not crash ---- */
const empty = render({ phase: 'shooting' } as BcState, 'p0');
expect(empty.length > 0, 'a state with every object dropped still renders');
const legacy = render({ phase: 'drinking' } as unknown as BcState, 'p0');
expect(legacy.length > 0, 'a phase from an older build still renders');

function nextOf(s: BcState, uid: string): string {
  const ring = s.ring ?? [];
  const i = ring.indexOf(uid);
  return i < 0 ? (ring[0] ?? '') : (ring[(i + 1) % ring.length] ?? '');
}

console.log(fails === 0 ? '\nBoom Cup view checks passed.' : `\n${fails} view check(s) FAILED.`);
if (fails > 0) process.exit(1);
