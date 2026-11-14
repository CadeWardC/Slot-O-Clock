import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Harness } from './harness.ts';
import sketchy, {
  DRAW_MS,
  MAX_POINTS,
  MAX_STROKES,
  PICK_MS,
  REVEAL_MS,
  matches,
  validStroke,
} from '../src/games/Sketchy/definition.ts';

/**
 * Sketchy through the real engine: one artist, the rest guessing. The store is
 * the only thing asserted against, as in the other game tests.
 */
async function started(players = ['host', 'p2', 'p3', 'p4']) {
  const h = new Harness({ game: sketchy, players });
  h.start();
  await h.settle();
  await h.startGame();
  assert.equal(h.phase, 'playing');
  assert.equal(h.state.phase, 'pick');
  const artist = h.engine.actorUid as string;
  const others = players.filter((u) => u !== artist);
  return { h, artist, others };
}

async function drawing(players?: string[]) {
  const t = await started(players);
  await t.h.submit(t.artist, { action: 'pick', index: 1 });
  assert.equal(t.h.state.phase, 'draw');
  return { ...t, word: t.h.state.word as string };
}

const STROKE = '10102020';

test('Sketchy: the pick has its own clock and falls back to the first word', async () => {
  const { h } = await started();
  assert.equal(h.timer?.durationMs, PICK_MS);
  const first = h.state.options[0];
  assert.equal(new Set(h.state.options).size, 3, 'three different words on offer');
  h.clock.advance(PICK_MS + 1);
  await h.settle();
  assert.equal(h.state.phase, 'draw');
  assert.equal(h.state.word, first);
  assert.equal(h.timer?.durationMs, DRAW_MS);
});

test('Sketchy: only the artist picks and only the artist draws', async () => {
  const { h, artist, others } = await started();
  await h.submit(others[0], { action: 'pick', index: 2 });
  assert.equal(h.state.phase, 'pick', 'a guesser cannot choose the word');
  await h.submit(artist, { action: 'pick', index: 2 });
  assert.equal(h.state.word, h.state.options[2]);

  await h.submit(others[0], { action: 'stroke', pts: STROKE });
  assert.equal((h.state.strokes ?? []).length, 0, 'a guesser cannot draw');
  await h.submit(artist, { action: 'stroke', pts: STROKE });
  await h.submit(artist, { action: 'stroke', pts: 'a0a0b0b0' });
  assert.deepEqual(h.state.strokes, [STROKE, 'a0a0b0b0']);

  await h.submit(others[0], { action: 'undo' });
  await h.submit(others[0], { action: 'clear' });
  assert.equal(h.state.strokes.length, 2, 'nor rub it out');
  await h.submit(artist, { action: 'undo' });
  assert.deepEqual(h.state.strokes, [STROKE]);
  await h.submit(artist, { action: 'clear' });
  assert.equal((h.state.strokes ?? []).length, 0);
});

test('Sketchy: malformed and oversized strokes are refused, and the pad has a cap', async () => {
  assert.ok(validStroke('0a0b'));
  assert.ok(validStroke('ab'.repeat(MAX_POINTS * 2)));
  for (const bad of ['', 'abc', 'zzzz', 'ABCD', 'ab'.repeat(MAX_POINTS * 2 + 2), 12, null, { pts: 1 }]) {
    assert.equal(validStroke(bad), false, `rejects ${JSON.stringify(bad)}`);
  }

  const { h, artist } = await drawing();
  for (const bad of ['abc', 'nope', 'ab'.repeat(MAX_POINTS * 2 + 2), 7]) {
    await h.submit(artist, { action: 'stroke', pts: bad });
  }
  assert.equal((h.state.strokes ?? []).length, 0);

  for (let i = 0; i < MAX_STROKES + 3; i++) await h.submit(artist, { action: 'stroke', pts: STROKE });
  assert.equal(h.state.strokes.length, MAX_STROKES, 'the cap holds');
});

test('Sketchy: guesses are normalised', () => {
  assert.ok(matches('Hot Dog', 'hot dog'));
  assert.ok(matches(' hot-dog! ', 'hot dog'));
  assert.ok(matches('HOTDOGS', 'hot dog'));
  assert.ok(matches('glass', 'glasses') === false);
  assert.ok(matches('sunglasse', 'sunglasses'));
  assert.ok(matches('cats', 'cat'));
  assert.ok(matches('cat', 'cats'));
  assert.equal(matches('car', 'cat'), false);
  assert.equal(matches('', 'cat'), false);
  assert.equal(matches('!!!', 'cat'), false);
  assert.ok(matches('bus', 'bus'), 'a word that just ends in s still matches itself');
});

