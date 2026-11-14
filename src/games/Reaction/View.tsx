import { useEffect, useRef, useState } from 'react';
import { Confetti } from '../../components/fx';
import type { GameViewProps } from '../../engine/types';
import { serverNow } from '../../state/serverTime';
import { DQ_SIPS, type RxInput, type RxState } from './definition';

const MEDALS = ['🥇', '🥈', '🥉'];

export function View({ state, me, players, variant, myInput, submitInput }: GameViewProps<RxState, RxInput>) {
  const taps = state.taps ?? {};
  const assignments = state.assignments ?? [];
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

  /** what this finger just did, shown before the host has even answered */
  const [local, setLocal] = useState<{ ms: number | null; early: boolean } | null>(null);
  useEffect(() => setLocal(null), [me.uid]);

  const mine = taps[me.uid];
  const submitted = myInput != null || local != null || mine != null;
  // the host's word is final (it can rule a tap early that this phone thought was fine)
  const dq = mine ? mine.early : local ? local.early : !!myInput?.early;
  const myMs = mine?.ms ?? local?.ms ?? myInput?.reactionMs ?? null;

  const greenAt = variant === 'shared' ? localGo : partyGreen;
  const isGreen = greenAt != null && !done;

  const tap = () => {
    if (submitted || done) return;
    // no green yet on this device = false start = disqualified
    if (greenAt == null) {
      setLocal({ ms: null, early: true });
      navigator.vibrate?.([120, 60, 120]);
      submitInput({ early: true });
    } else {
      const ms = Math.round(performance.now() - greenAt);
      setLocal({ ms, early: false });
      submitInput({ reactionMs: ms });
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

  /* ---------- results ladder ---------- */
  if (done) {
    const rows = players
      .map((p) => ({ p, t: taps[p.uid] }))
      .sort((a, b) => {
        const rank = (t: typeof a.t) => (t?.early ? 2 : t?.ms == null ? 1 : 0);
        return rank(a.t) - rank(b.t) || (a.t?.ms ?? 0) - (b.t?.ms ?? 0);
      });
    const times = rows.map((r) => (r.t && !r.t.early ? r.t.ms : null)).filter((x): x is number => x != null);
    const slowest = Math.max(1, ...times);
    const iWon = rows[0]?.p.uid === me.uid && rows[0].t?.ms != null && !rows[0].t.early;
    return (
      <div className="gv rx">
        {iWon && variant === 'party' && <Confetti emojis={['⚡', '✨', '🏆']} count={20} />}
        <p className="fx-kicker">the stopwatch says</p>
        <h2 className="fx-title fx-title-cyan">Results</h2>
        <div className="rx-ladder">
          {rows.map(({ p, t }, i) => {
            const owes = assignments.find((a) => a.uid === p.uid);
            const legit = t && !t.early && t.ms != null;
            return (
              <div
                key={p.uid}
                className={`rx-row fx-rise ${owes ? 'rx-row-bad' : ''} ${t?.early ? 'rx-row-dq' : ''} ${
                  i === 0 && legit ? 'rx-row-top' : ''
                }`}
                style={{ animationDelay: `${i * 0.12}s` }}
              >
                {legit && (
                  <span className="rx-bar" style={{ width: `${Math.max(8, ((t.ms as number) / slowest) * 100)}%` }} />
                )}
                <span className="rx-rank">{t?.early ? '🚨' : legit ? MEDALS[i] ?? `${i + 1}` : '😴'}</span>
                <span className="rx-who">
                  {p.emoji} {p.name}
                </span>
                <span className="rx-time">
                  {t?.early ? 'DQ’D' : legit ? `${Math.round(t.ms as number)} ms` : 'no tap'}
                </span>
                {owes && <span className="rx-owes">🍺×{owes.sips}</span>}
              </div>
            );
          })}
        </div>
        {state.note && <p className="rx-note">{state.note}</p>}
      </div>
    );
  }

  /* ---------- disqualified: that's it for you ---------- */
  if (dq) {
    return (
      <div className="gv rx">
        <div className="rx-pad rx-pad-dq fx-shake">
          <span className="fx-stamp">DQ’D</span>
          <p className="rx-pad-big">You tapped before green</p>
          <p className="rx-pad-sub">False start — you lose this one. Drink {DQ_SIPS} 🍺</p>
        </div>
        <p className="muted small">no second chances — waiting for the others to finish…</p>
      </div>
    );
  }

  const mood = submitted ? 'rx-pad-in' : isGreen ? 'rx-pad-go' : 'rx-pad-wait';
  return (
    <div className="gv rx">
      <button className={`rx-pad ${mood}`} onPointerDown={tap} aria-label="tap target" disabled={submitted}>
        <span className="rx-lights" aria-hidden="true">
          <i className={!isGreen && !submitted ? 'on-red' : ''} />
          <i className={!isGreen && !submitted ? 'on-red' : ''} />
          <i className={isGreen || submitted ? 'on-green' : ''} />
        </span>
        {submitted ? (
          <>
            <span className="rx-pad-ms fx-pop">{myMs != null ? Math.round(myMs) : '✔'}</span>
            <span className="rx-pad-big">{myMs != null ? 'milliseconds' : 'locked in'}</span>
            <span className="rx-pad-sub">waiting for the others…</span>
          </>
        ) : isGreen ? (
          <span className="rx-pad-huge">TAP!</span>
        ) : (
          <>
            <span className="rx-pad-huge rx-hold">WAIT…</span>
            <span className="rx-pad-sub">tap before green and you’re DQ’d</span>
          </>
        )}
      </button>
      <p className="muted small">⏱ timed on your own phone — lag can’t slow you down</p>
      {variant === 'party' && (
        <div className="rx-table">
          {players.map((p) => {
            const t = taps[p.uid];
            return (
              <span key={p.uid} className={`rx-seat ${t ? (t.early ? 'rx-seat-dq' : 'rx-seat-in') : ''}`}>
                {p.emoji} {t ? (t.early ? 'DQ’d 🚨' : '✔') : '…'}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
