import { useEffect, useState } from 'react';

/**
 * Launch intro: the sober → drunk slider.
 *
 * The thumb starts on SOBER (green), races to DRUNK (red), wobbles with a
 * decaying bounce and dies right on the slim blue band in the middle — the
 * slot. Timings here must stay in step with the `siSettle` / `siSlotLock`
 * keyframes in styles.css.
 */
const SETTLE_MS = 2300;
/** beat spent sitting in the slot before the overlay fades */
const HOLD_MS = 500;
const FADE_MS = 400;
/** prefers-reduced-motion: show it parked on the slot, then get out of the way */
const REDUCED_MS = 800;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function SlotIntro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const hold = reduced ? REDUCED_MS : SETTLE_MS + HOLD_MS;
    const t = window.setTimeout(() => setLeaving(true), hold);
    return () => window.clearTimeout(t);
  }, [reduced]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(onDone, FADE_MS);
    return () => window.clearTimeout(t);
  }, [leaving, onDone]);

  return (
    <div
      className={`si-overlay ${leaving ? 'si-overlay-leaving' : ''}`}
      onClick={() => setLeaving(true)}
    >
      <div className="logo-block si-logo">
        <div className="logo-emoji">🎰</div>
        <h1 className="logo-title">Slot-O-Clock</h1>
        <p className="logo-tag">drinking minigames · one room · everyone's phone</p>
      </div>

      <div className="si-slider">
        <div className="si-rail">
          <div className="si-lane">
            <span className="si-slot" aria-hidden="true" />
            <span className="si-thumb" aria-hidden="true" />
          </div>
        </div>
        <div className="si-ends">
          <span className="si-sober">SOBER</span>
          <span className="si-drunk">DRUNK</span>
        </div>
      </div>

      <p className="si-hint">{leaving ? '🍻' : 'tap to skip'}</p>
    </div>
  );
}
