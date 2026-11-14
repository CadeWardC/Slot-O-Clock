/**
 * Offline smoke test for the Fake It Till You Make It reducer.
 *
 * Drives full games through fake rooms and checks the rules the game rests on:
 *   - the blind move is a 5-second countdown phase with no app input
 *   - the ballot has NO timer: it closes when the last player locks in, a
 *     locked ballot can't be switched, and a stray timeout can't close it
 *   - a conviction takes players − 1 votes on one player (everyone but them)
 *   - catching the faker ends the game on the spot; the faker drinks
 *   - a split ballot or a convicted innocent is a getaway: the game goes on
 *     and every clean player owes a drink for it at the end
 *   - a faker who survives every round is unmasked and drinks nothing
 *
 * Run, with the esbuild that ships with vite:
 *   node_modules/.bin/esbuild scripts/fakeit-sim.mts --bundle --platform=node \
 *     --format=cjs --jsx=automatic --loader:.css=empty '--define:import.meta.env={}' --outfile=node_modules/.tmp-fk-sim.cjs && node node_modules/.tmp-fk-sim.cjs
 * The screen contract has its own check: scripts/fakeit-view-check.tsx
 */
import {
  CAUGHT_SIPS,
  convictedUid,
  definition,
  FOOLED_SIPS,
  GESTURE_MS,
  ROUNDS_COUNT,
  votesNeeded,
  type FkInput,
  type FkState,
} from '../src/games/FakeIt/definition';
import { mulberry32 } from '../src/engine/rng';
import type { Effect, GameContext, GameEvent, PlayerInfo, RoomMode } from '../src/engine/types';

let failures = 0;
function check(cond: unknown, label: string) {
  if (!cond) failures += 1;
  console.log(`${cond ? '  ok ' : 'FAIL '} ${label}`);
}

function room(n: number, mode: RoomMode = 'party', seed = 3) {
  const players: PlayerInfo[] = Array.from({ length: n }, (_, i) => ({
    uid: `p${i}`,
    name: `P${i}`,
    emoji: '🍺',
    isHost: i === 0,
    connected: true,
    local: mode === 'shared',
    drinkCount: 0,
    score: 0,
    joinedAt: i,
  }));
  const ctx: GameContext = {
    players,
    actorUid: 'p0',
    turnOrder: players.map((p) => p.uid),
    settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: ['fakeit'] },
    rng: mulberry32(seed),
    now: 0,
    roundId: 'r',
    phaseId: 'ph',
    revision: 0,
  };
  let state: FkState = definition.createInitialState(ctx);
  let effects: Effect[] = [];
  const send = (event: GameEvent<FkInput>) => {
    const res = definition.reduce(state, event, ctx);
    state = res.state;
    effects = res.effects ?? [];
    return effects;
  };
  send({ type: 'BEGIN' });
  const uids = players.map((p) => p.uid);
  return {
    uids,
    get state() {
      return state;
    },
    get effects() {
      return effects;
    },
    send,
    input: (uid: string, input: FkInput) => send({ type: 'INPUT', uid, input }),
    timeUp: () => send({ type: 'TIME_UP', now: 0 }),
    /** brief → gesture → reveal → vote */
    toVote() {
      for (const u of uids) send({ type: 'INPUT', uid: u, input: { action: 'ready' } });
      check(state.phase === 'gesture', 'every card read → the blind move');
      check(
        effects.some((fx) => fx.type === 'TIMER' && fx.ms === GESTURE_MS) && GESTURE_MS === 5000,
        'the move is on a 5-second countdown',
      );
      send({ type: 'TIME_UP', now: 0 });
      check(state.phase === 'reveal', 'countdown over → the prompt goes public');
      for (const u of uids) send({ type: 'INPUT', uid: u, input: { action: 'ready' } });
      check(state.phase === 'vote', 'the ballot opens');
      check(!effects.some((fx) => fx.type === 'TIMER'), 'the ballot has no timer');
    },
    /** everyone names `target`; the target names someone else */
    convict(target: string) {
      const other = uids.find((u) => u !== target)!;
      for (const u of uids) send({ type: 'INPUT', uid: u, input: { action: 'vote', value: u === target ? other : target } });
    },
    /** a ring of votes: nobody gets more than one */
    split() {
      uids.forEach((u, i) => send({ type: 'INPUT', uid: u, input: { action: 'vote', value: uids[(i + 1) % uids.length] } }));
    },
  };
}

