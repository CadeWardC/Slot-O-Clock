// ============================================================
//  Test loader — run the real source under `node --test`
// ============================================================
// The engine, the room types and the game definitions are plain TypeScript,
// and Node can run that natively (type stripping), so the failure scenarios in
// tests/ exercise the shipped code rather than a copy of it. Two things the
// browser build gets from Vite have to be supplied here:
//
//   - extensionless relative imports (`./protocol`), which bundlers resolve
//     and Node does not, and
//   - the React `View` components, which this layer never touches (the engine
//     only ever calls `createInitialState` and `reduce`). JSX is not
//     TypeScript, so `.tsx` modules are served as an inert stub.
//
// Content packs (`*.json`) are served as JS modules with a default export,
// which is how Vite hands them to the games.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.json'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      const base = dirname(fileURLToPath(context.parentURL));
      const target = resolvePath(base, specifier);
      if (!existsSync(target)) {
        for (const ext of EXTS) {
          if (existsSync(target + ext)) {
            specifier = specifier + ext;
            break;
          }
        }
      }
    }
    const res = nextResolve(specifier, context);
    if (typeof res.url === 'string' && res.url.endsWith('.tsx')) {
      return { url: 'slotoclock-stub:view', shortCircuit: true };
    }
    return res;
  },
  load(url, context, nextLoad) {
    if (url === 'slotoclock-stub:view') {
      return {
        format: 'module',
        shortCircuit: true,
        source: 'export const View = () => null; export default View;',
      };
    }
    if (url.endsWith('.json')) {
      return {
        format: 'module',
        shortCircuit: true,
        source: `export default ${readFileSync(fileURLToPath(url), 'utf8')};`,
      };
    }
    return nextLoad(url, context);
  },
});
