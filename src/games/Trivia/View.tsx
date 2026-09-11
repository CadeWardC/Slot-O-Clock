import { useCountdown } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import type { TriviaInput, TriviaState } from './definition';

export function View({
  state,
  players,
  myInput,
  answeredUids,
  timerEndsAt,
  submitInput,
}: GameViewProps<TriviaState, TriviaInput>) {
  const left = useCountdown(timerEndsAt);
  const revealed = state.phase === 'reveal';

  return (
    <div className="gv">
      <h2 className="tr-question">{state.q.q}</h2>

      <div className="tr-options">
        {state.q.a.map((opt, i) => {
          const mine = myInput?.choice === i;
          const isCorrect = revealed && i === state.q.c;
          const isMyWrong = revealed && mine && i !== state.q.c;
          return (
            <button
              key={i}
              className={`tr-opt ${mine ? 'tr-mine' : ''} ${isCorrect ? 'tr-correct' : ''} ${isMyWrong ? 'tr-wrong' : ''}`}
              disabled={myInput != null || revealed}
              onClick={() => submitInput({ choice: i })}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {revealed ? (
        <div className="tr-verdicts">
          {players.map((p) => {
            const ans = (state.answers ?? {})[p.uid];
            const ok = ans?.choice === state.q.c;
            return (
              <span key={p.uid} className={`tr-verdict ${ok ? 'tr-ok' : 'tr-bad'}`}>
                {p.emoji} {p.name} {ok ? '✓' : ans ? '✗' : '⏱'}
              </span>
            );
          })}
          {state.note && <p className="tr-note">{state.note}</p>}
        </div>
      ) : (
        <p className="muted">
          {answeredUids.length}/{players.length} answered
          {left != null ? ` · ${Math.ceil(left / 1000)}s` : ''}
        </p>
      )}
    </div>
  );
}
