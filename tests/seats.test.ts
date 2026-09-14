import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GATE_RECONNECT_GRACE_MS, PROTOCOL_VERSION, stageKeyOf } from '../src/state/protocol.ts';
import type { PlayerInfo, RoomMode } from '../src/engine/types.ts';
import {
  activePlayers,
  actorFromOrder,
  departedPlayers,
  gateBlockers,
  gateSatisfied,
  inCurrentRound,
  isPresent,
  livePlayers,
  playerList,
  roundPlayers,
  turnOrderForRoom,
  type EngineNode,
  type RoomData,
} from '../src/types.ts';

/**
 * ============================================================
 *  Seats, presence and gates — the pure rules
 * ============================================================
 * These are the helpers the engine and every screen share, driven over room
 * snapshots shaped exactly like the ones RTDB hands back. The behaviours that
 * changed with the protocol repair are called out in the test names: presence
 * is per connection now, the Ready gate snapshots who it needs, and a dropped
 * socket is never a yes.
 */

const NOW = 1_700_000_000_000;

function seat(i: number, extra: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    uid: `p${i}`,
    name: `P${i}`,
    emoji: '🍺',
    isHost: i === 0,
    local: false,
    connected: true,
    connections: { 'tab-1': { at: NOW } },
    drinkCount: 0,
    score: 0,
    joinedAt: i,
    ...extra,
  };
}

function engineNode(n: number, extra: Partial<EngineNode> = {}): EngineNode {
  const roundId = 'round-1';
  const phaseId = 'phase-1';
  return {
    protov: PROTOCOL_VERSION,
    lease: { uid: 'p0', instanceId: 'tab-1', generation: 1, renewedAt: NOW },
    rev: 1,
    phase: 'playing',
    round: 1,
    roundId,
    phaseId,
    stageKey: stageKeyOf(roundId, phaseId),
    rotation: ['trivia', 'slots'],
    gameIndex: 0,
    turnOrder: Array.from({ length: n }, (_, i) => `p${i}`),
    actorUid: 'p0',
    roundUids: Array.from({ length: n }, (_, i) => `p${i}`),
    forceNext: false,
    outcome: null,
    gate: null,
    ready: {},
    claims: {},
    game: null,
    awards: { scores: {}, drinks: {} },
    recovery: null,
    fault: null,
    log: [],
    ...extra,
  };
}

function makeRoom(
  players: PlayerInfo[],
  engine: Partial<EngineNode> = {},
  mode: RoomMode = 'party',
): RoomData {
  const byUid: Record<string, PlayerInfo> = {};
  for (const p of players) byUid[p.uid] = p;
  return {
    meta: {
      code: 'TEST',
      createdAt: NOW,
      expiresAt: NOW + 1000,
      ownerUid: 'p0',
      mode,
      protocol: PROTOCOL_VERSION,
      settings: {
        mode,
        pointsMode: false,
        sipMultiplier: 1,
        enabledGames: ['trivia', 'slots'],
        roundPacing: 'ready',
      },
    },
    engine: engineNode(players.length, engine),
    players: byUid,
  };
}

const uids = (list: PlayerInfo[]) => list.map((p) => p.uid);

/* ============================================================ */

test('a phone that goes dark keeps its seat, its drinks and its turn', () => {
  const room = makeRoom([
    seat(0),
    seat(1, { connections: {} }), // screen off: the connection child is gone
    seat(2),
  ]);

  assert.deepEqual(uids(activePlayers(room)), ['p0', 'p1', 'p2']);
  assert.deepEqual(uids(roundPlayers(room)), ['p0', 'p1', 'p2']);
  assert.deepEqual(uids(livePlayers(room)), ['p0', 'p2'], 'it is not a live phone');
  assert.equal(departedPlayers(room).length, 0, 'a dark screen is not a departure');
  assert.equal(isPresent(room, 'p1'), false);
  assert.deepEqual(turnOrderForRoom(room), ['p0', 'p1', 'p2'], 'its slot is kept');
  assert.equal(
    actorFromOrder(turnOrderForRoom(room), livePlayers(room), 2),
    'p2',
    'round 2 was scheduled for the sleeping phone: the walk steps over it',
  );
});

