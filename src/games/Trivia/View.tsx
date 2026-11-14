import { TimerBar, useCountdown } from '../../components/ui';
import { Confetti } from '../../components/fx';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import { FINAL_MS, QUESTION_MS, REVEAL_MS, type TriviaInput, type TriviaState } from './definition';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** running standings, best first — the bar is how many you have right */
function Scoreboard({
  players,
  scores,
  outOf,
  justRight,
  meUid,
}: {
  players: PlayerInfo[];
  scores: Record<string, number>;
  outOf: number;
  justRight?: Set<string>;
  meUid: string;
}) {
  const rows = [...players].sort((a, b) => (scores[b.uid] ?? 0) - (scores[a.uid] ?? 0));
  return (
    <div className="tr-board">
      {rows.map((p, i) => {
        const n = scores[p.uid] ?? 0;
        return (
          <div key={p.uid} className={`tr-score ${p.uid === meUid ? 'tr-score-me' : ''}`}>
            <span className="tr-score-bar" style={{ width: `${(n / Math.max(1, outOf)) * 100}%` }} />
            <span className="tr-score-rank">{i + 1}</span>
            <span className="tr-score-who">
              {p.emoji} {p.name}
            </span>
            {justRight?.has(p.uid) && <span className="tr-plus fx-pop">+1</span>}
            <span className="tr-score-n">{n}</span>
          </div>
        );
      })}
    </div>
  );
}

export function View({
  state,
  me,
  players,
  myInput,
  answeredUids,
  timerEndsAt,
  submitInput,
  variant,
}: GameViewProps<TriviaState, TriviaInput>) {
  const left = useCountdown(timerEndsAt);
  const answers = state.answers ?? {};
  const scores = state.scores ?? {};
  const total = state.questions?.length ?? 1;
  const idx = state.idx ?? 0;
  const q = state.q;
  const nameOf = (uid: string) => players.find((p) => p.uid === uid)?.name ?? '?';

  /* ---------- the podium ---------- */
  if (state.phase === 'final') {
    const winners = state.winners ?? [];
    const losers = state.losers ?? [];
    const iWon = winners.includes(me.uid);
    const iLost = losers.includes(me.uid);
    return (
      <div className="gv tr">
        {iWon && variant === 'party' && <Confetti emojis={['🧠', '🏆', '✨', '🎓']} />}
        <p className="fx-kicker">final standings</p>
        <h2 className="fx-title">Big Brain Board</h2>
        <Scoreboard players={players} scores={scores} outOf={total} meUid={me.uid} />
        {winners.length > 0 ? (
          <div className="fx-panel tr-deal fx-rise">
            <p className="tr-deal-line tr-deal-give">
              🏆 {winners.map(nameOf).join(' & ')} hand{winners.length === 1 ? 's' : ''} out
            </p>
            <p className="tr-deal-sips">{'🍺'.repeat(state.sips ?? 0)}</p>
            <p className="tr-deal-line tr-deal-take">
              {losers.map(nameOf).join(' & ')} drink{losers.length === 1 ? 's' : ''} {state.sips} 🫠
            </p>
            {variant === 'party' && (iWon || iLost) && (
              <p className="tr-deal-you">{iWon ? 'that’s you handing them out 😎' : 'that’s you. bottoms up.'}</p>
            )}
          </div>
        ) : (
          <p className="tr-note">{state.note}</p>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={FINAL_MS} />
      </div>
    );
  }

  const revealed = state.phase === 'reveal';
  const myChoice = revealed ? (answers[me.uid]?.choice ?? myInput?.choice) : myInput?.choice;
  const iAnswered = myChoice != null;
  const justRight = new Set(
    Object.entries(answers)
      .filter(([, a]) => a.choice === q.c)
      .map(([uid]) => uid),
  );
  const secs = left != null ? Math.ceil(left / 1000) : null;

  return (
    <div className="gv tr">
      <div className="tr-head">
        <span className="fx-kicker">
          question {idx + 1} of {total}
        </span>
        <span className="tr-dots" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} className={i < idx ? 'tr-dot-done' : i === idx ? 'tr-dot-now' : ''} />
          ))}
        </span>
        {!revealed && secs != null && (
          <span className={`tr-clock ${secs <= 3 ? 'tr-clock-hot' : ''}`}>{secs}</span>
        )}
      </div>
      <TimerBar deadline={timerEndsAt} totalMs={revealed ? REVEAL_MS : variant === 'shared' ? QUESTION_MS * players.length : QUESTION_MS} />

      <div key={idx} className="fx-panel tr-card fx-pop">
        <h2 className="tr-question">{q.q}</h2>
      </div>

      <div className="tr-options">
        {q.a.map((opt, i) => {
          const mine = myChoice === i;
          const isCorrect = revealed && i === q.c;
          const isMyWrong = revealed && mine && i !== q.c;
          const dim = revealed && !isCorrect && !mine;
          return (
            <button
              key={`${idx}-${i}`}
              className={`tr-opt tr-opt-${i % 4} ${mine ? 'tr-mine' : ''} ${isCorrect ? 'tr-correct' : ''} ${
                isMyWrong ? 'tr-wrong fx-shake' : ''
              } ${dim ? 'tr-dim' : ''}`}
              disabled={iAnswered || revealed}
              onClick={() => submitInput({ choice: i })}
            >
              <span className="tr-letter">{LETTERS[i]}</span>
              <span className="tr-opt-text">{opt}</span>
              {isCorrect && <span className="tr-mark">✓</span>}
              {isMyWrong && <span className="tr-mark">✗</span>}
            </button>
          );
        })}
      </div>

      {revealed ? (
        <>
          <p className={`tr-verdict fx-pop ${justRight.has(me.uid) ? 'tr-verdict-ok' : 'tr-verdict-bad'}`}>
            {variant === 'shared'
              ? justRight.size === 0
                ? 'Nobody got it 🤯'
                : `${justRight.size}/${players.length} got it`
              : justRight.has(me.uid)
                ? state.fastestUid === me.uid
                  ? '⚡ Correct — and fastest!'
                  : '✓ Correct!'
                : iAnswered
                  ? '✗ Nope'
                  : '⏱ Too slow'}
          </p>
          <Scoreboard players={players} scores={scores} outOf={total} justRight={justRight} meUid={me.uid} />
          <p className="muted small">
            {idx + 1 >= total ? 'final standings next…' : 'next question coming up…'}
          </p>
        </>
      ) : (
        <p className="muted">
          {iAnswered ? 'locked in · ' : ''}
          {answeredUids.length}/{players.length} answered
        </p>
      )}
    </div>
  );
}