test('Sketchy: wrong guesses go in the feed, right ones never echo the word', async () => {
  const { h, artist, others, word } = await drawing();

  await h.submit(artist, { action: 'guess', text: word });
  assert.equal((h.state.got ?? []).length, 0, 'the artist cannot guess their own word');

  await h.submit(others[0], { action: 'guess', text: 'definitely not it' });
  assert.equal(h.state.feed.length, 1);
  assert.equal(h.state.feed[0].t, 'definitely not it');
  assert.equal(h.state.feed[0].u, others[0]);

  await h.submit(others[0], { action: 'guess', text: `  ${word.toUpperCase()}!` });
  assert.deepEqual(h.state.got, [others[0]]);
  const line = h.state.feed[h.state.feed.length - 1];
  assert.equal(line.ok, true);
  assert.equal(line.t, '', 'the right answer is not written into the feed');
  assert.equal(h.engine.awards.scores[others[0]], 1, 'first to get it scores');

  // once you have it you are done guessing
  await h.submit(others[0], { action: 'guess', text: 'chatter' });
  assert.equal(h.state.feed.length, 2);

  for (let i = 0; i < 10; i++) await h.submit(others[1], { action: 'guess', text: `wrong ${i}` });
  assert.equal(h.state.feed.length, 6, 'the feed stays short');
  await h.submit(others[1], { action: 'guess', text: 'x'.repeat(200) });
  assert.ok(h.state.feed[5].t.length <= 24, 'a long guess is cut');
  assert.equal(h.state.phase, 'draw');
});

test('Sketchy: the round ends early once everyone has it, and nobody drinks', async () => {
  const { h, others, word } = await drawing();
  const drawTimer = h.timer!;
  for (const uid of others) await h.submit(uid, { action: 'guess', text: word });
  assert.equal(h.state.phase, 'reveal');
  assert.notEqual(h.timer?.id, drawTimer.id);
  assert.equal(h.timer?.durationMs, REVEAL_MS);
  assert.equal((h.state.assignments ?? []).length, 0);
  assert.equal(h.engine.awards.scores[others[0]], 1);
  assert.equal(h.engine.awards.scores[others[1]] ?? 0, 0, 'only the first guesser scores');

  h.clock.advance(REVEAL_MS + 1);
  await h.settle();
  assert.equal(h.phase, 'outcome');
  assert.deepEqual(h.mixedSnapshots(), []);
});

test('Sketchy: whoever misses it drinks 1', async () => {
  const { h, artist, others, word } = await drawing();
  await h.submit(others[1], { action: 'guess', text: word });
  h.clock.advance(DRAW_MS + 1);
  await h.settle();
  assert.equal(h.state.phase, 'reveal');
  const drinks = h.state.assignments as { uid: string; sips: number }[];
  assert.deepEqual(
    drinks.map((a) => [a.uid, a.sips]).sort(),
    others.filter((u) => u !== others[1]).map((u) => [u, 1]).sort(),
  );
  assert.ok(!drinks.some((a) => a.uid === artist));

  h.clock.advance(REVEAL_MS + 1);
  await h.settle();
  assert.equal(h.phase, 'outcome');
  const recap = h.engine.outcome?.recap;
  assert.deepEqual(recap?.groups[0].uids, [others[1]]);
  for (const u of others.filter((x) => x !== others[1])) assert.equal(h.engine.awards.drinks[u], 1);
});

test('Sketchy: nobody gets it and the artist drinks 2, alone', async () => {
  const { h, artist, others } = await drawing();
  await h.submit(others[0], { action: 'guess', text: 'no idea' });
  h.clock.advance(DRAW_MS + 1);
  await h.settle();
  assert.equal(h.state.phase, 'reveal');
  assert.deepEqual(
    (h.state.assignments as { uid: string; sips: number }[]).map((a) => [a.uid, a.sips]),
    [[artist, 2]],
  );
  h.clock.advance(REVEAL_MS + 1);
  await h.settle();
  assert.equal(h.engine.awards.drinks[artist], 2);
  for (const u of others) assert.equal(h.engine.awards.drinks[u] ?? 0, 0);
});

test('Sketchy: input from an earlier stage is refused, and late input changes nothing', async () => {
  const { h, artist, others, word } = await drawing();
  const before = JSON.stringify(h.state);
  const staleId = h.submitStale(artist, { action: 'stroke', pts: STROKE }, 'old-round', 'old-phase');
  await h.settle();
  assert.equal((h.engine.game?.inputs ?? {})[staleId], undefined);
  assert.equal(JSON.stringify(h.state), before);
  assert.ok(h.logKinds().includes('input-rejected'));

  // the reveal is on screen: drawing and guessing are over
  h.clock.advance(DRAW_MS + 1);
  await h.settle();
  assert.equal(h.state.phase, 'reveal');
  const revealed = JSON.stringify(h.state);
  await h.submit(artist, { action: 'stroke', pts: STROKE });
  await h.submit(others[0], { action: 'guess', text: word });
  await h.submit(artist, { action: 'pick', index: 0 });
  assert.equal(JSON.stringify(h.state), revealed);
});

test('Sketchy on one phone: the artist reports the verdict', async () => {
  for (const gotIt of [true, false]) {
    const h = new Harness({ game: sketchy, players: ['host', 'p2', 'p3'], mode: 'shared' });
    h.start();
    await h.settle();
    await h.startGame();
    const artist = h.engine.actorUid as string;
    await h.submit('host', { action: 'pick', index: 0 }, artist);
    assert.equal(h.state.phase, 'draw');
    await h.submit('host', { action: 'stroke', pts: STROKE }, artist);
    assert.equal(h.state.strokes.length, 1);
    await h.submit('host', { action: 'verdict', got: gotIt }, artist);
    assert.equal(h.state.phase, 'reveal');
    const drinks = (h.state.assignments ?? []) as { uid: string; sips: number }[];
    if (gotIt) assert.equal(drinks.length, 0);
    else assert.deepEqual(drinks.map((a) => [a.uid, a.sips]), [[artist, 2]]);
  }
});