test('presence is per connection: a second tab closing is not a departure', () => {
  const room = makeRoom([
    seat(0, { connections: { 'tab-1': { at: NOW }, 'tab-2': { at: NOW } } }),
    seat(1),
  ]);
  assert.equal(isPresent(room, 'p0'), true, 'two tabs, one of them still open');

  // tab 2 closes
  room.players.p0.connections = { 'tab-1': { at: NOW } };
  assert.equal(isPresent(room, 'p0'), true, 'still here');

  // ...and so does the last one
  room.players.p0.connections = {};
  assert.equal(isPresent(room, 'p0'), false, 'now away');
  assert.deepEqual(uids(activePlayers(room)), ['p0', 'p1'], 'but still seated');
});

test('closing the site is a departure, and reopening walks back in mid-match', () => {
  const room = makeRoom([seat(0), seat(1, { connections: {}, left: true, leftAt: NOW }), seat(2)]);
  assert.deepEqual(uids(activePlayers(room)), ['p0', 'p2']);
  assert.deepEqual(uids(departedPlayers(room)), ['p1']);
  assert.equal(inCurrentRound(room, 'p1'), false);

  // the phone comes back: the seat node survived, so drinks and score do too
  room.players.p1.connections = { 'tab-1': { at: NOW + 1 } };
  delete room.players.p1.left;
  assert.deepEqual(uids(activePlayers(room)), ['p0', 'p1', 'p2']);
  assert.deepEqual(uids(roundPlayers(room)), ['p0', 'p1', 'p2'], 'the running round is its own');
  assert.equal(
    inCurrentRound(room, 'p1'),
    true,
    'it was rostered for this round, so it walks back into it',
  );
});

test('joining mid-match takes a seat without changing the running round', () => {
  const room = makeRoom([seat(0), seat(1), seat(2)]);
  const running = uids(roundPlayers(room));

  room.players.p9 = seat(9, { uid: 'p9', name: 'P9', joinedAt: NOW + 5 });
  assert.deepEqual(uids(roundPlayers(room)), running, 'the round does not change shape');
  assert.equal(inCurrentRound(room, 'p9'), false, 'their phone shows "up next game"');
  assert.deepEqual(turnOrderForRoom(room), ['p0', 'p1', 'p2', 'p9'], 'appended at the back');
});

/* ============================================================
 *  The Ready gate
 * ============================================================ */

test('the gate waits only for the phones it snapshotted when it opened', () => {
  // p2 was already dark when the gate opened, so it was never required
  const room = makeRoom([seat(0), seat(1), seat(2, { connections: {} })], {
    phase: 'outcome',
    gate: { id: 'g1', kind: 'outcome', uids: ['p0', 'p1'], openedAt: NOW },
  });

  assert.deepEqual(
    gateBlockers(room, NOW).map((b) => b.uid),
    ['p0', 'p1'],
  );
  assert.equal(gateSatisfied(room, NOW), false);

  room.engine!.ready = { p0: 'g1', p1: 'g1' };
  assert.equal(gateSatisfied(room, NOW), true);
});

test('a required phone that drops keeps holding the gate, visibly, through the grace period', () => {
  const room = makeRoom([seat(0), seat(1), seat(2)], {
    phase: 'outcome',
    gate: { id: 'g1', kind: 'outcome', uids: ['p0', 'p1', 'p2'], openedAt: NOW },
    ready: { p0: 'g1', p1: 'g1' },
  });

  // p2 blips out
  room.players.p2.connections = {};
  assert.deepEqual(gateBlockers(room, NOW + 1000), [{ uid: 'p2', state: 'reconnecting' }]);
  assert.equal(gateSatisfied(room, NOW + 1000), false, 'a dropped socket is not a yes');

  // ...and comes back before the grace runs out
  room.players.p2.connections = { 'tab-1': { at: NOW + 2000 } };
  assert.deepEqual(gateBlockers(room, NOW + 2000), [{ uid: 'p2', state: 'waiting' }]);
  assert.equal(gateSatisfied(room, NOW + 2000), false, 'it is waiting for a real tap');

  room.engine!.ready = { p0: 'g1', p1: 'g1', p2: 'g1' };
  assert.equal(gateSatisfied(room, NOW + 2000), true);
});

