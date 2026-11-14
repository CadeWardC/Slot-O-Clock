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
        <div className="gate-emoji fx-pop">{state.gaveUp ? '💀' : clean ? '🏆' : '🎓'}</div>
        <span className={`fx-stamp ${state.gaveUp ? '' : clean ? 'fx-stamp-gold' : 'fx-stamp-good'}`}>
          {state.gaveUp ? 'gave up' : clean ? 'clean!' : 'done!'}
        </span>
        <h2>{state.resultLine}</h2>
        {clean && <Confetti />}
      </div>
    );
  }

  const card = (
    <div className={`cat-card ${state.phase === 'think' ? 'cat-card-think' : ''}`}>
      <p className="fx-kicker">name {TARGET} things in…</p>
      <h2 className="fx-title cat-title">{state.category}</h2>
      <p className="cat-namer">
        {isActor && !shared ? '🎤 say them out loud' : `🎤 ${actor?.emoji ?? ''} ${actor?.name ?? 'the namer'} is up`}
      </p>
    </div>
  );

  /* ---------- the 3-second head start ---------- */
  if (state.phase === 'think') {
    const n = Math.max(1, Math.ceil((thinkLeft ?? 0) / 1000));
    return (
      <div className="gv cat">
        <span className="cat-badge">🧠 THINK…</span>
        {card}
        <BigCount n={n} hotAt={1} />
        <p className="muted">
          {isActor && !shared
            ? 'the +1 drink button is locked — use it'
            : `🔒 +1 drink unlocks in ${n}…`}
        </p>
      </div>
    );
  }

  /* ---------- naming, under fire ---------- */
  const iHoldTheButton = shared || punisher?.uid === me.uid;
  const ready = recharge <= 0;
  const pct = Math.min(100, Math.max(0, (1 - recharge / COOLDOWN_MS) * 100));
  const punish = (
    <button
      className={`cat-punish ${ready ? 'cat-punish-live' : ''}`}
      disabled={!ready}
      onClick={() => submitInput({ action: 'penalty' })}
    >
      <span className="cat-punish-fill" style={{ width: `${pct}%` }} />
      <span className="cat-punish-label">{ready ? '+1 DRINK 🍺' : `recharging… ${(recharge / 1000).toFixed(1)}s`}</span>
    </button>
  );
  const actions = (
    <div className="cat-actions">
      <button className="btn btn-gold btn-lg" onClick={() => submitInput({ action: 'done' })}>
        DONE ✅
      </button>
      <button className="btn btn-danger btn-lg" onClick={() => submitInput({ action: 'giveup' })}>
        GIVE UP (+{GIVE_UP_PENALTY}) 💀
      </button>
    </div>
  );

  return (
    <div className="gv cat">
      <span className="cat-badge cat-badge-go">🔥 GO GO GO</span>
      {card}

      <div className="cat-stack" key={pool}>
        <div className="cat-stack-beers">
          {pool === 0 ? (
            <span className="cat-stack-empty">no drinks stacked… yet</span>
          ) : (
            Array.from({ length: Math.min(pool, 12) }, (_, i) => (
              <span key={i} className={`cat-beer ${i === Math.min(pool, 12) - 1 ? 'cat-beer-new' : ''}`}>
                🍺
              </span>
            ))
          )}
        </div>
        <span className="cat-stack-n">×{pool}</span>
      </div>
      {lastHit && pool > 0 && !shared && (
        <p className="cat-hit fx-rise" key={`h${pool}`}>
          {lastHit.emoji} {lastHit.name} stacked one!
        </p>
      )}

      {shared ? (
        <>
          <p className="muted small">anyone at the table — hit it while they stall</p>
          {punish}
          {actions}
        </>
      ) : isActor ? (
        <>
          <p className="muted small">
            {ready
              ? `⚠️ ${punisher ? `${punisher.emoji} ${punisher.name} has` : 'someone has'} the +1 button — hurry`
              : `the button is recharging (${(recharge / 1000).toFixed(1)}s) — keep naming`}
          </p>
          {actions}
        </>
      ) : iHoldTheButton ? (
        <>
          <p className="cat-yours">👇 you hold the button</p>
          {punish}
        </>
      ) : (
        <div className="cat-holder">
          <span className={ready ? 'fx-wiggle cat-holder-emoji' : 'cat-holder-emoji'}>{punisher?.emoji ?? '🍺'}</span>
          <span>
            {punisher ? `${punisher.name} holds the +1 button` : 'the group is stacking drinks'}
            {ready ? ' — yell at them!' : ` · recharging ${(recharge / 1000).toFixed(1)}s`}
          </span>
        </div>
      )}
    </div>
  );
}
