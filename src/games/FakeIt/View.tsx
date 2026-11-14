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
    <button className="fk-cardback" {...hold}>
      <span className="fk-cardback-title">Hold to peek</span>
      <span className="fk-cardback-sub">Check nobody is looking first.</span>
    </button>
  );
}

/** Which round, and the move the table is playing all game. */
function RoundTag({ state }: { state: FkState }) {
  const mode = MODES[state.mode] ?? MODES.numbers;
  const rounds = roundsOf(state);
  return (
    <div className="fk-head">
      <span className="fk-head-round">
        Round {state.roundNo} of {ROUNDS_COUNT}
      </span>
      <span className="fk-pips" aria-hidden="true">
        {Array.from({ length: ROUNDS_COUNT }, (_, i) => {
          const rec = rounds.find((r) => r.roundNo === i + 1);
          const cls = rec ? 'fk-pip-done' : i + 1 === state.roundNo ? 'fk-pip-now' : '';
          return <span key={i} className={`fk-pip ${cls}`} />;
        })}
      </span>
      <span className="fk-head-mode">
        {mode.emoji} {mode.name}
      </span>
    </div>
  );
}

/** Party mode = a private screen per player, so the role can be shown outright. */
function RoleTag({ isFaker }: { isFaker: boolean }) {
  return (
    <span className={`fx-tag ${isFaker ? 'fx-tag-red' : 'fx-tag-green'}`}>
      {isFaker ? 'you are the faker' : 'you are clean'}
    </span>
  );
}

function MoveStrip({ mode, when }: { mode: ModeMeta; when?: string }) {
  return (
    <div className="fk-move">
      <span className="fk-move-emoji">{mode.emoji}</span>
      <span>
        <b>The move:</b> {mode.move}
        {when}.
      </span>
    </div>
  );
}

/** Everyone but the faker gets this. It disappears the moment the countdown starts. */
function CleanCard({ prompt, mode }: { prompt: string; mode: ModeMeta }) {
  return (
    <div className="fk-card fk-card-clean">
      <div className="fk-card-top">
        <span className="fk-card-index">Prompt</span>
        <span className="fk-card-index">Keep it secret</span>
      </div>
      <h2 className="fk-prompt">{prompt}</h2>
      <MoveStrip mode={mode} when=" on zero" />
      <p className="fk-card-hint">One player did not get this card. Answer honestly and be ready to explain it.</p>
    </div>
  );
}

/** The faker's whole round: no prompt, just the move and a cover story. */
function FakerCard({ mode }: { mode: ModeMeta }) {
  return (
    <div className="fk-card fk-card-faker">
      <div className="fk-card-top">
        <span className="fk-card-index">Faker</span>
        <span className="fk-card-index">Keep it secret</span>
      </div>
      <h2 className="fk-prompt fk-faker-line">You're the faker</h2>
      <p className="fk-noprompt">No prompt for you. Blend in.</p>
      <MoveStrip mode={mode} when=" on zero" />
      <p className="fk-card-hint">{mode.fakerHint}</p>
      <p className="fk-card-hint">
        If everyone else votes for you, you drink {CAUGHT_SIPS} and it's over. Last {ROUNDS_COUNT} rounds and they
        all drink.
      </p>
    </div>
  );
}

