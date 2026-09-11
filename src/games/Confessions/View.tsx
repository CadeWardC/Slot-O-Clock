import { useState } from 'react';
import { Button, TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import {
  MAX_TEXT,
  ROUNDS_COUNT,
  VOTE_MS,
  WRITE_MS,
  type CfCard,
  type CfInput,
  type CfState,
} from './definition';

/** Anonymous while voting; every author is named once the round resolves. */
function Cards({
  cards,
  trialCardId,
  players,
  reveal,
}: {
  cards: CfCard[];
  trialCardId: string;
  players: GameViewProps<CfState, CfInput>['players'];
  reveal: boolean;
}) {
  return (
    <div className="cf-cards">
      {cards.map((card) => {
        const author = players.find((p) => p.uid === card.authorUid);
        return (
          <div key={card.id} className={`cf-card ${card.id === trialCardId ? 'cf-card-trial' : ''}`}>
            <span className="cf-card-num">
              CARD #{card.n}
              {card.id === trialCardId && <b className="cf-card-flag"> · ON TRIAL</b>}
            </span>
            <p className="cf-card-text">{card.text}</p>
            {reveal && (
              <p className="cf-card-author">
                written by {author?.emoji} {author?.name ?? '?'}
              </p>
            )}
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
  variant,
  timerEndsAt,
  submitInput,
  myInput,
}: GameViewProps<CfState, CfInput>) {
  const left = useCountdown(timerEndsAt);
  const secs = left != null ? ` · ${Math.ceil(left / 1000)}s` : '';
  const [text, setText] = useState('');

  const cards = state.cards ?? [];
  const written = state.written ?? {};
  const votes = state.votes ?? {};

  /* ---------- write it ---------- */
  if (state.phase === 'write') {
    const mine = myInput?.action === 'write' ? myInput.text : null;
    return (
      <div className="gv">
        <span className="pr-rule-badge">
          ROUND {state.roundNo}/{ROUNDS_COUNT} · 🤫 ANONYMOUS
        </span>
        <div className="cf-prompt">
          <p className="cf-prompt-q">{state.prompt}</p>
        </div>
        {mine ? (
          <>
            <div className="gate-emoji">🤫</div>
            <h2>Sealed.</h2>
            <p className="muted">
              nobody will know it was you ({Object.keys(written).length}/{players.length} in){secs}
            </p>
          </>
        ) : (
          <>
            <textarea
              className="cf-textarea"
              rows={3}
              maxLength={MAX_TEXT}
              value={text}
              placeholder="type it — no names, keep it honest…"
              onChange={(e) => setText(e.target.value)}
            />
            <p className="cf-count small muted">
              {text.length}/{MAX_TEXT}
            </p>
            <Button
              variant="gold"
              size="lg"
              full
              disabled={text.trim().length === 0}
              onClick={() => submitInput({ action: 'write', text })}
            >
              SEAL IT 🤫
            </Button>
            {variant === 'shared' && (
              <p className="muted small">🙈 cover the screen while you type</p>
            )}
          </>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={WRITE_MS} />
      </div>
    );
  }

  /* ---------- one card goes on trial ---------- */
  if (state.phase === 'trial') {
    const trial = cards.find((c) => c.id === state.trialCardId);
    const myVote = votes[me.uid];
    const voteCount = Object.keys(votes).length;

    if (!trial) {
      return (
        <div className="gv">
          <span className="pr-rule-badge">🤐 NO CONFESSIONS</span>
          <div className="gate-emoji">🤐</div>
          <h2>Nobody confessed in time…</h2>
          <p className="muted">everyone drinks anyway</p>
        </div>
      );
    }

    return (
      <div className="gv">
        <span className="pr-rule-badge">
          ROUND {state.roundNo}/{ROUNDS_COUNT} · 🤫 WHO WROTE IT?
        </span>
        <p className="cf-prompt-q">{state.prompt}</p>
        <Cards cards={cards} trialCardId={state.trialCardId} players={players} reveal={false} />
        {myVote ? (
          <p className="muted">
            🗳️ you blamed {players.find((p) => p.uid === myVote)?.name ?? '?'} — waiting (
            {voteCount}/{players.length}){secs}
          </p>
        ) : (
          <>
            <p className="cf-call">Card #{trial.n} — who wrote it?</p>
            <div className="cf-people">
              {players
                .filter((p) => p.uid !== me.uid)
                .map((p) => (
                  <button
                    key={p.uid}
                    className="cf-person"
                    onClick={() => submitInput({ action: 'vote', uid: p.uid })}
                  >
                    <span className="cf-person-emoji">{p.emoji}</span> {p.name}
                  </button>
                ))}
            </div>
            <p className="muted small">
              {voteCount}/{players.length} voted{secs}
            </p>
          </>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={VOTE_MS} />
      </div>
    );
  }

  /* ---------- reveal / done ---------- */
  const result = state.roundResult;
  const assignments = result?.assignments ?? [];
  const nameOf = (uid: string) => players.find((p) => p.uid === uid)?.name ?? '?';
  const myCard = cards.find((c) => c.authorUid === me.uid);

  return (
    <div className="gv">
      <span className="pr-rule-badge">
        ROUND {state.roundNo}/{ROUNDS_COUNT} · 🤫 REVEALED
      </span>
      <div className={`gate-emoji ${result?.caught ? '' : 'pulse'}`}>
        {result?.caught ? '🕵️' : '🤫'}
      </div>
      <h2>{result?.note}</h2>
      {myCard && <p className="muted small">yours was card #{myCard.n}</p>}
      <Cards cards={cards} trialCardId={state.trialCardId} players={players} reveal={true} />
      {assignments.length > 0 && (
        <p className="cat-pool">
          {assignments.map((a) => `🍺 ${nameOf(a.uid)} ×${a.sips}`).join(' · ')}
        </p>
      )}
      {state.phase === 'done' && (
        <p className="muted">that's the game — final tally coming up…</p>
      )}
    </div>
  );
}
