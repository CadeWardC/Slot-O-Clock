import type { GameViewProps } from '../../engine/types';
import type { CatInput, CatState } from './definition';

export function View({
  state,
  me,
  players,
  actorUid,
  isActor,
  variant,
  submitInput,
}: GameViewProps<CatState, CatInput>) {
  if (state.phase === 'done') {
    return (
      <div className="gv">
        <div className="gate-emoji">🎓</div>
        <h2>{state.resultLine}</h2>
        <p className="muted">Penalties stacked: 🍺 ×{state.pool}</p>
      </div>
    );
  }

  const punisher = players.find((p) => p.uid === state.punisherUid) ?? null;
  const iHoldTheButton = punisher?.uid === me.uid;
  const actor = players.find((p) => p.uid === actorUid);

  return (
    <div className="gv">
      <span className="pr-rule-badge">🗂️ Category</span>
      <div className="pr-card">
        <p className="pr-prefix">Name 4 things in…</p>
        <h2 className="pr-prompt">{state.category}</h2>
      </div>

      <p className="cat-pool">stacked drinks: {'🍺'.repeat(Math.min(state.pool, 8))} ×{state.pool}</p>

      {isActor ? (
        <div className="cat-actions">
          <button
            className="btn btn-gold btn-lg"
            onClick={() => submitInput({ action: 'done' })}
          >
            DONE ✅
          </button>
          <button
            className="btn btn-danger btn-lg"
            onClick={() => submitInput({ action: 'giveup' })}
          >
            GIVE UP (+2) 💀
          </button>
        </div>
      ) : variant === 'shared' ? (
        // one phone for the group: anyone may stack a penalty
        <button className="btn btn-claim cat-punish" onClick={() => submitInput({ action: 'penalty' })}>
          +1 DRINK 🍺
        </button>
      ) : iHoldTheButton ? (
        <button className="btn btn-claim cat-punish" onClick={() => submitInput({ action: 'penalty' })}>
          +1 DRINK 🍺
        </button>
      ) : (
        <p className="muted">
          {punisher
            ? `${punisher.emoji} ${punisher.name} holds the +1 drink button…`
            : 'the group is stacking drinks…'}
        </p>
      )}

      {!isActor && actor && (
        <p className="muted small">
          namer: {actor.emoji} {actor.name}
        </p>
      )}
    </div>
  );
}
