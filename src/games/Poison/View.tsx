import { useState } from 'react';
import { Button } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import { CUP_BONUS, SIPS, type PoisonInput, type PoisonState } from './definition';

/**
 * One victim, everyone else pouring. The pourer's own cup is the only cup
 * this component ever renders knowably: `poisons[me.uid]` — never anybody
 * else's entry. The reveal is the first moment the table sees them all.
 */
export function View({ state, me, players, submitInput }: GameViewProps<PoisonState, PoisonInput>) {
  const cups = state?.cups ?? players.length + CUP_BONUS;
  const poisons = state?.poisons ?? {};
  const order = state?.order ?? [];
  const turn = state?.turn ?? 0;
  const drinkerUid = state?.drinkerUid ?? '';
  const nameOf = (uid: string | null) => (uid ? (players.find((p) => p.uid === uid)?.name ?? '?') : '?');
  const cupsList = Array.from({ length: cups }, (_, c) => c);

  // A phone that picked a cup and then handed itself over must never leak
  // the selection: the choice is keyed to the turn it was made in.
  const turnKey = `${me.uid}:${state?.phase}:${turn}`;
  const [sel, setSel] = useState<{ key: string; cup: number | null }>({ key: turnKey, cup: null });
  const selected = sel.key === turnKey ? sel.cup : null;
  const select = (cup: number | null) => setSel({ key: turnKey, cup });

  // a round left running from the old pairing rules can't be rendered
  if (!drinkerUid) {
    return (
      <div className="gv">
        <div className="gate-emoji pulse">☠️</div>
        <h2>This round is from an older version</h2>
        <p className="muted">the host can skip it ⏭</p>
      </div>
    );
  }

  /* ---------- the reveal ---------- */

  if (state.phase === 'reveal') {
    const pick = state.pick ?? 0;
    const poisoned = new Set(Object.values(poisons));
    const hit = poisoned.has(pick);
    return (
      <div className="gv">
        <h2>☠️ Bottoms up</h2>
        <div className={`ps-reveal ${hit ? 'ps-hit' : 'ps-dodge'}`}>
          <p className="ps-reveal-names">
            🍷 {nameOf(drinkerUid)} drank cup {pick + 1}
          </p>
          <div className="ps-reveal-cups">
            {cupsList.map((c) => (
              <span
                key={c}
                className={`ps-mini ${poisoned.has(c) ? 'ps-mini-poison' : ''} ${c === pick ? 'ps-mini-pick' : ''}`}
              >
                {c === pick ? (poisoned.has(c) ? '💀' : '🍷') : poisoned.has(c) ? '☠️' : '🥃'}
              </span>
            ))}
          </div>
          <p className="ps-verdict">{state.note}</p>
        </div>

        <div className="ps-pairs">
          {order.map((uid) => {
            const cup = poisons[uid];
            return (
              <div key={uid} className={`ps-pair ${cup === pick ? 'ps-pair-hit' : ''}`}>
                <span>☠️ {nameOf(uid)}</span>
                <span className="ps-vs">→</span>
                <span>{cup == null ? 'never poured' : `cup ${cup + 1}`}{cup === pick ? ' 🎯' : ''}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  /* ---------- my pour ---------- */

  if (state.phase === 'pouring' && order[turn] === me.uid) {
    const leftToPour = Math.max(0, order.length - turn - 1);
    return (
      <div className="gv">
        <span className="ps-badge ps-badge-poison">☠️ YOUR POUR</span>
        <h2>Poison ONE of the {cups} cups</h2>
        <p className="muted small">
          only you see this pick — {leftToPour > 0 ? `${leftToPour} more to pour after you` : `${nameOf(drinkerUid)} drinks next`}
        </p>
        <div className="ps-cups">
          {cupsList.map((c) => (
            <button
              key={c}
              className={`ps-cup ps-cup-spike ${selected === c ? 'ps-cup-sel' : ''}`}
              onClick={() => select(selected === c ? null : c)}
            >
              <span className="ps-cup-emoji">{selected === c ? '☠️' : '🥃'}</span>
              <span className="ps-cup-num">{c + 1}</span>
            </button>
          ))}
        </div>
        <Button
          variant="gold"
          size="lg"
          full
          disabled={selected == null}
          onClick={() => submitInput({ cup: selected as number })}
        >
          {selected == null ? 'PICK A CUP' : `LOCK IN CUP ${selected + 1} 🔒`}
        </Button>
      </div>
    );
  }

  /* ---------- the victim's pick ---------- */

  if (state.phase === 'drinking' && drinkerUid === me.uid) {
    return (
      <div className="gv">
        <span className="ps-badge ps-badge-drink">🍷 YOU DRINK</span>
        <h2>{order.length} cups got poisoned — pick one to drink</h2>
        <p className="muted small">
          any of them could be spiked — {SIPS} sips if you find one 🤫
        </p>
        <div className="ps-cups">
          {cupsList.map((c) => (
            <button
              key={c}
              className={`ps-cup ps-cup-drink ${selected === c ? 'ps-cup-sel' : ''}`}
              onClick={() => select(selected === c ? null : c)}
            >
              <span className="ps-cup-emoji">🍷</span>
              <span className="ps-cup-num">{c + 1}</span>
            </button>
          ))}
        </div>
        <Button
          variant="gold"
          size="lg"
          full
          disabled={selected == null}
          onClick={() => submitInput({ cup: selected as number })}
        >
          {selected == null ? 'PICK A CUP' : `DRINK CUP ${selected + 1} 🍺`}
        </Button>
      </div>
    );
  }

  /* ---------- waiting your turn ---------- */

  const myPour = poisons[me.uid];
  const iDrink = drinkerUid === me.uid;
  const actorUid = state.phase === 'pouring' ? (order[turn] ?? null) : drinkerUid;

  return (
    <div className="gv">
      {iDrink ? (
        <span className="ps-badge ps-badge-drink">🍷 YOU'RE DRINKING</span>
      ) : myPour != null ? (
        <span className="ps-badge ps-badge-poison">☠️ POURED — CUP {myPour + 1}</span>
      ) : (
        <span className="ps-badge">☠️ POISONER</span>
      )}
      <div className="gate-emoji pulse">🤫</div>
      <h2>
        {nameOf(actorUid)} is {state.phase === 'pouring' ? 'pouring' : 'choosing a cup'}…
      </h2>
      <p className="muted">
        {iDrink
          ? `you pick from all ${cups} cups once every pour is in`
          : myPour == null
            ? "waiting your turn — and no peeking at anyone else's pick"
            : 'no peeking — every pick stays private'}
      </p>
      {myPour != null && state.phase === 'drinking' && (
        <p className="muted small">will they find cup {myPour + 1}? ☠️</p>
      )}

      <div className="ps-pairs">
        {order.map((uid, i) => {
          const done = poisons[uid] != null;
          return (
            <div key={uid} className={`ps-pair ${state.phase === 'pouring' && i === turn ? 'ps-pair-now' : ''}`}>
              <span>
                ☠️ {nameOf(uid)} {done && <span className="ps-done">✔</span>}
              </span>
              {state.phase === 'pouring' && i === turn && <span className="ps-now">pouring…</span>}
            </div>
          );
        })}
        <div className={`ps-pair ${state.phase === 'drinking' ? 'ps-pair-now' : ''}`}>
          <span>
            🍷 {nameOf(drinkerUid)} {state.pick != null && <span className="ps-done">✔</span>}
          </span>
          {state.phase === 'drinking' && <span className="ps-now">choosing…</span>}
        </div>
      </div>
    </div>
  );
}
