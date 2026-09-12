/**
 * Offline smoke test for the Boom Cup reducer.
 *
 * Drives full rounds through fake rooms and checks the things the game's
 * whole design rests on:
 *   - only a holder can shoot, and only after the ball has come back
 *   - a miss keeps the cup (and its streak), a sink moves it to the next seat
 *   - a FIRST-TRY sink stops the game for the shooter's free choice of victim
 *   - a cup arriving on the player still holding the other ball CATCHES them:
 *     they drink on the spot, keep both cups, and their streak restarts
 *   - the middle drains one beer per catch and the last one is the BOOM (+2)
 *   - shared phone: one attempt each, back and forth, via the turn
 *   - a player walking off mid-round doesn't strand a cup or hang the round
 *
 * Run: npx tsx scripts/boomcup-sim.mts
 *  or, offline with the esbuild that ships with vite:
 *      node node_modules/esbuild/bin/esbuild scripts/boomcup-sim.mts --bundle \
 *        --platform=node --format=cjs --outfile=node_modules/.tmp-boomcup-sim.cjs \
 *        && node node_modules/.tmp-boomcup-sim.cjs
 */
import {
  activeCupFor,
  definition,
  BOOM_SIPS,
  CATCH_SIPS,
  HANDOFF_MS,
  IDLE_MS,
  SHOT_COOLDOWN_MS,
  type BcInput,
  type BcState,
} from '../src/games/BoomCup/definition';
import { IDEAL_SWIPE, resolveShot } from '../src/games/BoomCup/physics';
import { mulberry32 } from '../src/engine/rng';
import type { Effect, GameContext, GameEvent, PlayerInfo } from '../src/engine/types';

let now = 1_000_000;
let failures = 0;

function check(label: string, ok: boolean, extra?: unknown): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
  }
}

const section = (t: string) => console.log(`\n${t}`);

function mkPlayer(i: number): PlayerInfo {
  return {
    uid: `p${i}`,
    name: `P${i}`,
    emoji: '🍺',
    isHost: i === 0,
    connected: true,
    local: false,
    drinkCount: 0,
    score: 0,
    joinedAt: i,
  };
}

const IN: BcInput['shot'] = { dx: 0, dy: IDEAL_SWIPE, ms: 220 };
const MISS: BcInput['shot'] = { dx: 0, dy: IDEAL_SWIPE * 0.55, ms: 220 };
const TINY: BcInput['shot'] = { dx: 0, dy: 0.01, ms: 60 };

/** a room wired straight to the reducer: the same calls the host loop makes */
class Room {
  s: BcState;
  players: PlayerInfo[];
  mode: 'party' | 'shared';
  effects: Effect[] = [];

  constructor(mode: 'party' | 'shared' = 'party', n = 4) {
    this.mode = mode;
    this.players = Array.from({ length: n }, (_, i) => mkPlayer(i));
    this.s = definition.createInitialState(this.ctx());
  }

  ctx(): GameContext {
    return {
      players: this.players,
      actorUid: this.players[0]?.uid ?? null,
      turnOrder: this.players.map((p) => p.uid),
      settings: {
        mode: this.mode,
        pointsMode: false,
        sipMultiplier: 1,
        enabledGames: ['boom-cup'],
      },
      rng: mulberry32(99),
      now,
    };
  }

  ev(e: GameEvent<BcInput>): Effect[] {
    const res = definition.reduce(this.s, e, this.ctx());
    this.s = res.state;
    this.effects = res.effects ?? [];
    return this.effects;
  }

  /** a shot at whatever cup this player is holding, after the ball is back */
  shoot(uid: string, shot: BcInput['shot'] = IN): Effect[] {
    now += SHOT_COOLDOWN_MS + 50;
    return this.ev({ type: 'INPUT', uid, input: { shot } });
  }

  give(uid: string, target: string): Effect[] {
    now += 100;
    return this.ev({ type: 'INPUT', uid, input: { give: target } });
  }

