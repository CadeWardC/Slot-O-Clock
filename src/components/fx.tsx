import { useMemo } from 'react';

/**
 * A one-shot shower of emoji over the whole screen. Mount it when something
 * worth celebrating (or mourning) happens; it plays once and stays out of the
 * way of taps. Purely decorative, so the layout is random per mount — nothing
 * about the game depends on it.
 */
export function Confetti({
  emojis = ['🎉', '✨', '🍻', '🎊', '⭐'],
  count = 26,
}: {
  emojis?: string[];
  count?: number;
}) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        emoji: emojis[i % emojis.length],
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        dur: 1.6 + Math.random() * 1.6,
        drift: `${(Math.random() - 0.5) * 30}vw`,
        spin: `${(Math.random() - 0.5) * 1080}deg`,
        size: 1.1 + Math.random() * 1.1,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, emojis.join('')],
  );
  return (
    <div className="fx-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          className="fx-confetti-bit"
          style={{
            left: `${b.left}%`,
            fontSize: `${b.size}rem`,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
            ['--fx-drift' as string]: b.drift,
            ['--fx-spin' as string]: b.spin,
          }}
        >
          {b.emoji}
        </span>
      ))}
    </div>
  );
}

/** The giant thumping countdown number (re-keyed so every tick lands). */
export function BigCount({ n, hotAt = 3 }: { n: number; hotAt?: number }) {
  return (
    <span key={n} className={`fx-count ${n <= hotAt ? 'fx-count-hot' : ''}`}>
      {n}
    </span>
  );
}

const BG_EMOJI = ['🍺', '🎰', '🍻', '🎲', '🍹', '⭐', '🍋', '🎉', '🥂', '🍒', '🃏', '🍸'];

/**
 * The room's wallpaper: a few party emoji drifting up behind every screen.
 * Fixed, faint and untouchable — it never competes with a game for attention.
 */
export function PartyBackdrop() {
  return (
    <div className="party-bg" aria-hidden="true">
      <span className="party-blob party-blob-a" />
      <span className="party-blob party-blob-b" />
      {BG_EMOJI.map((e, i) => (
        <span
          key={i}
          className="party-bit"
          style={{
            left: `${(i * 37 + 6) % 96}%`,
            fontSize: `${1.3 + ((i * 7) % 5) * 0.28}rem`,
            animationDuration: `${17 + ((i * 5) % 9) * 2}s`,
            animationDelay: `${-((i * 11) % 23)}s`,
          }}
        >
          {e}
        </span>
      ))}
    </div>
  );
}