/** Who has done the thing this screen is waiting on. */
function Roster({
  players,
  done,
  meUid,
  doneWord,
  waitWord,
}: {
  players: Players;
  done: (uid: string) => boolean;
  meUid: string;
  doneWord: string;
  waitWord: string;
}) {
  return (
    <div className="fk-roster">
      {players.map((p) => {
        const ok = done(p.uid);
        return (
          <div key={p.uid} className={`fk-seat ${ok ? 'fk-seat-ok' : ''}`}>
            <span className="fk-seat-who">
              {p.emoji} {p.name}
              {p.uid === meUid ? ' (you)' : ''}
            </span>
            <span className="fk-seat-mark">{ok ? doneWord : waitWord}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The flipped ballots: every suspect, who named them, and how close that was to a conviction. */
function Tally({ record, players, stamp }: { record: FkRoundRecord; players: Players; stamp?: ReactNode }) {
  const votes = record.votes ?? {};
  const need = votesNeeded(players.length);
  const rows = players
    .map((p) => ({ p, voters: players.filter((v) => votes[v.uid] === p.uid) }))
    .filter((r) => r.voters.length > 0)
    .sort((a, b) => b.voters.length - a.voters.length);
  return (
    <div className="fx-paper fk-tally">
      <div className="fk-tally-head">
        <span>Votes</span>
        <span>needs {need}</span>
      </div>
      {rows.map(({ p, voters }, i) => {
        const hit = voters.length >= need;
        return (
          <div
            key={p.uid}
            className={`fk-tally-row fx-rise ${hit ? 'fk-tally-hit' : ''}`}
            style={{ animationDelay: `${0.15 + i * 0.25}s` }}
          >
            <span className="fk-tally-who">
              {p.emoji} {p.name}
            </span>
            <span className="fk-tally-voters">
              {voters.map((v) => (
                <span key={v.uid} title={v.name}>
                  {v.emoji}
                </span>
              ))}
            </span>
            <span className="fk-tally-n">{voters.length}</span>
          </div>
        );
      })}
      {rows.length === 0 && <p className="fk-tally-empty">No votes were cast.</p>}
      {stamp && <div className="fk-tally-stamp">{stamp}</div>}
    </div>
  );
}

function RoundsRecap({ state, players }: { state: FkState; players: Players }) {
  const rounds = roundsOf(state);
  if (rounds.length === 0) return null;
  return (
    <div className="fk-rounds">
      {rounds.map((r) => (
        <div key={r.roundNo} className="fk-round">
          <span className={`fk-round-no ${r.result === 'caught' ? 'fk-round-hit' : ''}`}>{r.roundNo}</span>
          <div>
            <div className="fk-round-prompt">{r.prompt}</div>
            <div className="fk-round-acc">
              {r.result === 'caught'
                ? `Caught. Everyone named ${nameOf(players, r.accusedUid)}.`
                : r.result === 'innocent'
                  ? `Got away. The table convicted ${nameOf(players, r.accusedUid)}, who was innocent.`
                  : 'Got away. Split vote.'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The faker's face on a card, with the verdict stamped across it. */
function Mugshot({ player, stamp }: { player: PlayerInfo | undefined; stamp: ReactNode }) {
  return (
    <div className="fk-mug fx-pop">
      <span className="fk-mug-label">The faker</span>
      <span className="fk-mug-emoji">{player?.emoji ?? '?'}</span>
      <span className="fk-mug-name">{player?.name ?? '?'}</span>
      <span className="fk-mug-stamp">{stamp}</span>
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
  const secsLeftAny = left != null ? Math.ceil(left / 1000) : null;
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
  const fakerName = faker?.name ?? 'The faker';

  // the suspect I've ticked but not locked in yet — local until LOCK IN
  const [pickUid, setPickUid] = useState<string | null>(null);
  useEffect(() => {
    setPickUid(null);
  }, [state.roundNo, phase, me.uid]);

  /* ---------- CAUGHT: said out loud, right now, and the game is over ---------- */
  const caught = lastRound?.result === 'caught';
  if (caught && (phase === 'verdict' || phase === 'done' || phase === 'unmask')) {
    const getaways = rounds.length - 1;
    return (
      <div className="gv fk">
        <Confetti />
        <p className="fx-kicker">
          Round {lastRound.roundNo} · {need} of {need} votes
        </p>
        <Mugshot player={faker} stamp={<span className="fx-stamp fk-stamp-late">CAUGHT!</span>} />
        <div className="fk-tab">
          <p>
            <b>{fakerName}</b> drinks {CAUGHT_SIPS}.
          </p>
          {getaways > 0 && (
            <p>
              Everyone else drinks {getaways * FOOLED_SIPS} for the {getaways === 1 ? 'round' : 'rounds'} {fakerName}{' '}
              got away with.
            </p>
          )}
        </div>
        <Tally record={lastRound} players={players} />
        <RoundsRecap state={state} players={players} />
        <p className="fk-foot">Game over. There are no more rounds.</p>
      </div>
    );
  }

  /* ---------- unmask / done: nobody ever caught them ---------- */
  if (phase === 'unmask' || phase === 'done') {
    const n = rounds.length || ROUNDS_COUNT;
    return (
      <div className="gv fk">
        <Confetti />
        <p className="fx-kicker">The faker all along</p>
        <Mugshot player={faker} stamp={<span className="fx-stamp fk-stamp-ink fk-stamp-late">GOT AWAY</span>} />
        <div className="fk-tab">
          <p>
            <b>{fakerName}</b> faked {n} rounds and drinks nothing.
          </p>
          <p>Everyone else drinks {n * FOOLED_SIPS}.</p>
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
        <Tally
          record={lastRound}
          players={players}
          stamp={
            innocent ? (
              <span className="fx-stamp fx-stamp-good fk-stamp-late">INNOCENT</span>
            ) : (
              <span className="fx-stamp fk-stamp-ink fk-stamp-late">GOT AWAY</span>
            )
          }
        />
        <div className="fk-tab">
          {innocent ? (
            <p>
              <b>{accused?.name ?? 'They'}</b> was innocent. Wrong player, so the faker got away.
            </p>
          ) : (
            <p>
              Nobody got {need} votes, so the faker got away.
            </p>
          )}
          <p>Everyone but the faker owes {FOOLED_SIPS}. It goes on the tab until the faker is out.</p>
        </div>
        <p className="fk-foot">
          {finalRound ? 'Last round done. Unmasking' : `Round ${state.roundNo + 1}`}
          {secsLeftAny != null ? ` in ${secsLeftAny}` : ''}
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
        <div className="fk-poster">
          <BigCount n={secsLeft} hotAt={2} />
        </div>
        <div className="fk-go">
          <span className="fk-go-emoji">{mode.emoji}</span>
          <span className="fk-go-text">{mode.move}</span>
        </div>
        <TimerBar deadline={timerEndsAt} totalMs={GESTURE_MS} />
        <p className="fk-help">Phones down. Move on zero and hold it.</p>
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
        <div className="fk-title-row">
          <h2 className="fx-title fx-title-gold">Freeze</h2>
          {privateScreen && <RoleTag isFaker={isFaker} />}
        </div>
        <div className="fk-card fk-card-clean fk-card-flat">
          <div className="fk-card-top">
            <span className="fk-card-index">The prompt</span>
            <span className="fk-card-index">{isFaker && privateScreen ? 'New to you' : 'Public now'}</span>
          </div>
          <h2 className="fk-prompt">{state.prompt}</h2>
          <div className="fk-move">
            <span className="fk-move-emoji">{mode.emoji}</span>
            <span>{mode.how}.</span>
          </div>
        </div>
        <p className="fk-help">
          <b>Argue it out.</b> One of you moved without reading that. Whose answer makes no sense?
          {isFaker && privateScreen ? ' Not yours, obviously. Make someone else explain theirs.' : ''}
        </p>
        <TimerBar deadline={timerEndsAt} totalMs={REVEAL_MS} />
        {!shared && (
          <Roster players={players} done={(u) => !!argued[u]} meUid={me.uid} doneWord="ready" waitWord="talking" />
        )}
        {shared || !iAmReady ? (
          <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
            {shared ? 'GO TO THE VOTE' : 'READY TO VOTE'}
          </button>
        ) : (
          <p className="fk-foot">Voting opens when everyone is ready.</p>
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
        <div className="fx-paper fk-ballot">
          <div className="fk-ballot-head">
            <span>Ballot</span>
            <span>{need} votes convict</span>
          </div>
          <h2 className="fk-ballot-q">Who's faking it?</h2>
          <p className="fk-ballot-prompt">
            {mode.emoji} {state.prompt}
          </p>
          {myVote ? (
            <div className="fk-locked">
              <span className="fx-stamp fk-stamp-ink">LOCKED</span>
              {/* a private screen can show your own ballot back to you; a shared one can't */}
              <p className="fk-locked-name">
                {privateScreen ? `You named ${nameOf(players, myVote)}.` : 'Your ballot is sealed.'}
              </p>
            </div>
          ) : (
            <div className="fk-people">
              {players
                .filter((p) => p.uid !== me.uid)
                .map((p) => (
                  <button
                    key={p.uid}
                    className={`fk-person ${p.uid === pickUid ? 'fk-person-on' : ''}`}
                    aria-pressed={p.uid === pickUid}
                    onClick={() => setPickUid(p.uid === pickUid ? null : p.uid)}
                  >
                    <span className="fk-box" />
                    <span className="fk-person-emoji">{p.emoji}</span>
                    <span className="fk-person-name">{p.name}</span>
                  </button>
                ))}
            </div>
          )}
        </div>

        {!myVote && (
          <>
            <button
              className="btn btn-gold btn-lg btn-full"
              disabled={!picked}
              onClick={() => picked && submitInput({ action: 'vote', value: picked.uid })}
            >
              {picked ? `LOCK IN ${picked.name.toUpperCase()}` : 'PICK A SUSPECT'}
            </button>
            <p className="fk-help">
              No timer. Change your tick as often as you like, but a locked vote is final.
              {isFaker && privateScreen ? ' Your vote counts too, so pile onto someone.' : ''}
            </p>
          </>
        )}

        <Roster
          players={players}
          done={(u) => typeof votes[u] === 'string'}
          meUid={me.uid}
          doneWord="locked"
          waitWord="thinking"
        />
        <p className="fk-foot">
          {lockedCount}/{total} locked in. Votes flip when the last one locks.
        </p>
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
          <h2 className="fx-title">Poker face</h2>
          <p className="fk-help">
            The {GESTURE_MS / 1000}-second count starts when the last card is read. Phone down, hands ready.
          </p>
          <Roster players={players} done={(u) => !!seen[u]} meUid={me.uid} doneWord="read" waitWord="reading" />
        </>
      ) : (
        <>
          <Peek variant={variant}>
            {isFaker ? <FakerCard mode={mode} /> : <CleanCard prompt={state.prompt} mode={mode} />}
          </Peek>
          {/* the same label on every phone: a different button would out the faker to a glance */}
          <button className="btn btn-gold btn-lg btn-full" onClick={() => submitInput({ action: 'ready' })}>
            GOT IT
          </button>
        </>
      )}
      <TimerBar deadline={timerEndsAt} totalMs={BRIEF_MS} />
    </div>
  );
}
