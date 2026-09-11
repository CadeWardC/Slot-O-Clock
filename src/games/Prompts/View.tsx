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
        <div className="tr-verdicts">
          {players.map((p) => {
            const guilty = (state.votes ?? {})[p.uid];
            const drinking = state.assignments.some((a) => a.uid === p.uid);
            return (
              <span key={p.uid} className={`tr-verdict ${drinking ? 'tr-bad' : 'tr-ok'}`}>
                {p.emoji} {p.name} {guilty ? '🙋' : '🙅'}
              </span>
            );
          })}
          {state.note && <p className="tr-note">{state.note}</p>}
        </div>
      )}
    </div>
  );
}
