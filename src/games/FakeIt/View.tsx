import { useEffect, useState, type ReactNode } from 'react';
import { TimerBar, useCountdown } from '../../components/ui';
import { BigCount, Confetti } from '../../components/fx';
import type { GameViewProps, PlayerInfo, RoomMode } from '../../engine/types';
import {
  BRIEF_MS,
  CAUGHT_SIPS,
  FOOLED_SIPS,
  GESTURE_MS,
  MODES,
  REVEAL_MS,
  ROUNDS_COUNT,
  roundsOf,
  votesNeeded,
  type FkInput,
  type FkMode,
  type FkRoundRecord,
  type FkState,
} from './definition';

type ModeMeta = (typeof MODES)[FkMode];
type Players = GameViewProps['players'];

function find(players: Players, uid: string | null | undefined): PlayerInfo | undefined {
  return uid ? players.find((x) => x.uid === uid) : undefined;
}
function nameOf(players: Players, uid: string | null | undefined): string {
  const p = find(players, uid);
  return p ? `${p.emoji} ${p.name}` : '?';
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
    <button className="fk-peek-btn" {...hold}>
      <span className="fk-peek-eye fx-float">👀</span>
      hold to peek at your card
      <span className="fk-peek-sub">make sure nobody else is looking</span>
    </button>
  );
}

