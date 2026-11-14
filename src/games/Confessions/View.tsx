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
            className={`cf-card ${trial ? 'cf-card-trial' : ''}`}
            style={{ ['--cf-tilt' as string]: `${((i % 3) - 1) * 1.1}deg`, animationDelay: `${i * 0.06}s` }}
          >
            <span className="cf-card-num">
              No. {card.n}
              {trial && <b className="cf-card-flag">on trial</b>}
            </span>
            <p className="cf-card-text">{card.text}</p>
            {reveal && (
              <p className="cf-card-author">
                {author?.emoji} {author?.name ?? '?'}
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

  const round = `Round ${state.roundNo} of ${ROUNDS_COUNT}`;
  const prompt = (
    <div className="fx-paper cf-prompt">
      <p className="fx-kicker">{round}</p>
      <p className="cf-prompt-q">{state.prompt}</p>
    </div>
  );

  /* ---------- write it ---------- */
  if (state.phase === 'write') {
    const mine = myInput?.action === 'write' ? myInput.text : null;
    return (
      <div className="gv cf">
        <span className="fx-tag fx-tag-pink">Anonymous</span>
        {prompt}
        {mine ? (
          <div className="cf-sealed">
            <span className="fx-stamp fx-stamp-gold cf-stamp">sealed</span>
            <p className="cf-sub">
              {Object.keys(written).length} of {players.length} in. No names go on it.
            </p>
          </div>
        ) : (
          <>
            <textarea
              className="cf-textarea"
              rows={3}
              maxLength={MAX_TEXT}
              value={text}
              placeholder="Write it here. No names."
              onChange={(e) => setText(e.target.value)}
            />
            <p className="cf-count">
              {text.length}/{MAX_TEXT}
            </p>
            <Button
              variant="gold"
              size="lg"
              full
              disabled={text.trim().length === 0}
              onClick={() => submitInput({ action: 'write', text })}
            >
              Seal it
            </Button>
            {variant === 'shared' && <p className="cf-sub">Cover the screen while you type.</p>}
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
        <div className="gv cf">
          <span className="fx-tag fx-tag-ink">{round}</span>
          <h2 className="fx-title">Nobody wrote anything</h2>
          <p className="cf-sub">Everyone drinks 1.</p>
        </div>
      );
    }

    return (
      <div className="gv cf">
        <span className="fx-tag fx-tag-pink">Who wrote No. {trial.n}?</span>
        <p className="cf-q">{state.prompt}</p>
        <Cards cards={cards} trialCardId={state.trialCardId} players={players} reveal={false} />
        {myVote ? (
          <p className="cf-sub">
            You said {players.find((p) => p.uid === myVote)?.name ?? '?'}. {voteCount} of {players.length} voted
            {secs}.
          </p>
        ) : (
          <>
            <div className="pick-people cf-pick">
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
            <p className="cf-sub">
              {voteCount} of {players.length} voted{secs}.
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
      <div className="gv cf cf-finale">
        <span className="fx-tag fx-tag-pink">Who wrote what</span>

        <div className="fx-paper cf-sheet">
          <p className="fx-kicker">Drinks this game</p>
          {board.map((p) => (
            <div key={p.uid} className={`cf-line ${winners.includes(p.uid) ? 'cf-line-win' : ''}`}>
              <span className="cf-line-who">
                {p.emoji} {p.name}
              </span>
              {winners.includes(p.uid) && <span className="cf-line-tag">fewest</span>}
              <span className="cf-line-n">{tally[p.uid] ?? 0}</span>
            </div>
          ))}
          {winners.length === 0 && <p className="cf-sheet-note">All level. Nobody wins.</p>}
          {lone && state.giftUid && (
            <p className="cf-sheet-note">
              {nameOf(lone)} gives {GIFT_SIPS} to {emojiOf(state.giftUid)} {nameOf(state.giftUid)}.
            </p>
          )}
        </div>
        {winners.length > 0 && <Confetti />}

        {lone && !state.giftUid && live && (
          iGive ? (
            <>
              <p className="cf-q">
                {variant === 'shared' ? `${nameOf(lone)}, give` : 'You drank least. Give'} {GIFT_SIPS} drink to:
              </p>
              <div className="pick-people cf-pick">
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
            <p className="cf-sub">{nameOf(lone)} drank least and is picking who drinks.</p>
          )
        )}

        {archive.map((r, i) => (
          <div key={i} className="cf-round">
            <p className="cf-q">
              <span className="cf-q-n">{i + 1}</span>
              {r.prompt}
            </p>
            {(r.cards ?? []).length === 0 ? (
              <p className="cf-sub">Nobody wrote anything.</p>
            ) : (
              <Cards cards={r.cards ?? []} trialCardId={r.trialCardId} players={players} reveal={true} />
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
              ? `Waiting ${Object.keys(oks).length}/${players.length}`
              : 'Seen enough'}
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
    <div className="gv cf">
      <span className="fx-tag fx-tag-ink">{round}</span>
      <div className="fx-paper cf-prompt cf-result">
        {hasTrial && (
          <span className={`fx-stamp cf-stamp ${result?.caught ? '' : 'fx-stamp-good'}`}>
            {result?.caught ? 'caught' : 'got away'}
          </span>
        )}
        <p className="cf-prompt-q">{result?.note}</p>
        {assignments.length > 0 && (
          <p className="cf-drinks">
            Drinks: {assignments.map((a) => `${nameOf(a.uid)} ${a.sips}`).join(', ')}
          </p>
        )}
      </div>
      <Cards cards={cards} trialCardId={state.trialCardId} players={players} reveal={true} />
      <p className="cf-sub">
        {myCard && variant !== 'shared' ? `Yours was No. ${myCard.n}. ` : ''}
        {state.roundNo >= ROUNDS_COUNT ? 'Every card gets a name next.' : 'Next prompt in a moment.'}
      </p>
    </div>
  );
}
