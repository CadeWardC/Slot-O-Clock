import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/AppState';
import { serverNow } from '../state/serverTime';
import type { ThrownThing } from '../types';

/** What can be thrown. `kind` is what travels; the rest is how it lands. */
export const THROWABLES = [
  { kind: 'tomato', emoji: '🍅', label: 'Tomato', verb: 'threw a tomato at' },
  { kind: 'egg', emoji: '🥚', label: 'Egg', verb: 'egged' },
  { kind: 'clap', emoji: '👏', label: 'Slow clap', verb: 'slow-clapped' },
  { kind: 'rose', emoji: '🌹', label: 'Rose', verb: 'threw a rose to' },
] as const;

const byKind = new Map<string, (typeof THROWABLES)[number]>(THROWABLES.map((t) => [t.kind, t]));

/** how long a throw stays on screen, and how old one may be and still play */
const SHOW_MS = 2600;
const FRESH_MS = 5000;

interface Landed {
  id: string;
  thing: ThrownThing;
  /** where it hits, as a percentage of the screen: random per throw */
  x: number;
  y: number;
  spin: number;
}

/**
 * Throws, as they land. The phone that was aimed at gets the splat across its
 * screen; every other phone gets a one-line notice. Mounted once, above
 * everything, so it works on whatever screen the table happens to be on.
 */
export function Reactions() {
  const { room, me } = useApp();
  const [landed, setLanded] = useState<Landed[]>([]);
  const seen = useRef(new Set<string>());
  const fx = room?.social?.fx;

  useEffect(() => {
    if (!fx) return;
    const now = serverNow();
    const fresh: Landed[] = [];
    for (const [id, thing] of Object.entries(fx)) {
      if (!thing || seen.current.has(id)) continue;
      seen.current.add(id);
      if (now - (thing.at ?? 0) > FRESH_MS) continue;
      fresh.push({
        id,
        thing,
        x: 18 + Math.random() * 64,
        y: 22 + Math.random() * 46,
        spin: (Math.random() - 0.5) * 50,
      });
    }
    if (fresh.length === 0) return;
    setLanded((cur) => [...cur, ...fresh]);
    const ids = new Set(fresh.map((f) => f.id));
    const t = window.setTimeout(
      () => setLanded((cur) => cur.filter((l) => !ids.has(l.id))),
      SHOW_MS,
    );
    return () => window.clearTimeout(t);
  }, [fx]);

  if (!room || landed.length === 0) return null;
  const nameOf = (uid: string) => room.players?.[uid]?.name ?? 'Someone';

  return (
    <div className="rx" aria-live="polite">
      {landed.map((l) => {
        const t = byKind.get(l.thing.kind) ?? THROWABLES[0];
        const atMe = !!me && l.thing.to === me.uid;
        if (atMe) {
          return (
            <div key={l.id} className={`rx-hit rx-hit-${t.kind}`}>
              <span
                className="rx-splat"
                style={{ left: `${l.x}%`, top: `${l.y}%`, ['--rx-spin' as string]: `${l.spin}deg` }}
              >
                {t.emoji}
              </span>
              <p className="rx-from">
                {nameOf(l.thing.from)} {t.verb} you
              </p>
            </div>
          );
        }
        return (
          <p key={l.id} className="rx-note">
            <span>{t.emoji}</span> {nameOf(l.thing.from)} {t.verb} {nameOf(l.thing.to)}
          </p>
        );
      })}
    </div>
  );
}