  tick(ms: number): Effect[] {
    now += ms;
    return this.ev({ type: 'TIME_UP', now });
  }

  drinks(): { uid: string; sips: number }[] {
    return this.effects
      .filter((e): e is Extract<Effect, { type: 'DRINKS' }> => e.type === 'DRINKS')
      .flatMap((e) => e.assignments.map((a) => ({ uid: a.uid, sips: a.sips })));
  }

  end(): Extract<Effect, { type: 'END' }> | undefined {
    return this.effects.find((e): e is Extract<Effect, { type: 'END' }> => e.type === 'END');
  }
}

/* ============================================================ */

section('physics — the swipe itself');
{
  const perfect = resolveShot(IN, 0);
  check('a straight flick at the ideal distance is in', perfect.ok && perfect.made, perfect);
  const short = resolveShot({ dx: 0, dy: IDEAL_SWIPE * 0.55, ms: 200 }, 0);
  check('a short flick lands short (and is judged out)', short.ok && !short.made, short);
  const wayward = resolveShot({ dx: 0.5, dy: IDEAL_SWIPE, ms: 200 }, 0);
  check('a diagonal flick drifts off the cup', !wayward.made, wayward);
  const tap = resolveShot(TINY, 0);
  check('a stray tap is not a shot at all', !tap.ok, tap);
  const nearMiss = { dx: 0, dy: IDEAL_SWIPE * 0.75, ms: 200 };
  check('a flick a little short is judged out', !resolveShot(nearMiss, 0).made, resolveShot(nearMiss, 0));
  check(
    'the same flick drops in once the aim assist has grown',
    resolveShot(nearMiss, 2).made,
    resolveShot(nearMiss, 2),
  );
  check('the assist is capped, not unlimited', !resolveShot(MISS, 9).made, resolveShot(MISS, 9));
}

section('setup — two cups, as far apart as the table allows');
{
  const r = new Room('party', 4);
  check('ring is the claimed order', r.s.ring.join(',') === 'p0,p1,p2,p3', r.s.ring);
  check('cup 1 starts opposite cup 0', r.s.hold.join(',') === 'p0,p2', r.s.hold);
  check('the middle holds one beer per player', r.s.middle === 4 && r.s.middleMax === 4, r.s.middle);
  const fx = r.ev({ type: 'BEGIN' });
  check(
    'BEGIN only arms the idle safety net',
    fx.length === 1 && fx[0].type === 'TIMER' && fx[0].ms === IDLE_MS,
    fx,
  );
  const r2 = new Room('party', 2);
  check('two players still get a cup each', r2.s.hold.join(',') === 'p0,p1', r2.s.hold);
  check('a 2-player middle is 3 beers', r2.s.middle === 3, r2.s.middle);
}

section('the shot — only a holder, only when the ball is back');
{
  const r = new Room();
  const before = r.s.seq;
  r.shoot('p1', IN);
  check('a player with no cup cannot shoot', r.s.seq === before && r.s.hold.join(',') === 'p0,p2');

  now += SHOT_COOLDOWN_MS + 50;
  r.ev({ type: 'INPUT', uid: 'p0', input: { shot: TINY } });
  check('a stray tap changes nothing', r.s.seq === 0 && (r.s.miss[0] ?? 0) === 0, r.s);

  r.shoot('p0', MISS);
  check('a miss keeps the cup and burns a try', r.s.miss[0] === 1 && r.s.hold[0] === 'p0', r.s.miss);
  check('the miss is published for every phone to draw', r.s.last?.made === false && r.s.last.uid === 'p0');

  const held = r.ev({ type: 'INPUT', uid: 'p0', input: { shot: IN } });
  check('the ball is not back yet, so the shot is dropped', held.length === 0 && r.s.seq === 1);

  r.shoot('p0', IN);
  check('sinking it after a miss passes to the next in line', r.s.hold[0] === 'p1' && r.s.miss[0] === 0, r.s.hold);
  check('the pass arms the idle safety net only', r.effects.length === 1 && r.effects[0].type === 'TIMER');
}

