/**
 * Throwaway harness shim: the bundle runs in a browser with no `process`, but
 * React reads `process.env.NODE_ENV` while it initialises. This module is
 * imported FIRST so it runs before React. Deleted with the harness.
 */
const g = globalThis as unknown as { process?: { env: Record<string, string> } };
g.process ??= { env: {} };
g.process.env.NODE_ENV ??= 'production';