console.log('— the n−1 rule');
check(votesNeeded(5) === 4 && votesNeeded(3) === 2, 'a table of 5 needs 4, a table of 3 needs 2');
check(convictedUid({ a: 'd', b: 'd', c: 'd', d: 'a' }, ['a', 'b', 'c', 'd']) === 'd', 'everyone else named d → convicted');
check(convictedUid({ a: 'd', b: 'd', c: 'a', d: 'a' }, ['a', 'b', 'c', 'd']) === null, '2 of 3 is not enough');

console.log('— caught in round 1 ends the game');
{
  const r = room(4);
  const faker = r.state.fakerUid;
  r.toVote();
  const clean = r.uids.filter((u) => u !== faker);
  r.input(clean[0], { action: 'vote', value: faker });
  r.input(clean[0], { action: 'vote', value: clean[1] });
  check(r.state.votes[clean[0]] === faker, 'a locked ballot cannot be switched');
  r.timeUp();
  check(r.state.phase === 'vote', 'a stray timeout does not close the ballot');
  r.input(clean[1], { action: 'vote', value: faker });
  r.input(clean[2], { action: 'vote', value: faker });
  check(r.state.phase === 'vote', 'still open until the last player locks in');
  r.input(faker, { action: 'vote', value: clean[0] });
  check(r.state.phase === 'verdict' && r.state.history['1']?.result === 'caught', 'n−1 votes on the faker → CAUGHT');
  r.timeUp();
  const end = r.effects.find((fx) => fx.type === 'END');
  check(r.state.phase === 'done' && !!end, 'the game ends right there — no round 2');
  const a = end && end.type === 'END' ? (end.assignments ?? []) : [];
  check(a.length === 1 && a[0].uid === faker && a[0].sips === CAUGHT_SIPS, 'only the faker drinks');
}

console.log('— innocent convicted, then split, then caught in round 3');
{
  const r = room(5, 'party', 9);
  const faker = r.state.fakerUid;
  const innocent = r.uids.find((u) => u !== faker)!;
  r.toVote();
  r.convict(innocent);
  check(r.state.history['1']?.result === 'innocent', 'everyone else named an innocent → INNOCENT');
  r.timeUp();
  check(r.state.phase === 'brief' && r.state.roundNo === 2, 'the faker got away — round 2');
  r.toVote();
  r.split();
  check(r.state.history['2']?.result === 'split', 'a split ballot convicts nobody');
  r.timeUp();
  r.toVote();
  r.convict(faker);
  r.timeUp();
  const end = r.effects.find((fx) => fx.type === 'END');
  const a = end && end.type === 'END' ? (end.assignments ?? []) : [];
  check(a.find((x) => x.uid === faker)?.sips === CAUGHT_SIPS, 'the faker drinks for being caught');
  check(
    a.filter((x) => x.uid !== faker).length === 4 && a.every((x) => x.uid === faker || x.sips === 2 * FOOLED_SIPS),
    'everyone else drinks for the two getaways',
  );
}

console.log('— never caught');
{
  const r = room(3, 'shared', 5);
  const faker = r.state.fakerUid;
  for (let i = 0; i < ROUNDS_COUNT; i++) {
    r.toVote();
    check(definition.sharedHolderUid?.(r.state, { players: [], actorUid: null }) == null, 'holder is defensive on an empty roster');
    r.split();
    r.timeUp();
  }
  check(r.state.phase === 'unmask', 'three getaways → the unmask');
  r.timeUp();
  const end = r.effects.find((fx) => fx.type === 'END');
  const a = end && end.type === 'END' ? (end.assignments ?? []) : [];
  check(!a.some((x) => x.uid === faker), 'the faker drinks nothing');
  check(a.length === 2 && a.every((x) => x.sips === ROUNDS_COUNT * FOOLED_SIPS), 'everyone else drinks for every round');
}

console.log(failures === 0 ? '\nall good' : `\n${failures} FAILED`);
if (failures > 0) process.exit(1);
