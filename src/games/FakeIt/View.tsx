import { useState, type ReactNode } from 'react';
import { TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps, RoomMode } from '../../engine/types';
import {
  BRIEF_MS,
  CAUGHT_SIPS,
  FOOLED_SIPS,
  GESTURE_MS,
  LOCK_MS,
  MODES,
  REVEAL_MS,
  ROUNDS_COUNT,
  VOTE_MS,
  type FkInput,
  type FkMode,
  type FkRoundRecord,
  type FkState,
} from './definition';

type ModeMeta = (typeof MODES)[FkMode];

function nameOf(players: GameViewProps['players'], uid: string | null | undefined): string {
  if (!uid) return '?';
  const p = players.find((x) => x.uid === uid);
  return p ? `${p.emoji} ${p.name}` : '?';
}

/** Compact tally for the unmask — "Ana ×3 · Bo ×1". */
function voteTally(votes: Record<string, string> | undefined, players: GameViewProps['players']): string {
  const tally: Record<string, number> = {};
  for (const target of Object.values(votes ?? {})) tally[target] = (tally[target] ?? 0) + 1;
  return Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([uid, n]) => `${nameOf(players, uid)} ×${n}`)
    .join(' · ');
}

/** On one shared phone private cards hide behind press-and-hold so they can be passed safely. */
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
  const mode = MODES[state.mode] ?? MODES.numbers;
  return (
    <span className="pr-rule-badge">
      ROUND {state.roundNo}/{ROUNDS_COUNT} · {mode.emoji} {mode.name} · one faker all game
    </span>
  );
}

/** Party mode = a private screen per player, so the role can be shown outright. */
function RoleBadge({ isFaker }: { isFaker: boolean }) {
  return (
    <span className={`fk-role-badge ${isFaker ? 'fk-role-spy' : 'fk-role-clean'}`}>
      {isFaker ? '🕵️ you are the faker' : '😇 you are clean'}
    </span>
  );
}

/** The move the whole table is playing — the only thing the countdown screen gives away. */
function MoveLine({ mode }: { mode: ModeMeta }) {
  return (
    <p className="fk-card-hint">
      {mode.emoji} {mode.name}: {mode.how}.
    </p>
  );
}

/** The prompt, on the screens where it is allowed to be on screen. */
function PromptCard({ prompt, mode, label }: { prompt: string; mode: ModeMeta; label: string }) {
  return (
    <div className="fk-card fk-card-public">
      <p className="fk-card-label">{label}</p>
      <h2 className="fk-prompt">{prompt}</h2>
      <MoveLine mode={mode} />
    </div>
  );
}

/** Everyone but the faker gets this. It disappears the moment the countdown starts. */
function CleanCard({ prompt, mode }: { prompt: string; mode: ModeMeta }) {
  return (
    <div className="fk-card fk-card-private">
      <p className="fk-card-label">your prompt — keep it off your face</p>
      <h2 className="fk-prompt">{prompt}</h2>
      <MoveLine mode={mode} />
      <p className="fk-card-hint">
        One player never got this: they only know the move. At zero, make the honest one — and be ready to defend it,
        because the prompt goes public right after.
      </p>
    </div>
  );
}

/** The faker's whole round: no prompt, just the move and a cover story. */
function FakerCard({ mode }: { mode: ModeMeta }) {
  return (
    <div className="fk-card fk-card-faker">
      <p className="fk-card-label">your role — keep this to yourself</p>
      <h2 className="fk-faker-line">🕵️ BLEND IN</h2>
      <p className="fk-blend-move">
        {mode.emoji} {mode.name} — {mode.move}.
      </p>
      <p className="fk-card-hint">
        You are the faker for all {ROUNDS_COUNT} rounds, and you do <b>not</b> get the prompt — everyone else has just
        read it. The countdown starts as soon as every card is read: make a move that looks like theirs, then defend
        it out loud when the prompt goes public {GESTURE_MS / 1000} seconds later.
      </p>
      <p className="fk-tip">{mode.fakerHint}</p>
    </div>
  );
}

