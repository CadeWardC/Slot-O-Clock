import { useEffect, useState } from 'react';
import { Button, TimerBar, useCountdown } from '../../components/ui';
import { Confetti } from '../../components/fx';
import type { GameViewProps } from '../../engine/types';
import {
  FINALE_MS,
  GIFT_SIPS,
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
      {cards.map((card, i) => {
        const author = players.find((p) => p.uid === card.authorUid);
        const trial = card.id === trialCardId;
        return (
          <div
            key={card.id}
            className={`cf-card ${trial ? 'cf-card-trial' : ''} ${reveal ? 'cf-card-open' : ''}`}
            style={{ ['--cf-tilt' as string]: `${((i % 3) - 1) * 0.9}deg`, animationDelay: `${i * 0.07}s` }}
          >
            <span className="cf-card-num">
              CARD #{card.n}
              {trial && <b className="cf-card-flag"> · ⚖️ ON TRIAL</b>}
            </span>
            <p className="cf-card-text">“{card.text}”</p>
            {reveal && (
              <p className="cf-card-author">
                ✍️ {author?.emoji} {author?.name ?? '?'}
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

  // clear the box between rounds and between holders — a leftover confession
  // must never be sitting on screen when the phone is passed on
  useEffect(() => {
    setText('');
  }, [state.roundNo, me.uid]);

  /* ---------- write it ---------- */
  if (state.phase === 'write') {
    const mine = myInput?.action === 'write' ? myInput.text : null;
    return (
      <div className="gv">
        <span className="cf-badge">
          ROUND {state.roundNo}/{ROUNDS_COUNT} · 🤫 ANONYMOUS
        </span>
        <div className="cf-prompt">
          <p className="fx-kicker">🤫 confess</p>
          <p className="cf-prompt-q">{state.prompt}</p>
        </div>
        {mine ? (
          <>
            <div className="gate-emoji fx-pop">🤐</div>
            <span className="fx-stamp fx-stamp-gold">sealed</span>
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
          <span className="cf-badge">🤐 NO CONFESSIONS</span>
          <div className="gate-emoji">🤐</div>
          <h2>Nobody confessed in time…</h2>
          <p className="muted">everyone drinks anyway</p>
        </div>
      );
    }

    return (
      <div className="gv">
        <span className="cf-badge">
          ROUND {state.roundNo}/{ROUNDS_COUNT} · 🤫 WHO WROTE IT?
        </span>
        <p className="cf-prompt-q cf-prompt-small">{state.prompt}</p>
        <Cards cards={cards} trialCardId={state.trialCardId} players={players} reveal={false} />
        {myVote ? (
          <p className="cf-voted fx-pop">
            🗳️ you blamed {players.find((p) => p.uid === myVote)?.name ?? '?'} — waiting (
            {voteCount}/{players.length}){secs}
          </p>
        ) : (
          <>
            <p className="pick-call">⚖️ Card #{trial.n} — who wrote it?</p>
            <div className="pick-people">
              {players
                .filter((p) => p.uid !== me.uid)
                .map((p) => (
                  <button
                    key={p.uid}
                    className="pick-person"
                    onClick={() => submitInput({ action: 'vote', uid: p.uid })}
                  >
                    <span className="pick-person-emoji">{p.emoji}</span> {p.name}
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

  const nameOf = (uid: string) => players.find((p) => p.uid === uid)?.name ?? '?';
  const emojiOf = (uid: string) => players.find((p) => p.uid === uid)?.emoji ?? '';

  /* ---------- the finale: who wrote what, and who stayed driest ---------- */
  if (state.phase === 'finale' || state.phase === 'done') {
    const archive = state.archive ?? [];
    const tally = state.tally ?? {};
    const winners = state.winnerUids ?? [];
    const oks = state.oks ?? {};
    const lone = winners.length === 1 ? winners[0] : null;
    const iGive = lone != null && !state.giftUid && (variant === 'shared' || lone === me.uid);
    const live = state.phase === 'finale';
    const board = [...players].sort((a, b) => (tally[a.uid] ?? 0) - (tally[b.uid] ?? 0));
    return (
      <div className="gv cf-finale">
        <span className="cf-badge">🤫 THE TRUTH COMES OUT</span>
        <div className="cf-crown fx-pop">
          <div className="cf-crown-emoji fx-float">👑</div>
          {winners.length === 0 ? (
            <h2 className="fx-title">Dead heat</h2>
          ) : (
            <h2 className="fx-title">
              {winners.map((uid) => `${emojiOf(uid)} ${nameOf(uid)}`).join(' & ')}
            </h2>
          )}
          <p className="cf-crown-sub">
            {winners.length === 0
              ? 'everybody drank the same — no crown tonight'
              : `fewest drinks this game (${tally[winners[0]] ?? 0})`}
          </p>
          <div className="cf-board">
            {board.map((p) => (
              <span key={p.uid} className={`cf-board-chip ${winners.includes(p.uid) ? 'cf-board-win' : ''}`}>
                {p.emoji} {p.name} <b>🍺{tally[p.uid] ?? 0}</b>
              </span>
            ))}
          </div>
        </div>
        {winners.length > 0 && <Confetti emojis={['👑', '✨', '🤫', '🎉']} />}

        {lone &&
          (state.giftUid ? (
            <p className="cf-gift fx-pop">
              👑 {nameOf(lone)} hands a drink to {emojiOf(state.giftUid)} {nameOf(state.giftUid)} 🍺
            </p>
          ) : iGive && live ? (
            <>
              <p className="pick-call">
                👑 {variant === 'shared' ? `${nameOf(lone)}, hand` : 'Hand'} out {GIFT_SIPS} drink — who gets it?
              </p>
              <div className="pick-people">
                {players
                  .filter((p) => p.uid !== lone)
                  .map((p) => (
                    <button
                      key={p.uid}
                      className="pick-person"
                      onClick={() => submitInput({ action: 'give', uid: p.uid })}
                    >
                      <span className="pick-person-emoji">{p.emoji}</span> {p.name}
                    </button>
                  ))}
              </div>
            </>
          ) : (
            live && <p className="muted small">👑 {nameOf(lone)} is choosing who drinks…</p>
          ))}

        {archive.map((round, i) => (
          <div key={i} className="cf-round">
            <p className="fx-kicker">prompt {i + 1}</p>
            <p className="cf-prompt-q cf-prompt-small">{round.prompt}</p>
            {(round.cards ?? []).length === 0 ? (
              <p className="muted small">nobody confessed 🤐</p>
            ) : (
              <Cards cards={round.cards ?? []} trialCardId={round.trialCardId} players={players} reveal={true} />
            )}
          </div>
        ))}

        {live && !iGive && (
          <Button
            variant="gold"
            size="lg"
            full
            disabled={!!oks[me.uid] && variant !== 'shared'}
            onClick={() => submitInput({ action: 'ok' })}
          >
            {oks[me.uid] && variant !== 'shared'
              ? `waiting… ${Object.keys(oks).length}/${players.length}`
              : 'SEEN ENOUGH ✅'}
          </Button>
        )}
        {live && <TimerBar deadline={timerEndsAt} totalMs={FINALE_MS} />}
      </div>
    );
  }

  /* ---------- reveal ---------- */
  const result = state.roundResult;
  const assignments = result?.assignments ?? [];
  const myCard = cards.find((c) => c.authorUid === me.uid);
  const hasTrial = cards.some((c) => c.id === state.trialCardId);

  return (
    <div className="gv">
      <span className="cf-badge">
        ROUND {state.roundNo}/{ROUNDS_COUNT} · 🤫 REVEALED
      </span>
      <div className="gate-emoji fx-pop">{result?.caught ? '🕵️' : '🤫'}</div>
      {hasTrial && (
        <span className={`fx-stamp ${result?.caught ? '' : 'fx-stamp-good'}`}>
          {result?.caught ? 'caught!' : 'got away'}
        </span>
      )}
      <h2 className="cf-verdict">{result?.note}</h2>
      {myCard && variant !== 'shared' && <p className="muted small">yours was card #{myCard.n}</p>}
      <Cards cards={cards} trialCardId={state.trialCardId} players={players} reveal={true} />
      {assignments.length > 0 && (
        <div className="cf-drinks">
          {assignments.map((a) => (
            <span key={a.uid} className="cf-board-chip">
              {emojiOf(a.uid)} {nameOf(a.uid)} <b>🍺×{a.sips}</b>
            </span>
          ))}
        </div>
      )}
      <p className="muted small">
        {state.roundNo >= ROUNDS_COUNT ? 'last one — the full reveal is next…' : 'next prompt coming up…'}
      </p>
    </div>
  );
}
