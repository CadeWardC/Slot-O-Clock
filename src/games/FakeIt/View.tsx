import { useState, type ReactNode } from 'react';
import { useCountdown } from '../../components/ui';
import type { GameViewProps, RoomMode } from '../../engine/types';
import { MODES, ROUNDS_COUNT, type FkInput, type FkMode, type FkState } from './definition';

/** Answer → grid label. */
function answerLabel(mode: FkMode, value: number | string | undefined, players: GameViewProps['players']): string {
  if (value == null) return '❓';
  if (mode === 'numbers') return `🖐 ${value}`;
  if (mode === 'raise') return value === 1 ? '✋ raised' : '🙅 nope';
  const target = players.find((p) => p.uid === value);
  return `👉 ${target?.name ?? '?'}`;
}

/** On one shared phone the card hides behind press-and-hold so it can be passed safely. */
function Peek({ variant, children }: { variant: RoomMode; children: ReactNode }) {
  const [peek, setPeek] = useState(false);
  if (variant !== 'shared') return <>{children}</>;
  const hold = {
    onPointerDown: () => setPeek(true),
    onPointerUp: () => setPeek(false),
    onPointerLeave: () => setPeek(false),
    onPointerCancel: () => setPeek(false),
  };
  return peek ? (
    <div className="fk-peek" {...hold}>
      {children}
    </div>
  ) : (
    <button className="btn btn-ghost btn-lg btn-full" {...hold}>
      👀 hold to peek at your card
    </button>
  );
}

function RoundTag({ state }: { state: FkState }) {
  const mode = MODES[state.mode];
  return (
    <span className="pr-rule-badge">
      ROUND {state.roundNo}/{ROUNDS_COUNT} · {mode.emoji} {mode.name}
    </span>
  );
}

function PlayerPicker({
  players,
  excludeUid,
  onPick,
}: {
  players: GameViewProps['players'];
  excludeUid: string;
  onPick: (uid: string) => void;
}) {
  return (
    <div className="fk-people">
      {players
        .filter((p) => p.uid !== excludeUid)
        .map((p) => (
          <button key={p.uid} className="fk-person" onClick={() => onPick(p.uid)}>
            <span className="fk-person-emoji">{p.emoji}</span> {p.name}
          </button>
        ))}
    </div>
  );
}

