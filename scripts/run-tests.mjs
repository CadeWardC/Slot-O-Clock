// ============================================================
//  Deterministic test entry point
// ============================================================
// `node --test tests/` spawns one child process per test file. That works
// everywhere except inside a sandbox that forbids piped stdio (spawn EPERM),
// and it buys nothing here: these tests are deterministic, in-process and
// hold no global state of their own. Importing each file runs it through
// `node:test` directly, so the same assertions, the same reporter, and the
// same non-zero exit code on failure.
//
//   npm test   →   node --import ./tests-loader.mjs scripts/run-tests.mjs
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('../tests/', import.meta.url);
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.test.ts'))
  .sort();

if (files.length === 0) {
  console.error('no test files found in tests/');
  process.exit(1);
}

for (const name of files) {
  await import(new URL(name, dir).href);
  // print the file boundary so a failure is easy to place
  process.stdout.write(`\n— ${fileURLToPath(new URL(name, dir))}\n`);
}
