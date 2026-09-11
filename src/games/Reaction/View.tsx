import { useEffect, useRef, useState } from 'react';
import type { GameViewProps } from '../../engine/types';
import { serverNow } from '../../state/serverTime';
import type { RxInput, RxState } from './definition';

function fmt(ms: number | null): string {
  return ms == null ? '—' : `${(ms / 1000).toFixed(2)}s`;
}

export function View({ state, me, players, variant, myInput, submitInput }: GameViewProps<RxState, RxInput>) {
  const submitted = myInput != null;

  /* shared-phone mode: each holder gets their own go, timed on-device */
  const [localGo, setLocalGo] = useState<number | null>(null); // performance.now of green
  useEffect(() => {
    if (variant !== 'shared' || state.phase === 'done') return;
    setLocalGo(null);
    const t = window.setTimeout(() => setLocalGo(performance.now()), 1500 + Math.random() * 3000);
    return () => window.clearTimeout(t);
  }, [variant, me.uid, state.phase === 'done']);

  const isGreen =
    state.phase === 'go' || (variant === 'shared' && localGo != null && state.phase !== 'done');
  const done = state.phase === 'done';

  const tap = () => {
    if (submitted || done) return;
    if (variant === 'shared') {
      if (localGo == null) submitInput({ early: true });
      else submitInput({ reactionMs: performance.now() - localGo });
    } else {
      if (state.phase === 'go') submitInput({ at: serverNow() });
      else submitInput({ early: true });
    }
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
