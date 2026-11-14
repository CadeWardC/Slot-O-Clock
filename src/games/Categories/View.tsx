import { useEffect, useReducer } from 'react';
import { BigCount, Confetti } from '../../components/fx';
import { useCountdown } from '../../components/ui';
import { serverNow } from '../../state/serverTime';
import type { GameViewProps } from '../../engine/types';
import { COOLDOWN_MS, GIVE_UP_PENALTY, TARGET, type CatInput, type CatState } from './definition';

/** ms until the +1 button is live again; re-renders while it recharges */
function useRecharge(nextAt: number): number {
  const [, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (serverNow() >= nextAt) return;
    const iv = window.setInterval(() => {
      tick();
      if (serverNow() >= nextAt) window.clearInterval(iv);
    }, 80);
    return () => window.clearInterval(iv);
  }, [nextAt]);
  return Math.max(0, nextAt - serverNow());
}

export function View({
  state,
  me,
  players,
  actorUid,
  isActor,
  variant,
  timerEndsAt,
  submitInput,
}: GameViewProps<CatState, CatInput>) {
  const pool = state?.pool ?? 0;
  const thinkLeft = useCountdown(state?.phase === 'think' ? timerEndsAt : null);
  const recharge = useRecharge(state?.nextAt ?? 0);
  const actor = players.find((p) => p.uid === actorUid);
  const punisher = players.find((p) => p.uid === state?.punisherUid) ?? null;
  const lastHit = players.find((p) => p.uid === state?.lastHitUid) ?? null;
  const shared = variant === 'shared';

  if (state.phase === 'done') {
    const clean = !state.gaveUp && pool === 0;
    return (
      <div className="gv cat">
        <div className="fx-paper cat-card">
          <p className="fx-kicker">{state.category}</p>
          <span className={`fx-stamp cat-stamp ${state.gaveUp ? '' : 'fx-stamp-good'}`}>
            {state.gaveUp ? 'gave up' : clean ? 'clean' : 'done'}
          </span>
          <p className="cat-result">{state.resultLine}</p>
        </div>
        {clean && <Confetti />}
      </div>
    );
  }

  const card = (
    <div className="fx-paper cat-card">
      <p className="fx-kicker">Name {TARGET}</p>
      <h2 className="cat-title">{state.category}</h2>
      <p className="cat-namer">
        {isActor && !shared ? 'Say them out loud.' : `${actor?.emoji ?? ''} ${actor?.name ?? 'The namer'} says them out loud.`}
      </p>
    </div>
  );

  /* ---------- the 3-second head start ---------- */
  if (state.phase === 'think') {
    const n = Math.max(1, Math.ceil((thinkLeft ?? 0) / 1000));
    return (
      <div className="gv cat">
        <span className="fx-tag fx-tag-ink">Think</span>
        {card}
        <div className="cat-think">
          <BigCount n={n} hotAt={1} />
          <p className="cat-sub">
            {isActor && !shared ? 'Nobody can add drinks yet.' : 'The +1 button is locked until zero.'}
          </p>
        </div>
      </div>
    );
  }

  /* ---------- naming, under fire ---------- */
  const iHoldTheButton = shared || punisher?.uid === me.uid;
  const ready = recharge <= 0;
  const pct = Math.min(100, Math.max(0, (1 - recharge / COOLDOWN_MS) * 100));
  const secs = (recharge / 1000).toFixed(1);
  const punish = (
    <button
      className={`cat-punish ${ready ? 'cat-punish-live' : ''}`}
      disabled={!ready}
      onClick={() => submitInput({ action: 'penalty' })}
    >
      <span className="cat-punish-fill" style={{ width: `${pct}%` }} />
      <span className="cat-punish-label">{ready ? '+1 drink' : `Wait ${secs}`}</span>
    </button>
  );
  const actions = (
    <div className="cat-actions">
      <button className="btn btn-gold btn-lg" onClick={() => submitInput({ action: 'done' })}>
        Done
      </button>
      <button className="btn btn-danger btn-lg" onClick={() => submitInput({ action: 'giveup' })}>
        Give up +{GIVE_UP_PENALTY}
      </button>
    </div>
  );

  return (
    <div className="gv cat">
      <span className="fx-tag fx-tag-red">Go</span>
      {card}

      <div className="cat-mat">
        <span className="cat-mat-n" key={pool}>
          {pool}
        </span>
        <div className="cat-mat-side">
          <span className="cat-mat-l">{pool === 1 ? 'drink stacked' : 'drinks stacked'}</span>
          <div className="cat-beers">
            {Array.from({ length: Math.min(pool, 12) }, (_, i) => (
              <span key={i} className={i === Math.min(pool, 12) - 1 ? 'cat-beer-new' : ''}>
                🍺
              </span>
            ))}
          </div>
          {lastHit && pool > 0 && !shared && (
            <span className="cat-hit">
              last one: {lastHit.emoji} {lastHit.name}
            </span>
          )}
        </div>
      </div>

      {shared ? (
        <>
          <p className="cat-sub">Anyone can hit it while they stall.</p>
          {punish}
          {actions}
        </>
      ) : isActor ? (
        <>
          <p className="cat-sub">
            {ready
              ? `${punisher ? `${punisher.emoji} ${punisher.name} has` : 'Someone has'} the +1 button. Hurry up.`
              : `Button is recharging, ${secs}s. Keep going.`}
          </p>
          {actions}
        </>
      ) : iHoldTheButton ? (
        <>
          <p className="cat-sub">You have the button.</p>
          {punish}
        </>
      ) : (
        <p className="cat-sub">
          {punisher ? `${punisher.emoji} ${punisher.name} has the +1 button.` : 'The table is stacking drinks.'}{' '}
          {ready ? 'Tell them to press it.' : `Recharging, ${secs}s.`}
        </p>
      )}
    </div>
  );
}
