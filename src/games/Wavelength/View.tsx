import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import type { GameViewProps } from '../../engine/types';
import type { WlInput, WlState } from './definition';

/** The 0-100 spectrum: labels, the hidden target (actor/reveal only) and every dial. */
function Bar({
  state,
  players,
  target,
  guesses,
}: {
  state: WlState;
  players: GameViewProps<WlState, WlInput>['players'];
  target: number | null;
  guesses: Record<string, number>;
}) {
  return (
    <div className="wl-wrap">
      <div className="wl-bar">
        {target != null && (
          <span className="wl-target" style={{ left: `${target}%` }}>
            <span className="wl-target-flag">🎯</span>
          </span>
        )}
        {Object.entries(guesses).map(([uid, value]) => (
          <span key={uid} className="wl-guess" style={{ left: `${value}%` }}>
            {players.find((p) => p.uid === uid)?.emoji ?? '❓'}
          </span>
        ))}
      </div>
      <div className="wl-ends">
        <span>{state.left}</span>
        <span>{state.right}</span>
      </div>
    </div>
  );
}

function PassOn({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="lg" full onClick={onClick}>
      PASS IT ON ➡️
    </Button>
  );
}

export function View({
  state,
  me,
  players,
  actorUid,
  isActor,
  variant,
  submitInput,
}: GameViewProps<WlState, WlInput>) {
  const [dial, setDial] = useState(50);

  const actor = players.find((p) => p.uid === actorUid);
  const guesses = state.guesses ?? {};
  const myGuess = guesses[me.uid];
  const guessers = players.filter((p) => p.uid !== actorUid);
  const done = guessers.filter((p) => guesses[p.uid] != null).length;

  // a fresh dial for every round and every holder — the phone gets passed on,
  // so the next player must never start from the last player's position
  useEffect(() => {
    setDial(typeof myGuess === 'number' ? myGuess : 50);
  }, [me.uid, myGuess]);

  /* ---------- the actor gives the clue ---------- */
  if (state.phase === 'clue') {
    if (isActor) {
      return (
        <div className="gv">
          <span className="pr-rule-badge">🗣️ YOU GIVE THE CLUE</span>
          <Bar state={state} players={players} target={state.target} guesses={{}} />
          <div className="wl-mine">{state.target}</div>
          <h2>Think up a clue for {state.target}/100 🤫</h2>
          <p className="muted small">
            no clock — take as long as you want, then hit ready and say it out loud
          </p>
          <Button variant="gold" size="lg" full onClick={() => submitInput({ action: 'clue' })}>
            READY — I'VE GOT A CLUE 🗣️
          </Button>
        </div>
      );
    }
    return (
      <div className="gv">
        <span className="pr-rule-badge">🗣️ THE CLUE</span>
        <Bar state={state} players={players} target={null} guesses={{}} />
        <div className="gate-emoji pulse">🤫</div>
        <h2>{actor?.name ?? 'Someone'} is thinking of a clue…</h2>
        {variant === 'shared' ? (
          <PassOn onClick={() => submitInput({ action: 'wait' })} />
        ) : (
          <p className="muted">no clock — they'll say it out loud once they're ready</p>
        )}
      </div>
    );
  }

  /* ---------- everyone else dials ---------- */
  if (state.phase === 'guessing') {
    if (isActor) {
      return (
        <div className="gv">
          <span className="pr-rule-badge">🎚️ THEY'RE DIALING</span>
          <Bar state={state} players={players} target={state.target} guesses={guesses} />
          <p className="muted">
            your target: <b className="wl-key">{state.target}</b> — keep a straight face 🙃
          </p>
          <p className="muted small">{done}/{guessers.length} locked in — whenever they're ready</p>
          {variant === 'shared' && <PassOn onClick={() => submitInput({ action: 'wait' })} />}
        </div>
      );
    }

    if (myGuess != null) {
      return (
        <div className="gv">
          <span className="pr-rule-badge">🎚️ LOCKED IN</span>
          <Bar state={state} players={players} target={null} guesses={{ [me.uid]: myGuess }} />
          <div className="gate-emoji">🔒</div>
          <h2>You dialed {myGuess}</h2>
          <p className="muted">
            waiting for the rest ({done}/{guessers.length})
          </p>
        </div>
      );
    }

    return (
      <div className="gv">
        <span className="pr-rule-badge">🎚️ YOUR DIAL</span>
        <Bar state={state} players={players} target={null} guesses={{ [me.uid]: dial }} />
        <div className="wl-mine">{dial}</div>
        <input
          className="wl-slider"
          type="range"
          min={0}
          max={100}
          value={dial}
          aria-label="your guess"
          onChange={(e) => setDial(Number(e.target.value))}
        />
        <Button variant="gold" size="lg" full onClick={() => submitInput({ action: 'guess', value: dial })}>
          LOCK IT IN 🎯
        </Button>
        <p className="muted small">{done}/{guessers.length} locked in — no clock, take your time</p>
      </div>
    );
  }

  /* ---------- the reveal ---------- */
  const rows = Object.entries(guesses)
    .map(([uid, value]) => ({ uid, value, d: Math.abs(value - state.target) }))
    .sort((a, b) => a.d - b.d);
  const assignments = state.assignments ?? [];

  return (
    <div className="gv">
      <span className="pr-rule-badge">🎯 THE REVEAL</span>
      <Bar state={state} players={players} target={state.target} guesses={guesses} />
      <h2>{state.note}</h2>
      <div className="wl-rows">
        {rows.map((r) => {
          const player = players.find((p) => p.uid === r.uid);
          const drinks = assignments.find((a) => a.uid === r.uid);
          const closest = state.closestUids?.includes(r.uid);
          return (
            <div
              key={r.uid}
              className={`wl-row ${drinks ? 'wl-row-far' : closest ? 'wl-row-close' : ''}`}
            >
              <span className="wl-row-who">
                {player?.emoji} {player?.name}
              </span>
              <span className="wl-row-val">
                {r.value} <span className="muted">({r.d < 1 ? 'dead on' : `${r.d} off`})</span>
              </span>
              {drinks && <span className="wl-row-sips">🍺{drinks.sips}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
