import { useCountdown } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import type { PromptsInput, PromptsState } from './definition';

const RULE_LABEL: Record<PromptsState['rule'], string> = {
  guilty: 'Guilty drinks',
  innocent: 'Innocent drinks',
  minority: 'Odd ones out drink 2',
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

      <div className="pr-card" key={state.prompt}>
        <p className="pr-prefix">Never have I ever…</p>
        <h2 className="pr-prompt">{state.prompt.replace(/^…\s*/, '')}</h2>
      </div>

      {!revealed ? (
        <>
          <div className="pr-votes">
            <button
              className={`pr-vote pr-vote-guilty ${myInput?.vote === true ? 'pr-vote-mine' : ''}`}
              disabled={myInput != null}
              onClick={() => submitInput({ vote: true })}
            >
              I have
            </button>
            <button
              className={`pr-vote pr-vote-innocent ${myInput?.vote === false ? 'pr-vote-mine' : ''}`}
              disabled={myInput != null}
              onClick={() => submitInput({ vote: false })}
            >
              Never
            </button>
          </div>
          <div className="pr-dots" aria-hidden="true">
            {players.map((p) => (
              <span key={p.uid} className={`pr-dot ${answeredUids.includes(p.uid) ? 'pr-dot-on' : ''}`}>
                {p.emoji}
              </span>
            ))}
          </div>
          <p className="muted pr-status">
            {answeredUids.length} of {players.length} in
            {left != null ? `, ${Math.ceil(left / 1000)}s left` : ''}
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
                        {a && <span className="recap-chip-sips">{a.sips}</span>}
                      </span>
                    );
                  })}
                </span>
              </div>
            ))}
          {state.note && <p className="tr-note">{state.note}</p>}
          {(state.assignments ?? []).length > 0 && (
            <p className="muted small">Yellow names drink.</p>
          )}
        </div>
      )}
    </div>
  );
}