test('past the grace period a dark phone stops holding the table up', () => {
  const room = makeRoom([seat(0), seat(1), seat(2)], {
    phase: 'outcome',
    gate: { id: 'g1', kind: 'outcome', uids: ['p0', 'p1', 'p2'], openedAt: NOW },
    ready: { p0: 'g1', p1: 'g1' },
  });
  room.players.p2.connections = {};

  const late = NOW + GATE_RECONNECT_GRACE_MS + 1;
  assert.deepEqual(gateBlockers(room, late), [{ uid: 'p2', state: 'away' }]);
  assert.equal(gateSatisfied(room, late), true, 'the table is not held hostage');
});

test('an empty table can never release its own gate', () => {
  const room = makeRoom([seat(0), seat(1)], {
    phase: 'outcome',
    gate: { id: 'g1', kind: 'outcome', uids: ['p0', 'p1'], openedAt: NOW },
  });
  room.players.p0.connections = {};
  room.players.p1.connections = {};

  const late = NOW + GATE_RECONNECT_GRACE_MS + 1;
  assert.deepEqual(gateBlockers(room, late).map((b) => b.state), ['away', 'away']);
  assert.equal(gateSatisfied(room, late), false, 'somebody has to say so out loud');
});

test('a Ready flag from a previous gate releases nothing', () => {
  const room = makeRoom([seat(0), seat(1)], {
    phase: 'outcome',
    gate: { id: 'g2', kind: 'outcome', uids: ['p0', 'p1'], openedAt: NOW },
    ready: { p0: 'g1', p1: 'g1' }, // stale acknowledgements from the last gate
  });
  assert.equal(gateSatisfied(room, NOW), false);
  assert.equal(gateBlockers(room, NOW).length, 2);
});

test('RTDB dropping an empty node cannot invent a satisfied gate', () => {
  const room = makeRoom([seat(0)], { phase: 'outcome', gate: null });
  assert.equal(gateSatisfied(room, NOW), false, 'no gate at all');

  room.engine!.gate = { id: 'g1', kind: 'outcome', uids: [], openedAt: NOW } as never;
  assert.equal(gateSatisfied(room, NOW), false, 'a gate nobody was asked for');
});

/* ============================================================
 *  Round bookkeeping
 * ============================================================ */

test('the ledger is the score, and it survives a player list rebuild', () => {
  const room = makeRoom([seat(0), seat(1)]);
  room.engine!.awards = { drinks: { p0: 3, p1: 1 }, scores: { p0: 2 } };
  const list = playerList(room);
  assert.equal(list.find((p) => p.uid === 'p0')?.drinkCount, 3);
  assert.equal(list.find((p) => p.uid === 'p1')?.drinkCount, 1);
  assert.equal(list.find((p) => p.uid === 'p0')?.score, 2);
});

test('shared-phone locals are always around', () => {
  const room = makeRoom(
    [seat(0, { local: true, connections: {} }), seat(1, { local: true })],
    {},
    'shared',
  );
  assert.deepEqual(uids(livePlayers(room)), ['p0', 'p1']);
  assert.equal(isPresent(room, 'p0'), true, 'a local seat has no socket to lose');
});

test('a round with no roster snapshot falls back to every seat', () => {
  const room = makeRoom([seat(0), seat(1), seat(2)], { roundUids: null as never });
  assert.deepEqual(uids(roundPlayers(room)), ['p0', 'p1', 'p2']);
  assert.equal(inCurrentRound(room, 'p2'), true);
  assert.equal(
    actorFromOrder(turnOrderForRoom(room), livePlayers(room), 1),
    'p0',
    'round 1 opens with the first claimed slot',
  );
});
