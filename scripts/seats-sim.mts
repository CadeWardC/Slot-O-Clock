/**
 * Offline smoke test for the room's seat rules — the two things a party game
 * lives or dies on:
 *
 *   1. a phone that merely goes dark (screen off, tunnel, Wi-Fi blip) keeps its
 *      SEAT: it stays in the room, keeps its score and its turn, never blocks
 *      the ready gate, and slides straight back in when it wakes up;
 *   2. closing the site is a departure: the room drops that player from the
 *      gates, from the turn order and from the next round's roster until their
 *      phone comes back — and when it does, they walk in like anyone else
 *      joining mid-match and play from the next minigame;
 *   3. joining mid-match works: the seat exists immediately, the running round
 *      doesn't change shape under the host, and the newcomer is in the next
 *      round's roster with a slot in the turn order.
 *
 * It drives the same pure helpers the host loop and the screens use
 * (src/types.ts) over room snapshots shaped exactly like the ones RTDB hands
 * back, and replays the host loop's round-boundary decisions with them.
 *
 * Run: npx tsx scripts/seats-sim.mts
 *  or, offline with the esbuild that ships with vite:
 *      node node_modules/esbuild/bin/esbuild scripts/seats-sim.mts --bundle \
 *        --platform=node --format=cjs --outfile=node_modules/.tmp-seats-sim.cjs \
 *        && node node_modules/.tmp-seats-sim.cjs
 */
import {
  activePlayers,
  actorFromOrder,
  departedPlayers,
  inCurrentRound,
  livePlayers,
  notReady,
  playerList,
  roundPlayers,
  turnOrderForRoom,
  type RoomData,
} from '../src/types';
import type { PlayerInfo } from '../src/engine/types';

