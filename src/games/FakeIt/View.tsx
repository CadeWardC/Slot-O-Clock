import { useState, type ReactNode } from 'react';
import { TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps, RoomMode } from '../../engine/types';
import {
  ARGUE_MS,
  CAUGHT_SIPS,
  FOOLED_SIPS,
  MODES,
  ROUNDS_COUNT,
  VOTE_MS,
  type FkInput,
  type FkMode,
  type FkRoundRecord,
  type FkState,
} from './definition';

/** Answer → grid label. */
function answerLabel(
  mode: FkMode,
  value: number | string | undefined,
  players: GameViewProps['players'],
): string {
  if (value == null) return '❓';
  if (mode === 'numbers') return `🖐 ${value}`;
  if (mode === 'raise') return value === 1 ? '✋ raised' : '🙅 nope';
  const target = players.find((p) => p.uid === value);
  return `👉 ${target?.name ?? '?'}`;
}

function nameOf(players: GameViewProps['players'], uid: string | null | undefined): string {
  if (!uid) return '?';
  const p = players.find((x) => x.uid === uid);
  return p ? `${p.emoji} ${p.name}` : '?';
}

/** Compact ballot tally for the unmask — "Ana ×3 · Bo ×1". */
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
      👀 hold to peek at your role
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

/** The prompt is public now — the faker reads it off the same card as everyone else. */
function PromptCard({ state }: { state: FkState }) {
  const mode = MODES[state.mode] ?? MODES.numbers;
  return (
    <div className="fk-card fk-card-public">
      <p className="fk-card-label">the prompt — everyone sees this, faker included</p>
      <h2 className="fk-prompt">{state.prompt}</h2>
      <p className="fk-card-hint">
        {mode.emoji} {mode.name}: {mode.how}.
      </p>
    </div>
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
        <div key={p.uid} className="fk-row">
          <span className="fk-row-who">
            {p.emoji} {p.name}
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
  const mode = MODES[state.mode] ?? MODES.numbers;
  const isFaker = me.uid === state.fakerUid;
  const total = players.length;
  const privateScreen = variant !== 'shared';
  // 'secret' = a room that was mid-game before this build landed; it settles within one timer
  const phase = state.phase as string;

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

  /* ---------- verdict: sealed, because "unanimous" would give the faker away ---------- */
  if (phase === 'verdict') {
    const ballots = Object.keys(state.votes ?? {}).length;
    return (
      <div className="gv">
        <RoundTag state={state} />
        <div className="gate-emoji pulse">🗳️</div>
        <h2>Ballots locked and sealed</h2>
        <p className="fk-sealed">
          🔒 {ballots}/{total} ballots in — and nobody sees the tally. Not you, not the accused, not yet.
        </p>
        <p className="fk-argue-help">
          One doubter is all it takes to save the faker, and you'll only find out at the unmask whether this round
          was unanimous. Accuse again next round — and make them explain the same story twice.
        </p>
        <p className="muted small">
          no drinks yet: all {ROUNDS_COUNT} rounds settle on one final tab — {CAUGHT_SIPS} for the faker on every
          round you nail, {FOOLED_SIPS} each for you on every round you don't
        </p>
        {state.roundNo >= ROUNDS_COUNT && <p className="muted">that's all three rounds — unmasking…</p>}
      </div>
    );
  }

  /* ---------- brief: public prompt + private role ---------- */
  if (phase === 'brief' || phase === 'secret') {
    const seenCount = Object.keys(state.seen ?? {}).length;
    const iAmIn = !!(state.seen ?? {})[me.uid];
    return (
      <div className="gv">
        <RoundTag state={state} />
        <PromptCard state={state} />
        {iAmIn ? (
          <>
            <div className="gate-emoji">✅</div>
            <p className="muted">
              card read — waiting for the others ({seenCount}/{total}){secs}
            </p>
          </>
        ) : (
          <>
            <Peek variant={variant}>
              {isFaker ? (
                <div className="fk-card fk-card-faker">
                  <p className="fk-card-label">your role — keep this to yourself</p>
                  <h2 className="fk-faker-line">🕵️ YOU ARE THE FAKER</h2>
                  <p className="fk-card-hint">
                    All {ROUNDS_COUNT} rounds. You get the same prompt as everyone (you can read it above), so
                    make a believable move, remember it, and lie your way out when they start asking questions.
                  </p>
                </div>
              ) : (
                <div className="fk-card">
                  <p className="fk-card-label">your role — keep this to yourself</p>
                  <h2 className="fk-faker-line fk-clean-line">😇 YOU'RE CLEAN</h2>
                  <p className="fk-card-hint">
                    One of you is the faker — for all {ROUNDS_COUNT} rounds — and they can see the prompt too.
                    Answer honestly, then make them explain their move.
                  </p>
                </div>
              )}
            </Peek>
            <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
              GOT IT — I KNOW MY ROLE
            </button>
          </>
        )}
      </div>
    );
  }

  /* ---------- task: make your move ---------- */
  if (phase === 'task') {
    const doneCount = Object.keys(state.answers ?? {}).length;
    const myAnswer = (state.answers ?? {})[me.uid];
    const locked = myAnswer != null;
    return (
      <div className="gv">
        <RoundTag state={state} />
        {privateScreen && <RoleBadge isFaker={isFaker} />}
        <PromptCard state={state} />
        <p className="fk-call">ON THREE: {mode.how}!</p>

        {locked ? (
          <>
            <div className="gate-emoji">{answerLabel(state.mode, myAnswer, players)}</div>
            <p className="muted">
              move locked in ({doneCount}/{total}){secs} — remember it, you have to defend it
            </p>
          </>
        ) : (
          <>
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
              <PlayerPicker
                players={players}
                excludeUid={me.uid}
                onPick={(uid) => submitInput({ action: 'answer', value: uid })}
              />
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
            {isFaker && privateScreen && <p className="fk-tip">{mode.fakerHint}</p>}
          </>
        )}
      </div>
    );
  }

  /* ---------- argue: the phase that wins or loses it ---------- */
  if (phase === 'argue') {
    const readyCount = Object.keys(state.argued ?? {}).length;
    const iAmReady = !!(state.argued ?? {})[me.uid];
    const shared = variant === 'shared';
    return (
      <div className="gv">
        <RoundTag state={state} />
        {privateScreen && <RoleBadge isFaker={isFaker} />}
        <PromptCard state={state} />
        <AnswersGrid state={state} players={players} />
        <p className="fk-call">🗣️ ARGUE IT OUT</p>
        <p className="fk-argue-help">
          Everyone knows this prompt — the faker included — so every move above has to be explained out loud.
          Grill the answers that don't add up: {ROUNDS_COUNT} rounds means the liar has to stay consistent.
        </p>
        {isFaker && privateScreen && (
          <p className="fk-tip">
            🕵️ you're the faker: sell your move, cast doubt on somebody else, and don't change your story next round.
          </p>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={ARGUE_MS} />
        {shared ? (
          <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
            WE'VE SAID ENOUGH — OPEN THE BALLOT 🗳️
          </button>
        ) : iAmReady ? (
          <p className="muted">
            🗳️ ready to accuse — waiting for the others ({readyCount}/{total}){secs}
          </p>
        ) : (
          <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
            I'M DONE TALKING — READY TO ACCUSE
          </button>
        )}
      </div>
    );
  }

  /* ---------- vote: secret ballot, unanimous or nothing ---------- */
  const myVote = (state.votes ?? {})[me.uid];
  const voteCount = Object.keys(state.votes ?? {}).length;
  return (
    <div className="gv">
      <RoundTag state={state} />
      {privateScreen && <RoleBadge isFaker={isFaker} />}
      <PromptCard state={state} />
      <AnswersGrid state={state} players={players} />

      {myVote ? (
        <>
          <div className="gate-emoji">🗳️</div>
          <p className="muted">
            {nameOf(players, myVote)} accused — waiting for every ballot ({voteCount}/{total}){secs}
          </p>
          <p className="fk-argue-help">
            Every vote is secret until the unmask, so nobody can see who broke ranks. Keep arguing.
          </p>
        </>
      ) : (
        <>
          <p className="fk-call">Accuse one player — it only counts if you ALL agree</p>
          <p className="fk-argue-help">
            Unanimous and right → the faker drinks {CAUGHT_SIPS}. One doubter, one abstention, or one vote in the
            wrong place → no accusation, and everyone but the faker drinks {FOOLED_SIPS}.
          </p>
          <PlayerPicker
            players={players}
            excludeUid={me.uid}
            onPick={(uid) => submitInput({ action: 'vote', value: uid })}
          />
          {isFaker && privateScreen && (
            <p className="fk-tip">
              🕵️ your ballot is a decoy — it never counts toward their unanimity, so it can't save you. Talk your
              way out instead.
            </p>
          )}
          <TimerBar deadline={timerEndsAt} totalMs={VOTE_MS} />
          <p className="muted small">
            {voteCount}/{total} ballots in{secs}
          </p>
        </>
      )}
    </div>
  );
}
