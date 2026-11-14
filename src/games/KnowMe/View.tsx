import { TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import {
  ANSWER_MS,
  REVEAL_MS,
  ROUNDS,
  SHARED_ANSWER_MS_EACH,
  type KmInput,
  type KmState,
} from './definition';

const LETTERS = ['A', 'B'] as const;

export function View({
  state,
  me,
  players,
  myInput,
  timerEndsAt,
  submitInput,
  variant,
}: GameViewProps<KmState, KmInput>) {
  const left = useCountdown(timerEndsAt);
  const questions = state.questions ?? [];
  const total = questions.length || ROUNDS;
  const idx = state.idx ?? 0;
  const q = questions[idx];
  const picks = state.picks ?? {};
  const scores = state.scores ?? {};
  const seat = players.find((p) => p.uid === state.seatUid);
  const seatName = seat?.name ?? 'Someone';
  const iAmSeat = me.uid === state.seatUid;
  const predictors = players.filter((p) => p.uid !== state.seatUid);
  const shared = variant === 'shared';

  if (!q) return <div className="gv km" />;

  const head = (
    <div className="km-head">
      <span className={`fx-tag ${iAmSeat && !shared ? 'fx-tag-red' : ''}`}>
        {iAmSeat ? 'Hot seat' : `About ${seatName}`}
      </span>
      <span className="km-count">
        {idx + 1} of {total}
      </span>
    </div>
  );

  /* ---------- the answer turned over ---------- */
  if (state.phase === 'reveal' && state.reveal) {
    const r = state.reveal;
    const right = r.right ?? [];
    const silent = r.silent ?? [];
    const nobody = predictors.length > 0 && right.length === 0;
    const iCalledIt = right.includes(me.uid);
    return (
      <div className="gv km">
        {head}
        <div key={`r${idx}`} className="fx-paper km-card fx-pop">
          <p className="km-who">{seatName}</p>
          <h2 className="km-stem">{q.q}</h2>
          <div className="km-opts">
            {[q.a, q.b].map((text, i) => (
              <div key={i} className={`km-opt km-opt-shown ${r.truth === i ? 'km-true' : 'km-false'}`}>
                <span className="km-letter">{LETTERS[i]}</span>
                <span className="km-opt-text">{text}</span>
              </div>
            ))}
          </div>
          {!shared && !iAmSeat && (
            <span className={`fx-stamp km-stamp ${iCalledIt ? 'fx-stamp-good' : ''}`}>
              {iCalledIt ? 'Called it' : 'Wrong'}
            </span>
          )}
        </div>

        {r.froze && <p className="km-line">They froze. The app picked.</p>}
        {nobody ? (
          <p className="km-line km-line-loud">Nobody saw that coming. {seatName} drinks 1.</p>
        ) : (
          <p className="km-line km-line-loud">
            {right.length} of {predictors.length} called it.
          </p>
        )}

        <div className="km-board">
          {predictors.map((p) => {
            const ok = right.includes(p.uid);
            const n = scores[p.uid] ?? 0;
            return (
              <div key={p.uid} className={`km-row ${p.uid === me.uid && !shared ? 'km-row-me' : ''}`}>
                <span className="km-row-who">
                  {p.emoji} {p.name}
                </span>
                <span className={`km-verdict ${ok ? 'km-verdict-ok' : ''}`}>
                  {ok ? 'called it' : silent.includes(p.uid) ? 'no answer' : 'wrong'}
                </span>
                <span className="km-ticks" aria-hidden="true">
                  {Array.from({ length: total }, (_, i) => (
                    <i key={i} className={i < n ? 'on' : ''} />
                  ))}
                </span>
              </div>
            );
          })}
        </div>

        <p className="km-quiet">Ask them why.</p>
        <TimerBar deadline={timerEndsAt} totalMs={REVEAL_MS} />
      </div>
    );
  }

  /* ---------- everyone picks, in private ---------- */
  // only ever my own pick: nobody else's is drawn before the reveal
  const mine = picks[me.uid] ?? myInput?.pick ?? null;
  const locked = mine === 0 || mine === 1;
  const inCount = players.filter((p) => picks[p.uid] === 0 || picks[p.uid] === 1).length;
  const secs = left != null ? Math.ceil(left / 1000) : null;

  return (
    <div className="gv km">
      {head}
      <div key={`q${idx}`} className={`fx-paper km-card fx-pop ${iAmSeat ? 'km-card-seat' : ''}`}>
        <p className="km-who">{iAmSeat ? 'You' : seatName}</p>
        <h2 className="km-stem">{q.q}</h2>
        <div className="km-opts">
          {[q.a, q.b].map((text, i) => (
            <button
              key={i}
              className={`km-opt ${mine === i ? 'km-mine' : ''} ${locked && mine !== i ? 'km-dim' : ''}`}
              disabled={locked}
              onClick={() => submitInput({ pick: i as 0 | 1 })}
            >
              <span className="km-letter">{LETTERS[i]}</span>
              <span className="km-opt-text">{text}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="km-line km-line-loud">
        {locked
          ? iAmSeat
            ? 'Locked. They are guessing you now.'
            : 'Locked. No changing it.'
          : iAmSeat
            ? 'Answer for real. They are guessing what you will say.'
            : `What will ${seatName} say?`}
      </p>

      <div className="km-in">
        {players.map((p) => {
          const done = picks[p.uid] === 0 || picks[p.uid] === 1;
          return (
            <span key={p.uid} className={`km-chip ${done ? 'km-chip-in' : ''}`}>
              {p.emoji} {p.name}
            </span>
          );
        })}
      </div>
      <p className="km-quiet">
        {inCount} of {players.length} in{secs != null ? `, ${secs}s left` : ''}
      </p>
      <TimerBar
        deadline={timerEndsAt}
        totalMs={shared ? SHARED_ANSWER_MS_EACH * Math.max(1, players.length) : ANSWER_MS}
      />
    </div>
  );
}
