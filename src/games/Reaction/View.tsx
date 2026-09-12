import { useEffect, useRef, useState } from 'react';
import type { GameViewProps } from '../../engine/types';
import { serverNow } from '../../state/serverTime';
import type { RxInput, RxState } from './definition';

function fmt(ms: number | null): string {
  return ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`;
}

export function View({ state, me, players, variant, myInput, submitInput }: GameViewProps<RxState, RxInput>) {
  const submitted = myInput != null;
  const done = state.phase === 'done';

  /**
   * This phone's own stopwatch. Everything is scored on green → tap as
   * measured *here*: the host publishes the instant green lights up (server
   * clock), we wait for that instant locally, and the count starts on the
   * frame green actually renders on this device. A slow connection can delay
   * when you learn about green — it can never pad or shrink your time.
   */
  const [partyGreen, setPartyGreen] = useState<number | null>(null);
  useEffect(() => {
    setPartyGreen(null);
    if (variant !== 'party' || done || state.goAt == null) return;
    let raf = 0;
    // timestamp on the frame green becomes visible, not on the timer's
    // best-effort wake-up
    const arm = () => {
      raf = requestAnimationFrame(() => setPartyGreen(performance.now()));
    };
    const t = window.setTimeout(arm, Math.max(0, state.goAt - serverNow()));
    return () => {
      window.clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [variant, done, state.goAt]);

  /* shared-phone mode: no shared clock, each holder gets a private green */
  const [localGo, setLocalGo] = useState<number | null>(null);
  useEffect(() => {
    if (variant !== 'shared' || done) return;
    setLocalGo(null);
    const t = window.setTimeout(() => setLocalGo(performance.now()), 1500 + Math.random() * 3000);
    return () => window.clearTimeout(t);
  }, [variant, me.uid, done]);

  const greenAt = variant === 'shared' ? localGo : partyGreen;
  const isGreen = greenAt != null && !done;

  const tap = () => {
    if (submitted || done) return;
    // no green yet on this device = jumped the gun
    if (greenAt == null) submitInput({ early: true });
    else submitInput({ reactionMs: Math.round(performance.now() - greenAt) });
  };

  // haptic-ish feedback on state change (ignored where unsupported)
  const buzzed = useRef(false);
  useEffect(() => {
    if (isGreen && !buzzed.current) {
      buzzed.current = true;
      navigator.vibrate?.(80);
    }
  }, [isGreen]);

  return (
    <div className="gv">
      {!done ? (
        <>
          <h2>{isGreen ? 'TAP!' : 'Wait for green…'}</h2>
          <button
            className={`rx-circle ${isGreen ? 'rx-green' : 'rx-red'} ${submitted ? 'rx-done' : ''}`}
            onClick={tap}
            aria-label="tap target"
          >
            <span className="rx-circle-text">
              {submitted ? '✔' : isGreen ? 'TAP!' : 'WAIT'}
            </span>
          </button>
          {submitted && <p className="muted">Locked in — waiting for the others…</p>}
          <p className="muted small">⏱ timed on your own phone — lag can't slow you down</p>
          {variant === 'party' && (
            <p className="muted small">
              {Object.keys(state.taps ?? {}).length}/{players.length} tapped
            </p>
          )}
        </>
      ) : (
        <>
          <h2>⚡ Results</h2>
          <div className="rx-results">
            {players.map((p) => {
              const t = (state.taps ?? {})[p.uid];
              const worst = state.assignments.some((a) => a.uid === p.uid);
              return (
                <div key={p.uid} className={`rx-row ${worst ? 'rx-row-bad' : ''}`}>
                  <span>{p.emoji} {p.name}</span>
                  <span>{t?.early ? '🚨 early!' : fmt(t?.ms ?? null)}</span>
                </div>
              );
            })}
          </div>
          {state.note && <p className="rx-note">{state.note}</p>}
        </>
      )}
    </div>
  );
}
