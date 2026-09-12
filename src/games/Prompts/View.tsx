import { useCountdown } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import type { PromptsInput, PromptsState } from './definition';

const RULE_LABEL: Record<PromptsState['rule'], string> = {
  guilty: '🙋 guilty side drinks',
  innocent: '🙅 innocent side drinks',
  minority: '🦄 minority drinks ×2',
};

export function View({
  state,
  players,
  myInput,
  answeredUids,
  timerEndsAt,
  submitInput,
}: GameViewProps<PromptsState, PromptsInput>) {
  const left = useCountdown(timerEndsAt);
  const revealed = state.phase === 'reveal';

  return (
    <div className="gv">
      <span className="pr-rule-badge">{RULE_LABEL[state.rule]}</span>

      <div className="pr-card">
        <p className="pr-prefix">Never have I ever…</p>
        <h2 className="pr-prompt">{state.prompt.replace(/^…\s*/, '')}</h2>
      </div>

      {!revealed ? (
        <>
          <div className="pr-votes">
            <button
              className="pr-vote pr-vote-guilty"
              disabled={myInput != null}
              onClick={() => submitInput({ vote: true })}
            >
              🙋 Guilty!
            </button>
            <button
              className="pr-vote pr-vote-innocent"
              disabled={myInput != null}
              onClick={() => submitInput({ vote: false })}
            >
              🙅 Not me
            </button>
          </div>
          <p className="muted">
            {myInput
              ? 'Vote locked in…'
              : `${answeredUids.length}/${players.length} voted${left != null ? ` · ${Math.ceil(left / 1000)}s` : ''}`}
          </p>
        </>
      ) : (
        <div className="pr-reveal">
          {state.recap?.title && <p className="pr-reveal-title">{state.recap.title}</p>}
          {(state.recap?.groups ?? [])
            .filter((g) => (g?.uids ?? []).length > 0)
            .map((g, i) => (
              <div key={`${g.label}-${i}`} className={`recap-group recap-${g.tone ?? 'neutral'}`}>
                <span className="recap-label">{g.label}</span>
                <span className="recap-names">
                  {g.uids.map((uid) => {
                    const p = players.find((x) => x.uid === uid);
                    if (!p) return null;
                    const a = (state.assignments ?? []).find((x) => x.uid === uid);
                    return (
                      <span key={uid} className={`recap-chip ${a ? 'recap-chip-drinks' : ''}`}>
                        {p.emoji} {p.name}
                        {a && <span className="recap-chip-sips">🍺×{a.sips}</span>}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
          {state.note && <p className="tr-note">{state.note}</p>}
          {(state.assignments ?? []).length > 0 && (
            <p className="muted small">🍺 = they drink this round</p>
          )}
        </div>
      )}
    </div>
  );
}