let failures = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${extra === undefined ? '' : ` — ${JSON.stringify(extra)}`}`);
  }
}
const section = (t: string) => console.log(`\n${t}`);

const uids = (players: PlayerInfo[]) => players.map((p) => p.uid);
const names = (players: PlayerInfo[]) => players.map((p) => p.name);

function seat(i: number): PlayerInfo {
  return {
    uid: `p${i}`,
    name: `P${i}`,
    emoji: '🍺',
    isHost: i === 0,
    connected: true,
    local: false,
    drinkCount: i,
    score: 0,
    joinedAt: i,
    ready: true,
  };
}

/** A room snapshot, exactly as the clients see it. */
class Room {
  players: Record<string, PlayerInfo> = {};
  meta: RoomData['meta'];

  constructor(n = 3) {
    for (let i = 0; i < n; i++) this.players[`p${i}`] = seat(i);
    this.meta = {
      code: 'TEST',
      createdAt: 0,
      expiresAt: 0,
      ownerUid: 'p0',
      mode: 'party',
      phase: 'playing',
      round: 1,
      rotation: ['trivia', 'slots'],
      gameIndex: 0,
      turnOrder: Array.from({ length: n }, (_, i) => `p${i}`),
      actorUid: 'p0',
      roundUids: Array.from({ length: n }, (_, i) => `p${i}`),
      settings: {
        mode: 'party',
        pointsMode: false,
        sipMultiplier: 1,
        enabledGames: ['trivia', 'slots'],
      },
    };
  }

  get room(): RoomData {
    return { meta: this.meta, players: this.players };
  }

  /* ---- what the clients do to a seat ---- */
  /** the screen went dark / the socket dropped: away, NOT gone */
  asleep(uid: string) {
    this.players[uid].connected = false;
  }
  /** back from a locked screen: the presence heartbeat re-asserts the seat */
  awake(uid: string) {
    this.players[uid].connected = true;
    delete this.players[uid].left;
    delete this.players[uid].leftAt;
  }
  /** the page-exit handler: closed the site / tapped leave */
  closeSite(uid: string, at = 1000) {
    this.players[uid].connected = false;
    this.players[uid].left = true;
    this.players[uid].leftAt = at;
  }
  /** a new phone joins by code, mid-match */
  join(uid: string, at = 5000) {
    this.players[uid] = { ...seat(Object.keys(this.players).length), uid, joinedAt: at, ready: false };
  }
  /** the host ✕-ing a player out of the room */
  kick(uid: string) {
    delete this.players[uid];
  }
  ready(uid: string) {
    this.players[uid].ready = true;
  }

  /* ---- what the host loop does at a round boundary ---- */
  /** outcome → intro: the order follows the room, the actor must be around */
  boundary() {
    const order = turnOrderForRoom(this.room);
    const nextRound = this.meta.round + 1;
    const actor = actorFromOrder(order, livePlayers(this.room), nextRound);
    this.meta.turnOrder = order;
    this.meta.round = nextRound;
    this.meta.actorUid = actor;
    this.meta.roundUids = null; // the next round snapshots its own roster
    this.meta.phase = 'intro';
    for (const p of Object.values(this.players)) p.ready = false;
    return { order, actor };
  }
  /** intro → playing: snapshot exactly the phones that are here right now */
  launch() {
    const roster = livePlayers(this.room);
    this.meta.roundUids = uids(roster);
    this.meta.phase = 'playing';
    return roster;
  }
  /** has the ready gate been satisfied? (the host loop's own check) */
  gateOpen() {
    return notReady(this.room).length === 0;
  }
}

/* ==================================================================== */
section('a phone goes dark mid-round (must NOT be kicked)');
{
  const r = new Room(3);
  r.asleep('p1');

  check('it keeps its seat in the room', uids(activePlayers(r.room)).includes('p1'));
  check(
    'it keeps its seat in the running round',
    uids(roundPlayers(r.room)).includes('p1'),
    uids(roundPlayers(r.room)),
  );
  check('it is not listed as departed', departedPlayers(r.room).length === 0);
  check('its drinks are untouched', r.players['p1'].drinkCount === 1);
  check('the room list still shows it', names(playerList(r.room)).join() === 'P0,P1,P2');
  check('it is not counted as a live phone', !uids(livePlayers(r.room)).includes('p1'));
  check('it never holds the ready gate up', r.gateOpen());

  // the round ends and the next one is set up while it is still dark
  const { order, actor } = r.boundary();
  check('it keeps its slot in the turn order', order.join() === 'p0,p1,p2', order);
  // round 2 was scheduled for p1; the walk hands it to the next phone that is up
  check('the actor walk skips it instead of parking the round on it', actor === 'p2', actor);

  // it wakes up mid-round: right back in, same seat, same score
  r.awake('p1');
  r.launch();
  check('waking up puts it straight back in the round', uids(roundPlayers(r.room)).includes('p1'));
  check('still the same player node — score and drinks survive', r.players['p1'].drinkCount === 1);
  check('and it is live again', uids(livePlayers(r.room)).includes('p1'));
}

section('a phone that slept through a whole round is skipped, not removed');
{
  const r = new Room(3);
  r.asleep('p2');
  r.boundary();
  const roster = uids(r.launch());
  check('the round it slept through runs without it', roster.join() === 'p0,p1', roster);
  check('but it is still in the room', uids(activePlayers(r.room)).includes('p2'));
  check('and still queued in the turn order', r.meta.turnOrder?.includes('p2') === true);

  r.awake('p2');
  r.boundary();
  const next = uids(r.launch());
  check('the next round it is awake for has it back', next.includes('p2'), next);
}

/* ==================================================================== */
section('closing the site IS a departure');
{
  const r = new Room(3);
  r.closeSite('p1');

  check('the seat is out of the room', !uids(activePlayers(r.room)).includes('p1'));
  check('the room can name who walked off', names(departedPlayers(r.room)).join() === 'P1');
  check('it never blocks the ready gate', r.gateOpen());
  check('it is not a live phone', !uids(livePlayers(r.room)).includes('p1'));

  const { order, actor } = r.boundary();
  check('the turn order drops it', order.join() === 'p0,p2', order);
  check('and the next actor comes from the players who stayed', actor === 'p2', actor);

  const roster = uids(r.launch());
  check('the next round is played without it', roster.join() === 'p0,p2', roster);
}

section('...and reopening the site walks back in, mid-match');
{
  const r = new Room(3);
  r.closeSite('p1');
  r.boundary();
  r.launch(); // round 2 is running without p1

  // the phone comes back: same seat, same drinks — closing the site only handed
  // the seat back, the host never deleted the player node
  r.awake('p1');

  check('it is in the room again', uids(activePlayers(r.room)).includes('p1'));
  check('the running round is untouched by the return', uids(roundPlayers(r.room)).join() === 'p0,p2');
  check('so its phone shows "up next game"', !inCurrentRound(r.room, 'p1'));
  check('its drinks came back with it', r.players['p1'].drinkCount === 1);

  const { order } = r.boundary();
  check('the boundary puts it back in the turn order', order.join() === 'p0,p2,p1', order);
  const roster = uids(r.launch());
  check('and it plays the next game', roster.includes('p1'), roster);
}

section('a phone that walked in half-way through a match');
{
  const r = new Room(3);
  r.boundary();
  r.launch(); // round 2 running
  const before = uids(roundPlayers(r.room)).join();

  r.join('p9');
  check('the seat exists the moment they join', uids(activePlayers(r.room)).includes('p9'));
  check(
    'the running round does not change shape under the host',
    uids(roundPlayers(r.room)).join() === before,
    uids(roundPlayers(r.room)),
  );
  check('so their phone shows "up next game"', !inCurrentRound(r.room, 'p9'));
  check('they count towards the gate for the round they will play', !r.gateOpen());

  r.ready('p0');
  r.ready('p1');
  r.ready('p2');
  check('a ready table waits for their tap, not for a phone that is asleep', !r.gateOpen());
  r.ready('p9');
  check('once they tap Ready the gate opens', r.gateOpen());

  const { order } = r.boundary();
  check('the turn order appends them at the back', order.join() === 'p0,p1,p2,p9', order);
  const roster = uids(r.launch());
  check('they play the next game', roster.includes('p9'), roster);
}

section('joining during the opening ceremony');
{
  const r = new Room(2);
  r.meta.phase = 'claim';
  r.meta.round = 0;
  r.meta.turnOrder = ['p0'];

  r.join('p9');
  const pending = livePlayers(r.room).filter((p) => !(r.meta.turnOrder ?? []).includes(p.uid));
  check('the newcomer still has to claim a spot', uids(pending).join() === 'p1,p9', uids(pending));

  const order = turnOrderForRoom(r.room);
  check('and is in the order for round 1', order.join() === 'p0,p1,p9', order);
  check(
    'round 1 opens with whoever claimed spot 1',
    actorFromOrder(order, livePlayers(r.room), 1) === 'p0',
  );
  r.asleep('p0');
  check(
    'but a sleeping spot 1 hands the opening to the next awake claimer',
    actorFromOrder(order, livePlayers(r.room), 1) === 'p1',
  );
}

/* ==================================================================== */
section('the turn cycle survives sleeps, departures and arrivals');
{
  const r = new Room(3);
  r.asleep('p1');
  const { actor } = r.boundary(); // round 2 is scheduled for p1
  check('a sleeping phone is skipped, not waited for', actor === 'p2', actor);

  r.awake('p1');
  r.boundary(); // round 3
  check('when it wakes its own slot comes round again', r.meta.turnOrder?.join() === 'p0,p1,p2');
  check('and the cycle picks it back up', r.meta.actorUid === 'p2', r.meta.actorUid);
}

section('the host removing a player still sticks');
{
  const r = new Room(3);
  r.kick('p1');
  check('the room forgets them completely', !uids(playerList(r.room)).includes('p1'));
  const { order } = r.boundary();
  check('and the turn order forgets them too', order.join() === 'p0,p2', order);
  const roster = uids(r.launch());
  check('the next round is played without them', roster.join() === 'p0,p2', roster);
}

section('shared phone: local players are always around');
{
  const r = new Room(0);
  r.players['local_a'] = { ...seat(0), uid: 'local_a', name: 'Local A', local: true };
  r.players['local_b'] = { ...seat(1), uid: 'local_b', name: 'Local B', local: true };
  r.meta.mode = 'shared';
  check('locals count as live without a socket', uids(livePlayers(r.room)).length === 2);
  r.players['local_a'].connected = false; // shared rooms never set this, but just in case
  check('and stay live even with a stale connected flag', uids(livePlayers(r.room)).includes('local_a'));
  r.launch();
  check('the round rosters them', uids(roundPlayers(r.room)).length === 2);
}

/* ==================================================================== */
section('rooms from before the roster snapshot still work');
{
  const r = new Room(3);
  r.meta.roundUids = null;
  check('no snapshot → everyone in the room plays', uids(roundPlayers(r.room)).length === 3);
  check('and everyone counts as "in this round"', inCurrentRound(r.room, 'p2'));
  r.asleep('p2');
  check('a sleeping phone stays in the room-based roster', uids(roundPlayers(r.room)).includes('p2'));
}

console.log(
  failures === 0 ? '\n🍻 Seats: all checks passed' : `\n🍻 Seats: ${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
