#!/usr/bin/env node
/**
 * Scaffold a new game plugin: copies src/games/_template and fills in
 * the id/name placeholders.
 *
 *   npm run new-game -- "Beer Pong Roulette"
 *   →   src/games/BeerPongRoulette/   (id: "beer-pong-roulette")
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gamesDir = join(root, 'src', 'games');

const rawName = process.argv[2];
if (!rawName) {
  console.error('Usage: npm run new-game -- "My Game Name"');
  process.exit(1);
}

const words = rawName
  .replace(/[^\p{L}\p{N} ]/gu, '')
  .split(/\s+/)
  .filter(Boolean)
  .map((w) => w.toLowerCase());

if (words.length === 0) {
  console.error('Pick a name with at least one letter or number.');
  process.exit(1);
}

const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const kebab = words.join('-');
const displayName = words
  .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
  .join(' ');

const target = join(gamesDir, pascal);
if (existsSync(target)) {
  console.error(`Already exists: src/games/${pascal}`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
for (const file of ['definition.ts', 'View.tsx']) {
  const src = readFileSync(join(gamesDir, '_template', file), 'utf8');
  const out = src
    .replaceAll('__GAME_ID__', kebab)
    .replaceAll('__GAME_NAME__', displayName);
  writeFileSync(join(target, file), out);
}
// fix relative import path depth is identical (same level) — nothing to do.

console.log(`✅ Created src/games/${pascal}/ (definition.ts, View.tsx)`);
console.log(`   id:   "${kebab}"`);
console.log(`   name: "${displayName}"`);
console.log(`\nIt's already live — restart the dev server and it appears in the lobby.`);
