import { TimerBar, useCountdown } from '../../components/ui';
import { Confetti } from '../../components/fx';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import { FINAL_MS, QUESTION_MS, REVEAL_MS, type TriviaInput, type TriviaState } from './definition';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** running standings, best first, kept like a pub quiz score sheet */
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
      <div className="tr-board-head">
        <span>Scores</span>
        <span>out of {outOf}</span>
      </div>
      {rows.map((p) => {
        const n = scores[p.uid] ?? 0;
        return (
          <div key={p.uid} className={`tr-score ${p.uid === meUid ? 'tr-score-me' : ''}`}>
            <span className="tr-score-who">
              {p.emoji} {p.name}
            </span>
            <span className="tr-ticks" aria-hidden="true">
              {Array.from({ length: outOf }, (_, i) => (
                <i key={i} className={i < n ? 'on' : ''} />
              ))}
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

  /* ---------- final scores ---------- */
  if (state.phase === 'final') {
    const winners = state.winners ?? [];
    const losers = state.losers ?? [];
    const iWon = winners.includes(me.uid);
    return (
      <div className="gv tr">
        {iWon && variant === 'party' && <Confetti />}
        <h2 className="fx-title">Final scores</h2>
        {winners.length > 0 ? (
          <div className="fx-paper tr-deal fx-rise">
            <p className="tr-deal-line">
              {winners.map(nameOf).join(' and ')} hand{winners.length === 1 ? 's' : ''} out {state.sips}.
            </p>
            <p className="tr-deal-line tr-deal-take">
              {losers.map(nameOf).join(' and ')} drink{losers.length === 1 ? 's' : ''} {state.sips}.
            </p>
            <span className="fx-tag fx-tag-red tr-deal-tag">{'🍺'.repeat(state.sips ?? 0)}</span>
          </div>
        ) : (
          <div className="fx-paper tr-deal fx-rise">
            <p className="tr-deal-line">{state.note}</p>
          </div>
        )}
        <Scoreboard players={players} scores={scores} outOf={total} meUid={me.uid} />
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
  const iGotIt = justRight.has(me.uid);

  return (
    <div className="gv tr">
      <div key={idx} className="fx-paper tr-sheet fx-pop">
        <div className="tr-sheet-head">
          <span className="tr-qno">
            Q{idx + 1}
            <small>of {total}</small>
          </span>
          {!revealed && secs != null && (
            <span className={`tr-clock ${secs <= 3 ? 'tr-clock-hot' : ''}`}>{secs}</span>
          )}
          {revealed && variant !== 'shared' && (
            <span className={`fx-stamp tr-stamp ${iGotIt ? 'fx-stamp-good' : ''}`}>
              {iGotIt ? 'Right' : iAnswered ? 'Wrong' : 'Too slow'}
            </span>
          )}
        </div>
        <h2 className="tr-question">{q.q}</h2>

        <div className="tr-options">
          {q.a.map((opt, i) => {
            const mine = myChoice === i;
            const isCorrect = revealed && i === q.c;
            const isMyWrong = revealed && mine && i !== q.c;
            const dim = revealed && !isCorrect && !mine;
            return (
              <button
                key={`${idx}-${i}`}
                className={`tr-opt ${mine ? 'tr-mine' : ''} ${isCorrect ? 'tr-correct' : ''} ${
                  isMyWrong ? 'tr-wrong fx-shake' : ''
                } ${dim ? 'tr-dim' : ''}`}
                disabled={iAnswered || revealed}
                onClick={() => submitInput({ choice: i })}
              >
                <span className="tr-letter">{LETTERS[i]}</span>
                <span className="tr-opt-text">{opt}</span>
              </button>
            );
          })}
        </div>
      </div>

      <TimerBar
        deadline={timerEndsAt}
        totalMs={revealed ? REVEAL_MS : variant === 'shared' ? QUESTION_MS * players.length : QUESTION_MS}
      />

      {revealed ? (
        <>
          <p className="tr-status">
            {justRight.size === 0
              ? 'Nobody got it.'
              : state.fastestUid
                ? `${justRight.size} of ${players.length} got it. ${nameOf(state.fastestUid)} was first.`
                : `${justRight.size} of ${players.length} got it.`}
          </p>
          <Scoreboard players={players} scores={scores} outOf={total} justRight={justRight} meUid={me.uid} />
        </>
      ) : (
        <p className="tr-status">
          {answeredUids.length} of {players.length} answered{iAnswered ? '. Yours is in.' : '.'}
        </p>
      )}
    </div>
  );
}
