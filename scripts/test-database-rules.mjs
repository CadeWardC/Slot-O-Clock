import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeApp, deleteApp } from 'firebase/app';
import { getDatabase, connectDatabaseEmulator, ref, get, set, update, runTransaction, query as dbQuery, orderByValue, endAt, limitToFirst } from 'firebase/database';

// Only a disposable local namespace is ever used; no production credentials.
const base = 'http://127.0.0.1:9000';
const ns = 'demo-slot-o-clock-rules';
const clients = new Map();
process.on('uncaughtException', (error) => { console.error(error); process.exit(1); });
async function request(uid, path, method = 'GET', body, query = {}) {
  if (uid !== 'admin') {
    if (!clients.has(uid)) {
      const app = initializeApp({ projectId: ns, databaseURL: `https://${ns}.firebaseio.com` }, uid ?? 'unauthenticated');
      const db = getDatabase(app);
      connectDatabaseEmulator(db, '127.0.0.1', 9000, uid ? { mockUserToken: { sub: uid } } : undefined);
      clients.set(uid, { app, db });
    }
    const target = ref(clients.get(uid).db, path || undefined);
    try {
      if (method === 'PUT') await set(target, body);
      else if (method === 'PATCH') await update(target, body);
      else {
        const constraints = [];
        if (query.orderBy) constraints.push(orderByValue());
        if (query.endAt !== undefined) constraints.push(endAt(query.endAt));
        if (query.limitToFirst !== undefined) constraints.push(limitToFirst(query.limitToFirst));
        return { status: 200, body: (await get(dbQuery(target, ...constraints))).val() };
      }
      return { status: 200, body: null };
    } catch (error) {
      if (/permission.denied/i.test(String(error))) return { status: 403, body: String(error) };
      throw error;
    }
  }
  const params = new URLSearchParams({ ns, ...query });
  const headers = { 'Content-Type': 'application/json' };
  headers.Authorization = 'Bearer owner';
  const res = await fetch(`${base}/${path}.json?${params}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
let checks = 0;
async function allow(label, ...args) {
  const result = await request(...args);
  assert.equal(result.status, 200, `${label}: ${JSON.stringify(result)}`);
  checks++;
  return result.body;
}
async function deny(label, ...args) {
  const result = await request(...args);
  assert.ok([401, 403].includes(result.status), `${label}: ${JSON.stringify(result)}`);
  checks++;
}
await allow('compile rules', 'admin', '.settings/rules', 'PUT', JSON.parse(await readFile(process.env.RULES_FILE ?? 'database.rules.json', 'utf8')));
await allow('reset emulator namespace', 'admin', '', 'PUT', null);
const now = Date.now();
const player = (uid, isHost = false) => ({ uid, name: uid, emoji: '🍺', local: false, isHost, connected: true, score: 0, drinkCount: 0, joinedAt: now });
const room = {
  meta: { code: 'TEST', ownerUid: 'host', mode: 'party', protocol: 2, createdAt: now, expiresAt: now + 3600000,
    settings: { mode: 'party', pointsMode: false, sipMultiplier: 1, enabledGames: ['BoomCup'], roundPacing: 'ready' } },
  players: { host: { ...player('host', true), connections: { tab: { at: now, tab: 'tab' } } } },
  engine: { protov: 2, lease: { uid: 'host', instanceId: 'tab', generation: 1, renewedAt: now }, rev: 1, phase: 'lobby', stageKey: 'stage' },
};
const creation = { 'rooms/TEST/meta': room.meta, 'rooms/TEST/players/host': room.players.host, 'rooms/TEST/engine': room.engine, 'roomIndex/TEST': room.meta.expiresAt };
await deny('unauthenticated creation', null, '', 'PATCH', creation);
await deny('creator cannot impersonate owner', 'intruder', '', 'PATCH', creation);
await allow('atomic room creation', 'host', '', 'PATCH', creation);
await deny('unauthenticated read', null, 'rooms/TEST');
await deny('room enumeration', 'intruder', 'rooms');
await deny('index enumeration', 'intruder', 'roomIndex');
await deny('future index query', 'intruder', 'roomIndex', 'GET', undefined, { orderBy: '"$value"', endAt: now + 3600000, limitToFirst: 100 });
await deny('unbounded index query', 'intruder', 'roomIndex', 'GET', undefined, { orderBy: '"$value"', endAt: now - 1000 });
await deny('index stays private even with a bounded query', 'intruder', 'roomIndex', 'GET', undefined, { orderBy: '"$value"', endAt: now - 1000, limitToFirst: 100 });
await allow('known room read for joining', 'guest', 'rooms/TEST');
await allow('join own seat', 'guest', 'rooms/TEST/players/guest', 'PUT', player('guest'));
await allow('update own presence', 'guest', 'rooms/TEST/players/guest', 'PATCH', { connections: { phone: { at: now, tab: 'phone' } } });
await deny('write another seat', 'intruder', 'rooms/TEST/players/guest/name', 'PUT', 'hacked');
await deny('self score inflation', 'guest', 'rooms/TEST/players/guest/score', 'PUT', 999);
await deny('score inflation via parent', 'guest', 'rooms/TEST/players/guest', 'PATCH', { score: 999 });
await deny('delete score', 'guest', 'rooms/TEST/players/guest/score', 'PUT', null);
await deny('self host flag', 'guest', 'rooms/TEST/players/guest/isHost', 'PUT', true);
await deny('unknown player payload', 'guest', 'rooms/TEST/players/guest/garbage', 'PUT', 'x');
await deny('oversized name', 'guest', 'rooms/TEST/players/guest/name', 'PUT', 'x'.repeat(21));
await deny('forged join order', 'guest', 'rooms/TEST/players/guest/joinedAt', 'PUT', 1);
await deny('scalar connections payload', 'guest', 'rooms/TEST/players/guest/connections', 'PUT', 'x'.repeat(2000));
await deny('outsider settings', 'intruder', 'rooms/TEST/meta/settings/sipMultiplier', 'PUT', 2);
await allow('host settings', 'host', 'rooms/TEST/meta/settings/sipMultiplier', 'PUT', 2);
await deny('delete settings', 'host', 'rooms/TEST/meta/settings', 'PUT', null);
await deny('change owner', 'host', 'rooms/TEST/meta/ownerUid', 'PUT', 'intruder');
await deny('outsider expiry', 'intruder', 'rooms/TEST/meta/expiresAt', 'PUT', now + 7200000);
await deny('fake index entry', 'intruder', 'roomIndex/FAKE', 'PUT', now + 7200000);
await allow('host refresh expiry atomically', 'host', '', 'PATCH', { 'rooms/TEST/meta/expiresAt': now + 7200000, 'roomIndex/TEST': now + 7200000 });
await deny('overwrite live room', 'guest', 'rooms/TEST', 'PUT', room);
await deny('delete live room', 'guest', 'rooms/TEST', 'PUT', null);
await deny('steal active lease', 'guest', 'rooms/TEST/engine/lease', 'PUT', { uid: 'guest', instanceId: 'guest-tab', generation: 2, renewedAt: now });
await deny('transfer lease via engine parent', 'host', 'rooms/TEST/engine', 'PUT', { ...room.engine, lease: { uid: 'intruder', instanceId: 'evil', generation: 2, renewedAt: now } });
await deny('delete lease via parent grant', 'host', 'rooms/TEST/engine/lease', 'PUT', null);
await allow('host lease renewal', 'host', 'rooms/TEST/engine/lease/renewedAt', 'PUT', Date.now());
await allow('host engine transaction', 'host', 'rooms/TEST/engine', 'PATCH', { phase: 'playing', rev: 2, gate: { id: 'gate' } });
const transaction = await runTransaction(ref(clients.get('host').db, 'rooms/TEST/engine'), (cur) => cur ? { ...cur, rev: cur.rev + 1 } : cur);
assert.equal(transaction.committed, true, 'real whole-engine transaction succeeds');
checks++;
await allow('own ready gate', 'guest', 'rooms/TEST/engine/ready/guest', 'PUT', 'gate');
await deny('outsider ready gate', 'intruder', 'rooms/TEST/engine/ready/intruder', 'PUT', 'gate');
const input = { inputId: 'input', uid: 'guest', at: now, stageKey: 'stage', roundId: 'round', phaseId: 'phase', input: { shot: { dx: 0, dy: 0.4, ms: 120 } } };
await allow('member input', 'guest', 'rooms/TEST/engine/game/inputs/input', 'PUT', input);
await deny('duplicate input', 'guest', 'rooms/TEST/engine/game/inputs/input', 'PUT', input);
await deny('outsider input', 'intruder', 'rooms/TEST/engine/game/inputs/evil', 'PUT', { ...input, inputId: 'evil', uid: 'intruder' });
await deny('impersonated input', 'guest', 'rooms/TEST/engine/game/inputs/evil', 'PUT', { ...input, inputId: 'evil', forUid: 'host' });
await deny('stale input', 'guest', 'rooms/TEST/engine/game/inputs/evil', 'PUT', { ...input, inputId: 'evil', stageKey: 'old' });
await deny('oversized input', 'guest', 'rooms/TEST/engine/game/inputs/evil', 'PUT', { ...input, inputId: 'evil', input: { text: 'x'.repeat(1001) } });
await deny('scalar input payload', 'guest', 'rooms/TEST/engine/game/inputs/evil', 'PUT', { ...input, inputId: 'evil', input: 'x'.repeat(2000) });
await deny('nested input abuse', 'guest', 'rooms/TEST/engine/game/inputs/evil', 'PUT', { ...input, inputId: 'evil', input: { shot: { dx: 0, dy: 0, ms: 1, garbage: 'x' } } });
// What the phones actually send: the game's payload as one JSON string in
// `action` + `text` (packInput in src/types.ts). A field the whitelist does
// not know is refused — which is why a raw payload from a newer game never
// arrived — and the packed form of the very same payload goes through.
await deny('raw payload with an unlisted field', 'guest', 'rooms/TEST/engine/game/inputs/raw', 'PUT', { ...input, inputId: 'raw', input: { action: 'pick', index: 1 } });
const packed = (id, payload) => ({ ...input, inputId: id, input: { action: '#json', text: JSON.stringify(payload) } });
await allow('packed sketch stroke', 'guest', 'rooms/TEST/engine/game/inputs/pk1', 'PUT', packed('pk1', { action: 'stroke', pts: 'a0b1'.repeat(40) }));
await allow('packed hand-out', 'guest', 'rooms/TEST/engine/game/inputs/pk2', 'PUT', packed('pk2', { gift: { host: 2 } }));
await deny('packed but stale', 'guest', 'rooms/TEST/engine/game/inputs/pk3', 'PUT', { ...packed('pk3', { most: ['host'] }), stageKey: 'old' });
// A thrown thing rides in the thrower's own seat, beside their connections.
await allow('member throws a tomato from their seat', 'guest', 'rooms/TEST/players/guest/connections/fx-a', 'PUT', { at: now, tab: 'host|tomato' });
await deny('throw from somebody else\'s seat', 'guest', 'rooms/TEST/players/host/connections/fx-b', 'PUT', { at: now, tab: 'guest|tomato' });
await deny('outsider throws', 'intruder', 'rooms/TEST/players/guest/connections/fx-c', 'PUT', { at: now, tab: 'host|egg' });
await allow('thrower cleans up their throw', 'guest', 'rooms/TEST/players/guest/connections/fx-a', 'PUT', null);
// the engine acknowledges (or refuses) an input inside its whole-engine transaction
const acked = await runTransaction(ref(clients.get('host').db, 'rooms/TEST/engine'), (cur) => cur ? {
  ...cur,
  rev: cur.rev + 1,
  game: { ...cur.game, inputs: { input: { ...cur.game.inputs.input, ack: { rev: cur.rev + 1, at: now, eventId: 'ev', applied: true }, rejected: null } } },
} : cur);
assert.equal(acked.committed, true, 'engine transaction that acks an input succeeds');
checks++;
const refused = await runTransaction(ref(clients.get('host').db, 'rooms/TEST/engine'), (cur) => cur ? {
  ...cur,
  rev: cur.rev + 1,
  game: { ...cur.game, inputs: { input: { ...cur.game.inputs.input, ack: null, rejected: 'stale-phase' } } },
} : cur);
assert.equal(refused.committed, true, 'engine transaction that rejects an input succeeds');
checks++;
// the social node: the one place players write freely, and only as themselves
await allow('member throws a tomato', 'guest', 'rooms/TEST/social/fx/a', 'PUT', { from: 'guest', to: 'host', kind: 'tomato', at: now });
await deny('forged thrower', 'guest', 'rooms/TEST/social/fx/b', 'PUT', { from: 'host', to: 'guest', kind: 'tomato', at: now });
await deny('outsider throws', 'intruder', 'rooms/TEST/social/fx/c', 'PUT', { from: 'intruder', to: 'host', kind: 'tomato', at: now });
await deny('oversized throw', 'guest', 'rooms/TEST/social/fx/d', 'PUT', { from: 'guest', to: 'host', kind: 'x'.repeat(40), at: now });
await deny('rewrite a throw', 'guest', 'rooms/TEST/social/fx/a', 'PUT', { from: 'guest', to: 'guest', kind: 'egg', at: now });
await allow('thrower cleans up', 'guest', 'rooms/TEST/social/fx/a', 'PUT', null);
await allow('own next-game pick', 'guest', 'rooms/TEST/social/pick', 'PUT', { uid: 'guest', gateId: 'gate', gameId: 'slots' });
await deny('pick for someone else', 'guest', 'rooms/TEST/social/pick', 'PUT', { uid: 'host', gateId: 'gate', gameId: 'slots' });
await deny('outsider pick', 'intruder', 'rooms/TEST/social/pick', 'PUT', { uid: 'intruder', gateId: 'gate', gameId: 'slots' });
await deny('unknown social node', 'guest', 'rooms/TEST/social/other', 'PUT', true);
await allow('age lease fixture', 'admin', 'rooms/TEST/engine/lease/renewedAt', 'PUT', now - 60000);
await deny('outsider takeover', 'intruder', 'rooms/TEST/engine/lease', 'PUT', { uid: 'intruder', instanceId: 'evil', generation: 2, renewedAt: now });
await allow('member takeover after timeout', 'guest', 'rooms/TEST/engine/lease', 'PUT', { uid: 'guest', instanceId: 'guest-tab', generation: 2, renewedAt: now });
await deny('old host engine write', 'host', 'rooms/TEST/engine/rev', 'PUT', 99);
await allow('old host remains a player after takeover', 'host', 'rooms/TEST/players/host/connected', 'PUT', false);
await allow('expire room fixture', 'admin', 'rooms/TEST/meta/expiresAt', 'PUT', now - 1000);
await deny('overwrite expired room', 'intruder', 'rooms/TEST', 'PUT', room);
await deny('mutate expired room child', 'intruder', 'rooms/TEST/meta/ownerUid', 'PUT', 'intruder');
await allow('cleanup expired room', 'intruder', 'rooms/TEST', 'PUT', null);
await allow('cleanup orphan index', 'intruder', 'roomIndex/TEST', 'PUT', null);
const shared = { ...room, meta: { ...room.meta, mode: 'shared', settings: { ...room.meta.settings, mode: 'shared' } }, players: null };
await allow('shared phone creation without owner seat', 'host', '', 'PATCH', { 'rooms/TEST': shared, 'roomIndex/TEST': shared.meta.expiresAt });
await allow('shared local seat', 'host', 'rooms/TEST/players/local1', 'PUT', { ...player('local1'), local: true });
await allow('shared host starts claims', 'host', 'rooms/TEST/engine/phase', 'PUT', 'claim');
await allow('shared host claims for local seat', 'host', 'rooms/TEST/engine/claims/0', 'PUT', { uid: 'local1', at: now });
await allow('shared host starts game', 'host', 'rooms/TEST/engine', 'PATCH', { phase: 'playing', gate: { id: 'shared-gate' } });
await allow('shared host readies local seat', 'host', 'rooms/TEST/engine/ready/local1', 'PUT', 'shared-gate');
await allow('shared host input for local seat', 'host', 'rooms/TEST/engine/game/inputs/input', 'PUT', { ...input, uid: 'host', forUid: 'local1' });
await allow('host end room', 'host', 'rooms/TEST', 'PUT', null);
console.log(`Database rules: ${checks} checks passed.`);
await Promise.all([...clients.values()].map(({ app }) => deleteApp(app)));