/** The public ballot: who named whom, live. Never marks the faker — it can't, that's the game. */
function VoteBoard({
  votes,
  players,
  meUid,
}: {
  votes: Record<string, string>;
  players: GameViewProps['players'];
  meUid: string;
}) {
  return (
    <div className="fk-rows">
      {players.map((p) => {
        const target = votes[p.uid];
        return (
          <div key={p.uid} className={`fk-row ${p.uid === meUid ? 'fk-row-mine' : ''}`}>
            <span className="fk-row-who">
              {p.emoji} {p.name}
            </span>
            <span className={`fk-row-val ${target ? '' : 'fk-row-wait'}`}>
              {target ? `🗳️ ${nameOf(players, target)}` : 'still thinking…'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PlayerPicker({
  players,
  meUid,
  selected,
  onPick,
}: {
  players: GameViewProps['players'];
  meUid: string;
  selected?: string;
  onPick: (uid: string) => void;
}) {
  return (
    <div className="fk-people">
      {players
        .filter((p) => p.uid !== meUid)
        .map((p) => (
          <button
            key={p.uid}
            className={`fk-person ${p.uid === selected ? 'fk-person-on' : ''}`}
            onClick={() => onPick(p.uid)}
          >
            <span className="fk-person-emoji">{p.emoji}</span> {p.name}
          </button>
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
  const mode = MODES[state.mode] ?? MODES.numbers;
  const isFaker = me.uid === state.fakerUid;
  const total = players.length;
  // 'secret'/'task'/'argue' = a room that was mid-game before this build landed;
  // it settles into a fresh private card within one timer
  const phase = state.phase as string;
  const privateScreen = variant !== 'shared';
  const shared = variant === 'shared';

  /* ---------- unmask / done: the only place the truth is ever printed ---------- */
  if (phase === 'unmask' || phase === 'done') {
    const rounds = Object.values(state.history ?? {}).sort((a, b) => a.roundNo - b.roundNo);
    const hits = rounds.filter((r) => r.hit).length;
    const faker = players.find((p) => p.uid === state.fakerUid);
    return (
      <div className="gv">
        <p className="fk-unmask-label">the faker all along was</p>
        <h1 className="fk-unmask-name">{faker ? `${faker.emoji} ${faker.name}` : '?'}</h1>
        <p className="fk-unmask-sub">
          {hits === 0
            ? `never caught — ${ROUNDS_COUNT}/${ROUNDS_COUNT} rounds faked 🎭`
            : hits >= ROUNDS_COUNT
              ? `caught in every single round 🕵️`
              : `caught ${hits} of ${ROUNDS_COUNT} rounds`}
        </p>
        <div className="fk-rounds">
          {rounds.map((r: FkRoundRecord) => (
            <div key={r.roundNo} className={`fk-round ${r.hit ? 'fk-round-hit' : 'fk-round-miss'}`}>
              <div className="fk-round-head">
                ROUND {r.roundNo} {r.hit ? '· 🕵️ CAUGHT' : '· 🎭 GOT AWAY'}
              </div>
              <div className="fk-round-prompt">{r.prompt}</div>
              <div className="fk-round-acc">
                {r.unanimous
                  ? `unanimous → ${nameOf(players, r.accusedUid)}${r.hit ? '' : ' (innocent!)'}`
                  : 'ballot split — no accusation landed'}
              </div>
              {voteTally(r.votes, players) && (
                <div className="fk-round-votes">🗳️ {voteTally(r.votes, players)}</div>
              )}
              {r.votes?.[state.fakerUid] && (
                <div className="fk-round-decoy">the faker's decoy vote never counted</div>
              )}
            </div>
          ))}
        </div>
        <p className="fk-tab">
          {hits === 0
            ? `🍺 clean getaway — ${nameOf(players, state.fakerUid)} drinks nothing, everyone else drinks ${ROUNDS_COUNT * FOOLED_SIPS}`
            : `🍺 ${nameOf(players, state.fakerUid)} ×${hits * CAUGHT_SIPS} · everyone else ×${
                (ROUNDS_COUNT - hits) * FOOLED_SIPS
              }`}
        </p>
        <p className="muted small">all three rounds settle at once — check the drinks list</p>
      </div>
    );
  }

  /* ---------- verdict: public ballots, silent verdict ---------- */
  if (phase === 'verdict') {
    const votes = state.votes ?? {};
    const ballots = players.filter((p) => typeof votes[p.uid] === 'string').length;
    return (
      <div className="gv">
        <RoundTag state={state} />
        <div className="gate-emoji pulse">🗳️</div>
        <h2>Ballots locked and sealed</h2>
        <p className="fk-sealed">
          🔒 {ballots}/{total} in — and the app says nothing about what the group decided. Not to you, not to the
          accused, not yet.
        </p>
        <VoteBoard votes={votes} players={players} meUid={me.uid} />
        <p className="fk-argue-help">
          Whether that ballot was unanimous, and whether it landed on the faker, is settled at the unmask with every
          drink. Accuse again next round — and make them explain the same story twice.
        </p>
        <p className="muted small">
          no drinks yet: all {ROUNDS_COUNT} rounds settle on one final tab — {CAUGHT_SIPS} for the faker on every
          round you nail, {FOOLED_SIPS} each for you on every round you don't
        </p>
        {state.roundNo >= ROUNDS_COUNT && <p className="muted">that's all three rounds — unmasking…</p>}
      </div>
    );
  }

  /* ---------- brief: the private card. Faker gets the move, everyone else gets the prompt ---------- */
  if (phase === 'brief' || !['gesture', 'reveal', 'vote'].includes(phase)) {
    const seenCount = Object.keys(state.seen ?? {}).length;
    const iAmIn = !!(state.seen ?? {})[me.uid];
    return (
      <div className="gv">
        <RoundTag state={state} />
        {iAmIn ? (
          <>
            <div className="gate-emoji">✅</div>
            <p className="muted">
              card read — waiting for the others ({seenCount}/{total}){secs}
            </p>
            <p className="fk-argue-help">
              Hide it now. The countdown starts the moment every card is in, and nothing about this prompt shows up
              again until after the move.
            </p>
          </>
        ) : (
          <>
            <Peek variant={variant}>
              {isFaker ? (
                <FakerCard mode={mode} />
              ) : (
                <CleanCard prompt={state.prompt} mode={mode} />
              )}
            </Peek>
            <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
              {isFaker ? 'GOT IT — I CAN FAKE THIS' : 'GOT IT — HIDE THE PROMPT'}
            </button>
          </>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={BRIEF_MS} />
      </div>
    );
  }

  /* ---------- gesture: countdown only. No prompt, no role, no taps ---------- */
  if (phase === 'gesture') {
    const secsLeft = left != null ? Math.ceil(left / 1000) : GESTURE_MS / 1000;
    const go = secsLeft <= 0;
    return (
      <div className="gv">
        <RoundTag state={state} />
        <div className={`fk-clock ${go ? 'fk-clock-go' : ''}`}>{go ? 'GO!' : secsLeft}</div>
        <p className="fk-call">
          {mode.emoji} {mode.name.toUpperCase()} — {mode.move}
        </p>
        <TimerBar deadline={timerEndsAt} totalMs={GESTURE_MS} />
        <p className="fk-argue-help">
          🤫 No talking and nothing to tap: everyone moves at zero and holds it. The prompt goes public the second the
          clock dies.
        </p>
      </div>
    );
  }

  /* ---------- reveal: the prompt goes public and the table argues ---------- */
  if (phase === 'reveal') {
    const readyCount = Object.keys(state.argued ?? {}).length;
    const iAmReady = !!(state.argued ?? {})[me.uid];
    return (
      <div className="gv">
        <RoundTag state={state} />
        {privateScreen && <RoleBadge isFaker={isFaker} />}
        <PromptCard
          prompt={state.prompt}
          mode={mode}
          label={isFaker && privateScreen ? 'the prompt you never saw' : 'the prompt — public now'}
        />
        <p className="fk-call">🗣️ ARGUE IT OUT</p>
        <p className="fk-argue-help">
          One of you moved without ever seeing that. So grill the moves: whose number doesn't fit, whose point makes
          no sense, whose hand went up when it shouldn't have. {ROUNDS_COUNT} rounds means one person has to stay
          consistent all game.
        </p>
        <TimerBar deadline={timerEndsAt} totalMs={REVEAL_MS} />
        {shared ? (
          <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
            WE'VE SAID ENOUGH — OPEN THE BALLOT 🗳️
          </button>
        ) : iAmReady ? (
          <p className="muted">
            🗳️ ready for the ballot — waiting for the others ({readyCount}/{total}){secs}
          </p>
        ) : (
          <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
            WE'VE SAID ENOUGH — OPEN THE BALLOT 🗳️
          </button>
        )}
        {isFaker && privateScreen && (
          <p className="fk-tip">
            🕵️ you're the faker: you never read that prompt, so don't defend your move — make somebody else defend
            theirs.
          </p>
        )}
      </div>
    );
  }

  /* ---------- vote: public ballots, live and switchable, unanimous or nothing ---------- */
  const votes = state.votes ?? {};
  const myVote = votes[me.uid];
  const voteCount = players.filter((p) => typeof votes[p.uid] === 'string').length;
  const allIn = !!state.allIn && voteCount >= total;
  return (
    <div className="gv">
      <RoundTag state={state} />
      {privateScreen && <RoleBadge isFaker={isFaker} />}
      <p className="fk-card-mini">
        {mode.emoji} {state.prompt}
      </p>

      <p className="fk-call">🗳️ {allIn ? 'EVERY BALLOT IS IN' : 'NAME THE FAKER'}</p>
      <p className="fk-argue-help">
        Every ballot is public and yours stays switchable until the last one lands. An accusation needs every clean
        vote on the same player — one doubter and the faker walks. The faker's own pick is a decoy: it never counts.
      </p>

      <VoteBoard votes={votes} players={players} meUid={me.uid} />

      {allIn ? (
        <>
          <p className="fk-sealed">🔒 last chance to switch — the ballot settles when the clock runs out{secs}</p>
          <TimerBar deadline={timerEndsAt} totalMs={LOCK_MS} />
          {shared && (
            <button className="btn btn-ghost btn-lg btn-full" onClick={() => submitInput({ action: 'recast' })}>
              🔁 NOT DONE — HAND THE PHONE ROUND AGAIN
            </button>
          )}
        </>
      ) : (
        <>
          <PlayerPicker
            players={players}
            meUid={me.uid}
            selected={myVote}
            onPick={(uid) => submitInput({ action: 'vote', value: uid })}
          />
          <p className="muted small">
            {myVote ? `you named ${nameOf(players, myVote)} — tap another name to switch it · ` : ''}
            {voteCount}/{total} ballots in{secs}
          </p>
          <TimerBar deadline={timerEndsAt} totalMs={VOTE_MS} />
        </>
      )}

      {isFaker && privateScreen && (
        <p className="fk-tip">
          🕵️ your own ballot is a decoy — it can't break their unanimity and it can't save you. Talk your way out of
          it instead.
        </p>
      )}
    </div>
  );
}
