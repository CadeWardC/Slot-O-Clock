import { useMemo } from 'react';

const PAPER = ['#f6b92b', '#ff5a45', '#f7efdc', '#ff7fa8', '#7be0a0'];

/**
 * A one-shot shower of cut paper (or emoji) over the whole screen. Mount it when something
 * worth celebrating (or mourning) happens; it plays once and stays out of the
 * way of taps. Purely decorative, so the layout is random per mount — nothing
 * about the game depends on it.
 */
export function Confetti({
  emojis,
  count = 30,
}: {
  /** pass emoji for a themed shower; leave out for plain cut paper */
  emojis?: string[];
  count?: number;
}) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        emoji: emojis ? emojis[i % emojis.length] : null,
        color: PAPER[i % PAPER.length],
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        dur: 1.6 + Math.random() * 1.6,
        drift: `${(Math.random() - 0.5) * 30}vw`,
        spin: `${(Math.random() - 0.5) * 1080}deg`,
        size: 1.1 + Math.random() * 1.1,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [count, (emojis ?? []).join('')],
  );
  return (
    <div className="fx-confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          className={`fx-confetti-bit ${b.emoji ? '' : 'fx-confetti-paper'}`}
          style={{
            background: b.emoji ? undefined : b.color,
            left: `${b.left}%`,
            fontSize: b.emoji ? `${b.size}rem` : undefined,
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