section('first try — the shooter picks anyone');
{
  const r = new Room();
  r.shoot('p0', IN);
  check('a first-try sink stops for the choice', r.s.phase === 'handoff' && r.s.give?.uid === 'p0', r.s.give);
  check('the default is the next seat', r.s.give?.nextUid === 'p1');
  check('the choice is on a clock', r.effects[0]?.type === 'TIMER' && r.effects[0].ms === HANDOFF_MS);

  const ignored = r.give('p3', 'p1');
  check('somebody else cannot spend your choice', ignored.length === 0 && r.s.phase === 'handoff');

  r.give('p0', 'p3');
  check('the cup lands on whoever the shooter picked', r.s.hold[0] === 'p3' && r.s.phase === 'shooting', r.s.hold);
  check('picking a player with no ball is not a catch', r.drinks().length === 0);

  const r2 = new Room();
  r2.shoot('p0', IN);
  r2.give('p0', 'p0');
  check('handing it to yourself falls back to the next seat', r2.s.hold[0] === 'p1', r2.s.hold);
}

section('the catch — the cup lands on the other ball');
{
  const r = new Room();
  r.shoot('p0', IN);
  r.give('p0', 'p2'); // p2 is still holding cup 1
  check('handing it to the other holder catches them', r.s.caught.p2 === 1, r.s.caught);
  check('they drink one, on the spot', JSON.stringify(r.drinks()) === JSON.stringify([{ uid: 'p2', sips: CATCH_SIPS }]), r.drinks());
  check('the catcher is credited', r.effects.some((e) => e.type === 'SCORE' && e.uid === 'p0' && e.delta === 1));
  check('the middle loses a beer', r.s.middle === 3, r.s.middle);
  check('the caught player is left holding both cups', r.s.hold.join(',') === 'p2,p2', r.s.hold);
  check('their cup is a fresh beer, so the streak restarts', r.s.miss[1] === 0);
  check('the catch is published for the flash', r.s.lastCatch?.uid === 'p2' && r.s.lastCatch.byUid === 'p0');
  check('only cup 0 is shootable while both are held', activeCupFor(r.s, 'p2', false) === 0);
}

section('the chase — catching the next player on the way round');
{
  const r = new Room();
  r.shoot('p0', IN);
  r.give('p0', 'p2');
  // p2 holds both: clear one, then drop the other on the next in line
  r.shoot('p2', IN);
  r.give('p2', 'p3');
  check('the first cup is cleared onto p3', r.s.hold.join(',') === 'p3,p2', r.s.hold);
  r.shoot('p2', IN);
  r.give('p2', 'p3');
  check('the second cup catches them straight away', r.s.caught.p3 === 1 && r.s.hold.join(',') === 'p3,p3', r.s);
  check('the middle is down to two', r.s.middle === 2);
}

section('the BOOM — the last beer in the middle');
{
  const r = new Room();
  const script: [string, string][] = [
    ['p0', 'p2'],
    ['p2', 'p3'],
    ['p2', 'p3'],
    ['p3', 'p0'],
    ['p3', 'p0'],
    ['p0', 'p1'],
    ['p0', 'p1'],
  ];
  let ended = false;
  for (const [shooter, victim] of script) {
    if (ended) break;
    r.shoot(shooter, IN);
    const gave = r.give(shooter, victim);
    ended = gave.some((e) => e.type === 'END');
  }
  check('seven cups drained a four-beer middle', r.s.middle === 0, r.s.middle);
  check('somebody took the BOOM', !!r.s.boomUid, r.s.boomUid);
  const boom = r.drinks().find((d) => d.sips === BOOM_SIPS);
  check('the BOOM is two extra sips, applied live', !!boom && boom.uid === r.s.boomUid, r.drinks());
  const end = r.end();
  check('the round closes itself', !!end);
  check('drinks were already applied, so END carries none', (end?.assignments ?? []).length === 0, end?.assignments);
  check('the recap names the BOOM taker', !!end?.recap?.groups.some((g) => g.uids.includes(r.s.boomUid!)), end?.recap);
  check('the recap lists everyone caught', (end?.recap?.groups ?? []).some((g) => g.uids.length >= 2), end?.recap);
  check('the note explains the ending', !!end?.note && end.note.includes('BOOM'), end?.note);
}

