import type { GameDefinition } from '../engine/types';

/**
 * The entire game registry. Every src/games/<Name>/definition.ts is
 * auto-discovered at build time via Vite's glob import — dropping a new
 * folder in is the only step required to add a game to the app.
 *
 * Folders starting with "_" (like _template) are skipped.
 */
const modules = import.meta.glob('./*/definition.ts', { eager: true }) as Record<
  string,
  { default: GameDefinition<any, any> }
>;

export const allGames: GameDefinition<any, any>[] = Object.entries(modules)
  .filter(([path]) => !path.includes('/_'))
  .map(([, mod]) => mod.default)
  .sort((a, b) => a.name.localeCompare(b.name));

export const gameById: ReadonlyMap<string, GameDefinition<any, any>> = new Map(
  allGames.map((g) => [g.id, g]),
);

if (import.meta.env.DEV) {
  const ids = new Set<string>();
  for (const g of allGames) {
    if (ids.has(g.id)) throw new Error(`Duplicate game id: ${g.id}`);
    ids.add(g.id);
  }
  if (allGames.length === 0) console.warn('[registry] no games found');
}