/** Round pips + the move the table is playing all game. */
function RoundTag({ state }: { state: FkState }) {
  const mode = MODES[state.mode] ?? MODES.numbers;
  const rounds = roundsOf(state);
  return (
    <div className="fk-tag">
      <span className="fk-pips" aria-label={`round ${state.roundNo} of ${ROUNDS_COUNT}`}>
        {Array.from({ length: ROUNDS_COUNT }, (_, i) => {
          const rec = rounds.find((r) => r.roundNo === i + 1);
          const cls = rec ? 'fk-pip-done' : i + 1 === state.roundNo ? 'fk-pip-now' : '';
          return (
            <span key={i} className={`fk-pip ${cls}`}>
              {rec ? (rec.result === 'caught' ? '🕵️' : '🎭') : i + 1}
            </span>
          );
        })}
      </span>
      <span className="fk-tag-mode">
        {mode.emoji} {mode.name}
      </span>
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

/** Everyone but the faker gets this. It disappears the moment the countdown starts. */
function CleanCard({ prompt, mode }: { prompt: string; mode: ModeMeta }) {
  return (
    <div className="fk-card fk-card-clean">
      <span className="fk-card-corner">😇</span>
      <p className="fx-kicker">your secret prompt</p>
      <h2 className="fk-prompt">{prompt}</h2>
      <div className="fk-move">
        <span className="fk-move-emoji">{mode.emoji}</span>
        <span>
          <b>{mode.name}</b> — {mode.move} when the clock hits zero
        </span>
      </div>
      <p className="fk-card-hint">
        One player never got this. Answer honestly — the prompt goes public right after the move and you'll have to
        defend it.
      </p>
    </div>
  );
}

/** The faker's whole round: no prompt, just the move and a cover story. */
function FakerCard({ mode }: { mode: ModeMeta }) {
  return (
    <div className="fk-card fk-card-faker">
      <span className="fk-card-corner fx-wiggle">🕵️</span>
      <p className="fx-kicker">your role — tell no one</p>
      <h2 className="fx-title fx-title-pink fk-faker-line">YOU'RE THE FAKER</h2>
      <p className="fk-noprompt">no prompt for you. blend in.</p>
      <div className="fk-move fk-move-faker">
        <span className="fk-move-emoji">{mode.emoji}</span>
        <span>
          <b>{mode.name}</b> — {mode.move} when the clock hits zero
        </span>
      </div>
      <p className="fk-card-hint">{mode.fakerHint}</p>
      <p className="fk-card-hint">
        If everyone else votes for you, you're caught and it's over. Survive {ROUNDS_COUNT} rounds and they all
        drink.
      </p>
    </div>
  );
}

/** Who has done the thing this screen is waiting on. */
function Roster({
  players,
  done,
  meUid,
  doneMark,
  waitMark = '…',
}: {
  players: Players;
  done: (uid: string) => boolean;
  meUid: string;
  doneMark: string;
  waitMark?: string;
}) {
  return (
    <div className="fk-roster">
      {players.map((p) => {
        const ok = done(p.uid);
        return (
          <span
            key={p.uid}
            className={`fk-seat ${ok ? 'fk-seat-ok' : 'fk-seat-wait'} ${p.uid === meUid ? 'fk-seat-me' : ''}`}
          >
            <span className="fk-seat-emoji">{p.emoji}</span>
            <span className="fk-seat-name">{p.name}</span>
            <span className="fk-seat-mark">{ok ? doneMark : waitMark}</span>
          </span>
        );
      })}
    </div>
  );
}

/** The flipped ballots: every suspect, who named them, and how close that was to a conviction. */
function Tally({ record, players }: { record: FkRoundRecord; players: Players }) {
  const votes = record.votes ?? {};
  const need = votesNeeded(players.length);
  const rows = players
    .map((p) => ({ p, voters: players.filter((v) => votes[v.uid] === p.uid) }))
    .filter((r) => r.voters.length > 0)
    .sort((a, b) => b.voters.length - a.voters.length);
  return (
    <div className="fk-tally">
      {rows.map(({ p, voters }, i) => {
        const hit = voters.length >= need;
        return (
          <div
            key={p.uid}
            className={`fk-tally-row fx-rise ${hit ? 'fk-tally-hit' : ''}`}
            style={{ animationDelay: `${0.15 + i * 0.25}s` }}
          >
            <span className="fk-tally-who">
              <span className="fk-tally-emoji">{p.emoji}</span> {p.name}
            </span>
            <span className="fk-tally-voters">
              {voters.map((v) => (
                <span key={v.uid} title={v.name}>
                  {v.emoji}
                </span>
              ))}
            </span>
            <span className="fk-tally-n">
              {voters.length}/{need}
            </span>
          </div>
        );
      })}
      {rows.length === 0 && <p className="muted small">no ballots were cast</p>}
    </div>
  );
}

function RoundsRecap({ state, players }: { state: FkState; players: Players }) {
  const rounds = roundsOf(state);
  if (rounds.length === 0) return null;
  return (
    <div className="fk-rounds">
      {rounds.map((r) => (
        <div key={r.roundNo} className={`fk-round ${r.result === 'caught' ? 'fk-round-hit' : 'fk-round-miss'}`}>
          <div className="fk-round-head">
            ROUND {r.roundNo} · {r.result === 'caught' ? '🕵️ CAUGHT' : '🎭 GOT AWAY'}
          </div>
          <div className="fk-round-prompt">{r.prompt}</div>
          <div className="fk-round-acc">
            {r.result === 'caught'
              ? `everyone named ${nameOf(players, r.accusedUid)}`
              : r.result === 'innocent'
                ? `the table convicted ${nameOf(players, r.accusedUid)} — innocent!`
                : 'split ballot — nobody convicted'}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The faker's face, big. Used by CAUGHT and by the final unmask. */
function Mugshot({ player, tone }: { player: PlayerInfo | undefined; tone: 'caught' | 'free' }) {
  return (
    <div className={`fk-mug fk-mug-${tone} fx-pop`}>
      <span className="fk-mug-emoji">{player?.emoji ?? '🕵️'}</span>
      <span className="fk-mug-name">{player?.name ?? '?'}</span>
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
  const need = votesNeeded(total);
  const phase = state.phase as string;
  const privateScreen = variant !== 'shared';
  const shared = variant === 'shared';
  const rounds = roundsOf(state);
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1] : undefined;
  const faker = find(players, state.fakerUid);

  // the suspect I've tapped but not locked in yet — local until LOCK IN
  const [pickUid, setPickUid] = useState<string | null>(null);
  useEffect(() => {
    setPickUid(null);
  }, [state.roundNo, phase, me.uid]);

  /* ---------- CAUGHT: said out loud, right now, and the game is over ---------- */
  const caught = lastRound?.result === 'caught';
  if (caught && (phase === 'verdict' || phase === 'done' || phase === 'unmask')) {
    return (
      <div className="gv fk">
        <Confetti emojis={['🕵️', '🚨', '🍻', '🎉', '🔎']} />
        <p className="fx-kicker">round {lastRound.roundNo} · {need} of {need} votes</p>
        <span className="fx-stamp fk-stamp-late">CAUGHT!</span>
        <Mugshot player={faker} tone="caught" />
        <p className="fk-verdict-line">
          {privateScreen && isFaker ? 'that\'s you — the table got you' : 'was the faker — the table nailed it'} 🚨
        </p>
        {lastRound && <Tally record={lastRound} players={players} />}
        <div className="fx-panel fk-tab">
          🍺 <b>{faker?.name ?? 'The faker'}</b> drinks {CAUGHT_SIPS}
          {rounds.length > 1 && (
            <>
              {' '}
              · everyone else drinks {(rounds.length - 1) * FOOLED_SIPS} for the round
              {rounds.length > 2 ? 's' : ''} they got away with
            </>
          )}
        </div>
        <RoundsRecap state={state} players={players} />
        <p className="muted small">game over — no more rounds</p>
      </div>
    );
  }

  /* ---------- unmask / done: nobody ever caught them ---------- */
  if (phase === 'unmask' || phase === 'done') {
    return (
      <div className="gv fk">
        <Confetti emojis={['🎭', '😈', '🍻', '✨']} />
        <p className="fx-kicker">the faker all along was…</p>
        <Mugshot player={faker} tone="free" />
        <span className="fx-stamp fx-stamp-gold fk-stamp-late">GOT AWAY</span>
        <p className="fk-verdict-line">
          {rounds.length || ROUNDS_COUNT} rounds, zero prompts, never convicted 🎭
        </p>
        <div className="fx-panel fk-tab">
          🍺 everyone except <b>{faker?.name ?? 'the faker'}</b> drinks{' '}
          {(rounds.length || ROUNDS_COUNT) * FOOLED_SIPS}
        </div>
        <RoundsRecap state={state} players={players} />
      </div>
    );
  }

  /* ---------- verdict: the ballots flip — and this time the faker walked ---------- */
  if (phase === 'verdict' && lastRound) {
    const innocent = lastRound.result === 'innocent';
    const accused = find(players, lastRound.accusedUid);
    const finalRound = state.roundNo >= ROUNDS_COUNT;
    return (
      <div className="gv fk">
        <RoundTag state={state} />
        <p className="fx-kicker">the ballots are in</p>
        <Tally record={lastRound} players={players} />
        {innocent ? (
          <>
            <span className="fx-stamp fx-stamp-good fk-stamp-late">INNOCENT</span>
            <p className="fk-verdict-line">
              {accused ? `${accused.emoji} ${accused.name}` : 'They'} did nothing wrong. You convicted the wrong
              player — <b>the faker got away</b> 🎭
            </p>
          </>
        ) : (
          <>
            <span className="fx-stamp fx-stamp-gold fk-stamp-late">GOT AWAY</span>
            <p className="fk-verdict-line">
              No player got {need} votes, so nobody is convicted. <b>The faker got away with this round</b> 🎭
            </p>
          </>
        )}
        <div className="fx-panel fk-tab">
          🍺 +{FOOLED_SIPS} on the tab for everyone who isn't the faker — it lands when the faker is unmasked
        </div>
        <p className="muted small">
          {finalRound ? 'that was the last round — unmasking…' : `round ${state.roundNo + 1} coming up`}
          {secs}
        </p>
      </div>
    );
  }

  /* ---------- gesture: countdown only. No prompt, no role, no taps ---------- */
  if (phase === 'gesture') {
    const secsLeft = left != null ? Math.max(1, Math.ceil(left / 1000)) : GESTURE_MS / 1000;
    return (
      <div className="gv fk fk-gesture">
        <RoundTag state={state} />
        <p className="fx-kicker">phones down · eyes up</p>
        <div className="fk-count-ring">
          <BigCount n={secsLeft} hotAt={2} />
        </div>
        <div className="fk-go-move">
          <span className="fk-go-emoji fx-wiggle">{mode.emoji}</span>
          <span className="fx-title fx-title-cyan">{mode.move.toUpperCase()}</span>
        </div>
        <TimerBar deadline={timerEndsAt} totalMs={GESTURE_MS} />
        <p className="fk-help">🤫 everyone moves at zero and holds it — the prompt goes public right after</p>
      </div>
    );
  }

  /* ---------- reveal: the prompt goes public and the table argues ---------- */
  if (phase === 'reveal') {
    const argued = state.argued ?? {};
    const iAmReady = !!argued[me.uid];
    return (
      <div className="gv fk">
        <RoundTag state={state} />
        <div className="fk-freeze-row">
          <h2 className="fx-title fk-freeze">FREEZE!</h2>
          <span className="fk-freeze-ico fx-wiggle">🥶</span>
        </div>
        {privateScreen && <RoleBadge isFaker={isFaker} />}
        <div className="fk-card fk-card-public">
          <p className="fx-kicker">
            {isFaker && privateScreen ? 'the prompt you never saw' : 'the prompt — public now'}
          </p>
          <h2 className="fk-prompt">{state.prompt}</h2>
          <div className="fk-move">
            <span className="fk-move-emoji">{mode.emoji}</span>
            <span>{mode.how}</span>
          </div>
        </div>
        <p className="fk-call">🗣️ ARGUE IT OUT</p>
        <p className="fk-help">
          One of you moved without ever reading that. Whose answer makes no sense? Make them explain it.
        </p>
        {isFaker && privateScreen && (
          <p className="fk-tip">🕵️ don't defend your move — make somebody else defend theirs.</p>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={REVEAL_MS} />
        {!shared && <Roster players={players} done={(u) => !!argued[u]} meUid={me.uid} doneMark="🗳️" waitMark="🗣️" />}
        {shared || !iAmReady ? (
          <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
            {shared ? 'DONE ARGUING — VOTE 🗳️' : "I'M READY TO VOTE 🗳️"}
          </button>
        ) : (
          <p className="muted">ready — the ballot opens when everyone is{secs}</p>
        )}
      </div>
    );
  }

  /* ---------- vote: pick a suspect, lock it in. No clock. ---------- */
  if (phase === 'vote') {
    const votes = state.votes ?? {};
    const myVote = typeof votes[me.uid] === 'string' ? votes[me.uid] : null;
    const lockedCount = players.filter((p) => typeof votes[p.uid] === 'string').length;
    const picked = pickUid && pickUid !== me.uid ? find(players, pickUid) : undefined;
    return (
      <div className="gv fk">
        <RoundTag state={state} />
        <h2 className="fx-title fx-title-pink">WHO'S FAKING IT?</h2>
        <p className="fk-card-mini">
          {mode.emoji} {state.prompt}
        </p>

        {myVote ? (
          <div className="fk-locked fx-pop">
            <span className="fk-locked-ico">🔒</span>
            <p className="fx-kicker">locked in</p>
            {/* a private screen can show your own ballot back to you; a shared one can't */}
            <p className="fk-locked-name">{privateScreen ? nameOf(players, myVote) : 'your ballot is sealed'}</p>
            <p className="fk-help">ballots flip the moment the last one locks</p>
          </div>
        ) : (
          <>
            <div className="fk-people">
              {players
                .filter((p) => p.uid !== me.uid)
                .map((p) => (
                  <button
                    key={p.uid}
                    className={`fk-person ${p.uid === pickUid ? 'fk-person-on' : ''}`}
                    onClick={() => setPickUid(p.uid === pickUid ? null : p.uid)}
                  >
                    <span className="fk-person-emoji">{p.emoji}</span>
                    <span className="fk-person-name">{p.name}</span>
                    {p.uid === pickUid && <span className="fk-person-flag">👉 suspect</span>}
                  </button>
                ))}
            </div>
            <button
              className={`btn btn-gold btn-lg btn-full fk-lock-btn ${picked ? 'fx-pulse' : ''}`}
              disabled={!picked}
              onClick={() => picked && submitInput({ action: 'vote', value: picked.uid })}
            >
              {picked ? `🔒 LOCK IN ${picked.name.toUpperCase()}` : 'PICK A SUSPECT'}
            </button>
            <p className="fk-help">
              change your mind as much as you like — until you lock. No timer. It takes <b>{need} votes</b> on one
              player (everyone but them) to convict.
            </p>
          </>
        )}

        <Roster
          players={players}
          done={(u) => typeof votes[u] === 'string'}
          meUid={me.uid}
          doneMark="🔒"
          waitMark="🤔"
        />
        <p className="muted small">
          {lockedCount}/{total} locked in
        </p>

        {isFaker && privateScreen && !myVote && (
          <p className="fk-tip">🕵️ your vote counts like anyone's — pile onto somebody innocent.</p>
        )}
      </div>
    );
  }

  /* ---------- brief: the private card. Faker gets the move, everyone else gets the prompt ---------- */
  const seen = state.seen ?? {};
  const iAmIn = !!seen[me.uid];
  return (
    <div className="gv fk">
      <RoundTag state={state} />
      {iAmIn ? (
        <>
          <div className="fk-hidden fx-float">🤐</div>
          <h2 className="fx-title">POKER FACE</h2>
          <p className="fk-help">
            The {GESTURE_MS / 1000}-second countdown starts the moment every card is read. Phones down, hands ready.
          </p>
          <Roster players={players} done={(u) => !!seen[u]} meUid={me.uid} doneMark="✅" waitMark="📖" />
          <p className="muted small">waiting for the others{secs}</p>
        </>
      ) : (
        <>
          <Peek variant={variant}>
            {isFaker ? <FakerCard mode={mode} /> : <CleanCard prompt={state.prompt} mode={mode} />}
          </Peek>
          <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
            {/* the same label on every phone — a different button would out the faker to a glance */}
            GOT IT — HIDE MY CARD 🤫
          </button>
        </>
      )}
      <TimerBar deadline={timerEndsAt} totalMs={BRIEF_MS} />
    </div>
  );
}