function AnswersGrid({ state, players }: { state: FkState; players: GameViewProps['players'] }) {
  return (
    <div className="fk-rows">
      {players.map((p) => (
        <div
          key={p.uid}
          className={`fk-row ${state.phase === 'verdict' && p.uid === state.fakerUid ? 'fk-row-faker' : ''}`}
        >
          <span className="fk-row-who">
            {p.emoji} {p.name}
            {state.phase === 'verdict' && p.uid === state.fakerUid && <span className="fk-spy">🕵️</span>}
          </span>
          <span className="fk-row-val">{answerLabel(state.mode, (state.answers ?? {})[p.uid], players)}</span>
        </div>
      ))}
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
}: GameViewProps<FkState, FkInput>) {
  const left = useCountdown(timerEndsAt);
  const secs = left != null ? ` · ${Math.ceil(left / 1000)}s` : '';
  const mode = MODES[state.mode];
  const isFaker = me.uid === state.fakerUid;
  const total = players.length;

  /* ---------- verdict / done ---------- */
  if (state.phase === 'verdict' || state.phase === 'done') {
    const r = state.roundResult;
    const votes = Object.entries(state.votes ?? {});
    return (
      <div className="gv">
        <RoundTag state={state} />
        <div className={`gate-emoji ${r?.caught ? '' : 'pulse'}`}>{r?.caught ? '🕵️' : '🎭'}</div>
        <h2>{r?.note}</h2>
        <AnswersGrid state={state} players={players} />
        {votes.length > 0 && (
          <p className="muted small">
            {votes
              .map(([voter, target]) => {
                const from = players.find((p) => p.uid === voter);
                const to = players.find((p) => p.uid === target);
                return `${from?.name ?? '?'} → ${to?.name ?? '?'}`;
              })
              .join(' · ')}
          </p>
        )}
        {r && (
          <p className="cat-pool">
            {r.caught
              ? `🍺 ${players.find((p) => p.uid === state.fakerUid)?.name ?? 'the faker'} ×${r.assignments[0]?.sips ?? 3}`
              : `🍺 everyone else ×${r.assignments[0]?.sips ?? 1}`}
          </p>
        )}
        {state.roundNo >= ROUNDS_COUNT && <p className="muted">that's the game — final tally coming up…</p>}
      </div>
    );
  }

  /* ---------- secret card ---------- */
  if (state.phase === 'secret') {
    const seenCount = Object.keys(state.seen ?? {}).length;
    const iAmIn = !!(state.seen ?? {})[me.uid];
    return (
      <div className="gv">
        <RoundTag state={state} />
        {iAmIn ? (
          <>
            <div className="gate-emoji">✅</div>
            <p className="muted">
              card memorized — waiting for the others ({seenCount}/{total})
            </p>
          </>
        ) : (
          <>
            <Peek variant={variant}>
              {isFaker ? (
                <div className="fk-card fk-card-faker">
                  <p className="fk-card-label">your card says…</p>
                  <h2 className="fk-faker-line">🕵️ YOU ARE THE FAKER</h2>
                  <p className="fk-card-hint">{mode.fakerHint}</p>
                </div>
              ) : (
                <div className="fk-card">
                  <p className="fk-card-label">the secret — round {state.roundNo}</p>
                  <h2 className="fk-prompt">{state.prompt}</h2>
                  <p className="fk-card-hint">
                    {mode.emoji} {mode.name}: {mode.how}. The faker doesn't know this — keep it quiet.
                  </p>
                </div>
              )}
            </Peek>
            <button
              className="btn btn-gold btn-lg btn-full"
              onClick={() => submitInput({ action: 'ready' })}
            >
              {isFaker ? 'I KNOW MY ROLE 🕵️' : 'GOT IT — LOCK IT IN'}
            </button>
          </>
        )}
      </div>
    );
  }

  /* ---------- task: enter your move ---------- */
  if (state.phase === 'task') {
    const doneCount = Object.keys(state.answers ?? {}).length;
    const myAnswer = (state.answers ?? {})[me.uid];
    const locked = myAnswer != null;
    return (
      <div className="gv">
        <RoundTag state={state} />
        <p className="fk-call">ON THREE: {mode.how}!</p>

        {locked ? (
          <>
            <div className="gate-emoji">{answerLabel(state.mode, myAnswer, players)}</div>
            <p className="muted">
              move locked in ({doneCount}/{total}){secs} — reveal hits every phone together
            </p>
          </>
        ) : (
          <>
            {isFaker ? (
              <Peek variant={variant}>
                <div className="fk-card fk-card-faker">
                  <h2 className="fk-faker-line">🕵️ you're faking this one</h2>
                  <p className="fk-card-hint">{mode.fakerHint}</p>
                </div>
              </Peek>
            ) : (
              <Peek variant={variant}>
                <div className="fk-card">
                  <p className="fk-card-label">your secret</p>
                  <h2 className="fk-prompt">{state.prompt}</h2>
                </div>
              </Peek>
            )}

            {state.mode === 'numbers' && (
              <div className="fk-nums">
                {Array.from({ length: 11 }, (_, n) => (
                  <button
                    key={n}
                    className="fk-num"
                    onClick={() => submitInput({ action: 'answer', value: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
            {state.mode === 'point' && (
              <PlayerPicker players={players} excludeUid={me.uid} onPick={(uid) => submitInput({ action: 'answer', value: uid })} />
            )}
            {state.mode === 'raise' && (
              <div className="fk-raise">
                <button className="fk-raise-yes" onClick={() => submitInput({ action: 'answer', value: 1 })}>
                  ✋ RAISE IT
                </button>
                <button className="fk-raise-no" onClick={() => submitInput({ action: 'answer', value: 0 })}>
                  🙅 NOT ME
                </button>
              </div>
            )}

            <p className="muted small">
              {doneCount}/{total} in{secs}
            </p>
          </>
        )}
      </div>
    );
  }

  /* ---------- vote: reveal + accusation ---------- */
  const voteCount = Object.keys(state.votes ?? {}).length;
  const myVote = (state.votes ?? {})[me.uid];
  return (
    <div className="gv">
      <RoundTag state={state} />
      <p className="fk-secret-was">
        the secret was: <span className="fk-secret-text">{state.prompt}</span>
      </p>
      <AnswersGrid state={state} players={players} />

      {myVote ? (
        <p className="muted">
          🗳️ you accused {players.find((p) => p.uid === myVote)?.name ?? '?'} — waiting ({voteCount}/{total}){secs}
        </p>
      ) : (
        <>
          <p className="fk-call">Make your case, then accuse:</p>
          <PlayerPicker players={players} excludeUid={me.uid} onPick={(uid) => submitInput({ action: 'vote', value: uid })} />
          <p className="muted small">
            {voteCount}/{total} voted{secs}
          </p>
        </>
      )}
    </div>
  );
}