section('shared phone — one attempt each, back and forth');
{
  const r = new Room('shared');
  check('cup 0 is up first', r.s.turn === 0 && definition.sharedHolderUid?.(r.s, { players: r.players, actorUid: null }) === 'p0');
  const wrong = r.shoot('p2', IN);
  check('the other holder cannot shoot out of turn', wrong.length === 0 && r.s.seq === 0);

  r.shoot('p0', MISS);
  check('a miss hands the attempt over', r.s.turn === 1 && r.s.miss[0] === 1, r.s.turn);
  check(
    'the phone is told to travel',
    definition.sharedHolderUid?.(r.s, { players: r.players, actorUid: null }) === 'p2',
  );

  r.shoot('p2', IN);
  check('a first-try sink stops for the choice, phone staying put', r.s.phase === 'handoff' && r.s.give?.uid === 'p2');
  check(
    'the chooser holds the phone, not the next shooter',
    definition.sharedHolderUid?.(r.s, { players: r.players, actorUid: null }) === 'p2',
  );
  r.give('p2', 'p1');
  check('the cup that just moved is now p1\'s', r.s.hold[1] === 'p1', r.s.hold);
  check('and the attempt goes back round to cup 0', r.s.turn === 0, r.s.turn);
  check(
    'so the phone travels to p0',
    definition.sharedHolderUid?.(r.s, { players: r.players, actorUid: null }) === 'p0',
  );
  r.shoot('p0', IN);
  check('p0 had already missed, so this sink goes to the next in line', r.s.hold[0] === 'p1', r.s.hold);
  check('both cups are now p1\'s, and the attempt is the other cup', r.s.turn === 1 && r.s.hold[1] === 'p1', r.s);
  check(
    'the phone follows the cups to p1',
    definition.sharedHolderUid?.(r.s, { players: r.players, actorUid: null }) === 'p1',
  );
}

section('a phone walks off mid-round');
{
  const r = new Room('party', 4);
  r.players = r.players.filter((p) => p.uid !== 'p0'); // the cup 0 holder leaves
  const fx = r.shoot('p2', MISS);
  check('the round survives it', fx.length > 0 && (r.s.ring ?? []).length === 3, r.s.ring);
  check('the abandoned cup moves to the next player present', r.s.hold[0] === 'p1', r.s.hold);
  check('cup 1 is untouched', r.s.hold[1] === 'p2', r.s.hold);

  const solo = new Room('party', 2);
  solo.players = solo.players.filter((p) => p.uid !== 'p1');
  const end = solo.tick(IDLE_MS);
  check('a table that drops below two players closes the round', end.some((e) => e.type === 'END'));
}

section('nobody shoots — the round closes itself');
{
  const r = new Room();
  const fx = r.tick(IDLE_MS);
  check('the idle safety net ends the round', fx.some((e) => e.type === 'END'));
  const end = r.end();
  check('nothing was drunk', (end?.assignments ?? []).length === 0);
  check('the note says so', !!end?.note && end.note.includes('nobody sank'), end?.note);

  // the shooter wandering off mid-choice must not hang the round either
  const r2 = new Room();
  r2.shoot('p0', IN);
  const fx2 = r2.tick(HANDOFF_MS);
  check('an abandoned free choice falls back to the next seat', r2.s.hold[0] === 'p1', r2.s.hold);
  check('and the round keeps playing', fx2.some((e) => e.type === 'TIMER') && !fx2.some((e) => e.type === 'END'));
}

console.log(
  failures === 0 ? '\n💥 Boom Cup: all checks passed' : `\n💥 Boom Cup: ${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
