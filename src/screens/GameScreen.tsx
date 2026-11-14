import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../state/AppState';
import {
  activePlayers,
  gateBlockers,
  inCurrentRound,
  isPresent,
  livePlayers,
  pacingOf,
  phaseOf,
  playerList,
  roundPlayers,
  engineOf,
  activeTimer,
  stageInputs,
  type GateBlockerState,
  type InputStatus,
  type RoomData,
} from '../types';
import { gameById } from '../games';
import { serverNow } from '../state/serverTime';
import { Button, Modal, PlayerChip } from '../components/ui';
import { Confetti } from '../components/fx';
import { THROWABLES } from '../components/Reactions';
import type { PlayerInfo } from '../engine/types';

export function GameScreen() {
  const { room, me, isAuthority, takeOverHost } = useApp();
  const [scoresOpen, setScoresOpen] = useState(false);
  if (!room) return null;
  const meta = room.meta;
  const engine = engineOf(room);
  const phase = phaseOf(room);
  const players = activePlayers(room);
  // the crown belongs to whoever holds the engine lease, not to the seat that
  // created the room — a takeover moves the authority with it
  const hostUid = engine?.lease?.uid ?? meta.ownerUid;
  const owner = room.players?.[hostUid];
  // The host phone *is* the game server, so when it's asleep or gone the room
  // can pick hosting up from here instead of waiting for a lobby nobody sees.
  const hostGone =
    meta.mode === 'party' &&
    !isAuthority &&
    !!owner &&
    !owner.local &&
    !isPresent(room, hostUid);
  // Joined mid-match: this round is already running without them.
  const waitingForNext =
    phase === 'playing' &&
    meta.mode === 'party' &&
    !!me &&
    me.left !== true &&
    !inCurrentRound(room, me.uid);
  // A paused engine is the whole screen: nobody should be tapping into a round
  // whose clock has stopped.
  const paused = !!engine?.recovery || !!engine?.fault;

  return (
    <div className="screen game-screen">
      <header className="game-head">
        <span className="round-chip">{phase === 'claim' ? 'ORDER' : `R${engine?.round ?? 0}`}</span>
        <span className="game-title">
          {(() => {
            const def =
              phase === 'playing'
                ? gameById.get(engine?.game?.type ?? '')
                : phase === 'outcome'
                  ? gameById.get(engine?.outcome?.gameId ?? engine?.game?.type ?? '')
                  : gameById.get(engine?.rotation?.[engine.gameIndex] ?? '');
            return def ? (
              <>
                {def.name}
              </>
            ) : (
              '…'
            );
          })()}
        </span>
        {hostGone && (
          <button
            className="head-btn"
            onClick={() => takeOverHost()}
            aria-label="take over as host"
            title="the host phone is away, take over the room"
          >
            👑
          </button>
        )}
        <button className="head-btn" onClick={() => setScoresOpen(true)} aria-label="scores">
          scores
        </button>
      </header>

      <main className="game-body">
        {paused ? (
          <EnginePaused room={room} />
        ) : waitingForNext ? (
          <JoiningNext />
        ) : (
          <>
            {phase === 'claim' && <ClaimView room={room} />}
            {phase === 'intro' && <IntroView room={room} />}
            {phase === 'playing' && <PlayingView room={room} />}
            {phase === 'outcome' && <OutcomeView room={room} />}
          </>
        )}
      </main>

      {scoresOpen && <ScoresModal onClose={() => setScoresOpen(false)} players={players} />}
    </div>
  );
}

/**
 * The engine stopped itself. Either a deadline came due while the host was
 * away for too long (a recovery pause — Resume re-times the countdown), or a
 * commit failed and nothing may run until the room is reconciled.
 */
function EnginePaused({ room }: { room: RoomData }) {
  const { isAuthority, engineCommand } = useApp();
  const engine = engineOf(room);
  const recovery = engine?.recovery;
  const fault = engine?.fault;

  if (fault) {
    return (
      <div className="engine-pause engine-fault">
        <div className="gate-card">
          <div className="gate-emoji">🧯</div>
          <h2>The game stopped</h2>
          <p className="muted small">
            A save to the room failed, so the game has stopped where it was. Nothing was lost.
          </p>
          <p className="engine-detail">{fault.message}</p>
          {isAuthority ? (
            <Button variant="gold" size="lg" full onClick={() => engineCommand({ type: 'retry' })}>
              Try again
            </Button>
          ) : (
            <p className="muted small">Waiting on the host to restart it.</p>
          )}
        </div>
      </div>
    );
  }

  if (!recovery) return null;
  const seconds = Math.round(Math.max(1, recovery.durationMs) / 1000);
  return (
    <div className="engine-pause">
      <div className="gate-card">
        <div className="gate-emoji">⏸</div>
        <h2>The round paused</h2>
        <p className="muted small">
          {recovery.message}, so the {seconds}s timer ran out with nobody watching. Resume
          starts it again from the top.
        </p>
        {isAuthority ? (
          <Button variant="gold" size="lg" full onClick={() => engineCommand({ type: 'resume' })}>
            Resume
          </Button>
        ) : (
          <p className="muted small">Waiting on the host to resume.</p>
        )}
      </div>
    </div>
  );
}

/** You walked in halfway through a round — you're in the room, up next game. */
function JoiningNext() {
  const { room } = useApp();
  const engine = room ? engineOf(room) : null;
  const nextDef = gameById.get(engine?.rotation?.[engine.gameIndex] ?? '');
  return (
    <div className="gate">
      <div className="gate-card">
        <h2>You're in</h2>
        <h1>Next game</h1>
        <p className="muted small">
          {nextDef ? `${nextDef.emoji} ${nextDef.name} is playing right now. ` : ''}
          This round started without you. You're in from the next one.
        </p>
      </div>
    </div>
  );
}

/* ============ claim: the one-time turn-order ceremony ============ */

function ClaimView({ room }: { room: RoomData }) {
  const { me, claimTurn, isAuthority, hostSkipRound } = useApp();
  const meta = room.meta;
  const engine = engineOf(room);
  const players = activePlayers(room);
  const nextDef = gameById.get(engine?.rotation?.[engine.gameIndex] ?? '');
  const order = engine?.turnOrder ?? [];
  const ordered = order
    .map((uid) => players.find((p) => p.uid === uid))
    .filter((p): p is PlayerInfo => !!p);
  // only an awake phone can claim — a dark screen doesn't hold the ceremony up
  const pending = livePlayers(room).filter((p) => !order.includes(p.uid));
  const isFirstSlot = order.length === 0;
  const iAmIn = !!me && order.includes(me.uid);

  return (
    <div className="claim">
      <p className="claim-upnext">
        First up:{' '}
        <span className="claim-game">
          {nextDef?.emoji} {nextDef?.name}
        </span>
      </p>
      <h2 className="fx-title">{isFirstSlot ? 'Who goes first?' : 'Who goes next?'}</h2>

      <div className="claim-order">
        {ordered.map((p, i) => (
          <span key={p.uid} className="claim-order-item">
            {i > 0 && <span className="claim-order-arrow">→</span>}
            <span className="claim-order-pos">{i + 1}</span> {p.emoji} {p.name}
          </span>
        ))}
        {ordered.length === 0 && <span className="muted">Nobody yet.</span>}
      </div>

      {meta.mode === 'shared' ? (
        <>
          <p className="muted">Tap a player to give them spot {order.length + 1}</p>
          <div className="claim-grid">
            {pending.map((p) => (
              <PlayerChip key={p.uid} player={p} onClick={() => claimTurn(p.uid)} />
            ))}
          </div>
        </>
      ) : pending.length === 0 ? (
        <p className="muted">Order's set.</p>
      ) : !me ? (
        <p className="muted">You're not in this room. Reload to take a seat.</p>
      ) : iAmIn ? (
        <p className="muted">You're number {order.indexOf(me.uid) + 1}. Waiting on the rest.</p>
      ) : (
        <Button variant="claim" size="lg" full className="claim-btn" onClick={() => claimTurn()}>
          {isFirstSlot ? 'Me first' : "I'm next"}
        </Button>
      )}

      {isAuthority && pending.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => hostSkipRound()}>
          {ordered.length > 0 ? 'lock order & start' : 'start with first player'}
        </Button>
      )}
    </div>
  );
}

/* ============ intro splash ============ */

function IntroView({ room }: { room: RoomData }) {
  const { isAuthority, hostSkipRound } = useApp();
  const engine = engineOf(room);
  const def = gameById.get(engine?.rotation?.[engine.gameIndex] ?? '');
  if (!def) return null;
  // Same pacing rule as the outcome screen: the splash parks on the ready
  // gate until the table says go (or the host runs the room themselves).
  const pacing = pacingOf(room.meta.settings);
  const wild = engine?.wild ?? null;
  const spot = engine?.spot ?? null;
  const spotName = spot ? (room.players?.[spot.uid]?.name ?? 'Someone') : null;
  return (
    <div className="intro">
      {wild && (
        <div className="wild-card" key={wild.id}>
          <span className="wild-card-kicker">Wild card</span>
          <h2 className="wild-card-title">{wild.title}</h2>
          <p className="wild-card-text">{wild.text}</p>
        </div>
      )}
      {spot && (
        <div className="spot-strip">
          <span className="fx-tag fx-tag-red">On the spot</span>
          <p>
            <b>{spotName}</b> has had it easy
            {spot.picked ? ' and picked this game' : ''}. Their drinks count double.
          </p>
        </div>
      )}
      <div className="intro-card fx-paper" key={def.id}>
        <span className="fx-tag">Game {engine?.round ?? 1}</span>
        <div className="intro-emoji">{def.emoji}</div>
        <h1 className="intro-name">{def.name}</h1>
        <p className="intro-rules">{def.rules}</p>
      </div>
      {pacing === 'manual' ? (
        isAuthority ? (
          <Button variant="gold" size="lg" onClick={() => hostSkipRound()}>
            Start
          </Button>
        ) : (
          <p className="muted">The host starts when everyone has read this.</p>
        )
      ) : (
        <ReadyGate room={room} intro />
      )}
    </div>
  );
}

/* ============ playing: renders the game plugin's View ============ */

function PlayingView({ room }: { room: RoomData }) {
  const { me, submitInput, isAuthority, hostSkipRound, inputStatus } = useApp();
  const engine = engineOf(room);
  const game = engine?.game ?? null;
  const def = gameById.get(game?.type ?? '');
  // this round's roster, not the room: a phone that died mid-round keeps its
  // seat, and anyone who joined mid-round plays from the next game
  const players = roundPlayers(room);
  const variant = room.meta.mode;
  // Only the inputs of the stage on screen: a submission from the phase before
  // can no longer make a phone look "answered" in this one.
  const inputs = useMemo(() => stageInputs(room), [room]);
  const answeredUids = useMemo(() => [...new Set(inputs.map((v) => v.forUid ?? v.uid))], [inputs]);
  // A deadline is only ever drawn for the round and phase on screen.
  const timerEndsAt = activeTimer(room)?.endsAt ?? null;
  const actorUid = engine?.actorUid ?? null;
  const stageKey = engine?.stageKey ?? null;

  if (!def) return null;
  if (players.length === 0) {
    // everyone this round was playing has been taken out of the room — the
    // host is the only one who can move the table on
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="gate-emoji">🫥</div>
          <h2>Nobody left in this round</h2>
          {isAuthority ? (
            <Button variant="gold" size="lg" full onClick={() => hostSkipRound()}>
              skip this game
            </Button>
          ) : (
            <p className="muted small">waiting for the host…</p>
          )}
        </div>
      </div>
    );
  }

  // actor-only games in shared mode: the phone goes straight to the actor
  if (variant === 'shared' && def.sharedInput === 'actor') {
    const actor = players.find((p) => p.uid === actorUid) ?? players[0];
    return (
      <div className="playing-wrap">
        <SendState status={inputStatus(stageKey, actor.uid)} />
        <def.View
          state={game?.state ?? {}}
          me={actor}
          players={players}
          actorUid={actorUid}
          isActor={true}
          isAuthority={isAuthority}
          myInput={latestInput(inputs, actor.uid)}
          answeredUids={answeredUids}
          timerEndsAt={timerEndsAt}
          submitInput={(input: unknown) => submitInput(input, actor.uid)}
          variant="shared"
        />
        {isAuthority && (
          <Button variant="ghost" size="sm" onClick={() => hostSkipRound()}>
            skip this game
          </Button>
        )}
      </div>
    );
  }

  if (variant === 'shared') {
    // A game with a turn order of its own names the holder (Poison passes the
    // phone poisoner to poisoner); otherwise the phone simply moves on to the
    // next player who hasn't acted yet. Nobody left to wait for → no gate.
    const declaredUid = game
      ? def.sharedHolderUid?.(game.state, { players, actorUid })
      : undefined;
    const declared = declaredUid ? (players.find((p) => p.uid === declaredUid) ?? null) : null;
    const awaiting = players.filter((p) => !answeredUids.includes(p.uid));
    const holder = declared ?? awaiting[0] ?? players[0];
    return (
      <div className="playing-wrap">
        <SharedGate
          player={declared ?? awaiting[0] ?? null}
          answeredCount={answeredUids.length}
          total={players.length}
        >
          {() => (
            <>
              <SendState status={inputStatus(stageKey, holder.uid)} />
              <def.View
                state={game?.state ?? {}}
                me={holder}
                players={players}
                actorUid={actorUid}
                isActor={holder.uid === actorUid}
                isAuthority={isAuthority}
                myInput={latestInput(inputs, holder.uid)}
                answeredUids={answeredUids}
                timerEndsAt={timerEndsAt}
                submitInput={(input: unknown) => submitInput(input, holder.uid)}
                variant="shared"
              />
            </>
          )}
        </SharedGate>
        {isAuthority && (
          <Button variant="ghost" size="sm" onClick={() => hostSkipRound()}>
            skip this game
          </Button>
        )}
      </div>
    );
  }

  if (!me) {
    // the host cleared this seat while its phone was sitting here watching
    return (
      <div className="gate">
        <div className="gate-card">
          <div className="gate-emoji">🫥</div>
          <h2>You're not in this room</h2>
          <p className="muted small">
            The host removed your seat. Reload to come back in from the next game.
          </p>
          <Button variant="gold" size="lg" full onClick={() => location.reload()}>
            rejoin
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="playing-wrap">
      <SendState status={inputStatus(stageKey, me.uid)} />
      <def.View
        state={game?.state ?? {}}
        me={me}
        players={players}
        actorUid={actorUid}
        isActor={me.uid === actorUid}
        isAuthority={isAuthority}
        myInput={latestInput(inputs, me.uid)}
        answeredUids={answeredUids}
        timerEndsAt={timerEndsAt}
        submitInput={(input: unknown) => submitInput(input)}
        variant="party"
      />
      {isAuthority && (
        <Button variant="ghost" size="sm" onClick={() => hostSkipRound()}>
          skip this game
        </Button>
      )}
    </div>
  );
}

function latestInput(inputs: ReturnType<typeof stageInputs>, uid: string): any {
  const mine = inputs.filter((v) => (v.forUid ?? v.uid) === uid);
  return mine.length > 0 ? mine[mine.length - 1].input : null;
}

/**
 * "Sent" and "counted" are different things. A submission sits in the room
 * unacknowledged until the engine commits it with the reducer result, so the
 * phone can say which of the two it is — and say so when a tap arrived after
 * the phase it was meant for.
 */
function SendState({ status }: { status: InputStatus }) {
  if (status === 'sending') return <p className="muted small send-state">sending…</p>;
  if (status === 'rejected') {
    return <p className="muted small send-state send-rejected">Too late, that one didn't count.</p>;
  }
  return null;
}

/** Shared-phone pass-and-play gate: hides inputs until the phone is passed. */
function SharedGate({
  player,
  answeredCount,
  total,
  children,
}: {
  player: PlayerInfo | null;
  answeredCount: number;
  total: number;
  children: (holder: PlayerInfo | null) => ReactNode;
}) {
  const [unlocked, setUnlocked] = useState<string | null>(null);
  useEffect(() => {
    setUnlocked(null);
  }, [player?.uid]);

  if (!player || unlocked === player.uid) return <>{children(player)}</>;

  return (
    <div className="gate">
      <div className="gate-card">
        <p className="gate-progress">
          {answeredCount}/{total} done
        </p>
        <div className="gate-emoji">{player.emoji}</div>
        <h2>Pass the phone to</h2>
        <h1>{player.name}</h1>
        <Button variant="gold" size="lg" full onClick={() => setUnlocked(player.uid)}>
          {`I'm ${player.name}`}
        </Button>
      </div>
    </div>
  );
}

/* ============ outcome ============ */

function OutcomeView({ room }: { room: RoomData }) {
  const { isAuthority, hostSkipRound, me, throwAt, pickNextGame } = useApp();
  const [aim, setAim] = useState<string | null>(null);
  const engine = engineOf(room);
  const outcome = engine?.outcome;
  // names for the drink list and the recap: every seat in the room, so a player
  // who walked off mid-round is still readable on the screen that names them
  const players = playerList(room);
  if (!outcome) return null;
  // RTDB drops empty arrays — `assignments`/`groups` can read back undefined
  const assignments = outcome.assignments ?? [];
  const recapGroups = (outcome.recap?.groups ?? []).filter((g) => (g?.uids ?? []).length > 0);
  const pacing = pacingOf(room.meta.settings);
  // walked in halfway through: this round wasn't theirs, the next one is
  const joined = !!me && me.left !== true && !inCurrentRound(room, me.uid);

  // the one line every phone looks for first: what do *I* owe?
  const mine = me && !joined ? assignments.filter((a) => a.uid === me.uid) : [];
  const mySips = mine.reduce((sum, a) => sum + (a.sips ?? 0), 0);
  const personal = room.meta.mode === 'party' && !!me && !joined;
  const unit = room.meta.settings.pointsMode ? 'point' : 'sip';

  return (
    <div className="outcome">
      {personal && mySips === 0 && assignments.length > 0 && <Confetti />}
      <p className="fx-kicker">{outcome.gameName} · the tab</p>
      {personal ? (
        mySips > 0 ? (
          <div className="outcome-me outcome-me-drink">
            <span className="outcome-me-num">{mySips}</span>
            <span className="outcome-me-text">
              {unit}
              {mySips === 1 ? '' : 's'}
              <br />
              for you
            </span>
          </div>
        ) : (
          <div className="outcome-me outcome-me-safe">
            <span className="outcome-me-num">0</span>
            <span className="outcome-me-text">
              nothing
              <br />
              for you
            </span>
          </div>
        )
      ) : (
        <h2 className="fx-title">Who drinks</h2>
      )}

      {outcome.roast && <p className="roast">{outcome.roast}</p>}
      {outcome.wild && (
        <p className="outcome-wild">
          <span className="fx-tag">{outcome.wild.title}</span>
          {outcome.wild.did && <span>{outcome.wild.did}</span>}
        </p>
      )}

      {joined && (
        <p className="muted small">
          That round ran without you. You're in from the next game.
        </p>
      )}

      {recapGroups.length > 0 && (
        <div className="outcome-recap">
          {outcome.recap?.title && <p className="outcome-recap-title">{outcome.recap.title}</p>}
          {recapGroups.map((g, i) => (
            <div key={`${g.label}-${i}`} className={`recap-group recap-${g.tone ?? 'neutral'}`}>
              <span className="recap-label">{g.label}</span>
              <span className="recap-names">
                {g.uids.map((uid) => {
                  const p = players.find((x) => x.uid === uid);
                  return p ? (
                    <span key={uid} className="recap-chip">
                      {p.emoji} {p.name}
                    </span>
                  ) : null;
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="outcome-list">
        {assignments.length === 0 && (
          <p className="outcome-none">{outcome.note || 'Nobody drinks. Enjoy it.'}</p>
        )}
        {assignments.map((a, i) => {
          const p = players.find((x) => x.uid === a.uid);
          if (!p) return null;
          const canThrow = personal && !!me && a.uid !== me.uid;
          return (
            <div
              key={`${a.uid}-${i}`}
              className={`outcome-row ${me && a.uid === me.uid && personal ? 'outcome-row-me' : ''} ${canThrow ? 'outcome-row-tap' : ''}`}
              style={{ animationDelay: `${0.15 + i * 0.12}s` }}
              onClick={canThrow ? () => setAim(aim === a.uid ? null : a.uid) : undefined}
            >
              <span className="outcome-who">
                {p.emoji} {p.name}
                {outcome.spotUid === a.uid && <span className="outcome-x2">x2</span>}
              </span>
              <span className="outcome-sips">{a.sips}</span>
              <span className="outcome-reason">{a.reason}</span>
            </div>
          );
        })}
      </div>
      {outcome.note && assignments.length > 0 && <p className="outcome-note">{outcome.note}</p>}

      {personal && me && (
        <ThrowBar
          players={players.filter((p) => p.uid !== me.uid && p.left !== true)}
          aim={aim}
          onAim={setAim}
          onThrow={(uid, kind) => {
            void throwAt(uid, kind);
            setAim(null);
          }}
        />
      )}

      <NextPick room={room} onPick={pickNextGame} />
      {pacing === 'manual' ? (
        isAuthority ? (
          <Button variant="gold" size="lg" onClick={() => hostSkipRound()}>
            Next game
          </Button>
        ) : (
          <p className="muted">The host moves on when everyone's ready.</p>
        )
      ) : (
        <ReadyGate room={room} />
      )}
    </div>
  );
}

/** Pick someone, pick something, throw it. It lands on their phone. */
function ThrowBar({
  players,
  aim,
  onAim,
  onThrow,
}: {
  players: PlayerInfo[];
  aim: string | null;
  onAim: (uid: string | null) => void;
  onThrow: (uid: string, kind: string) => void;
}) {
  if (players.length === 0) return null;
  const target = players.find((p) => p.uid === aim) ?? null;
  return (
    <div className="throw">
      <p className="fx-kicker">{target ? `Throw what at ${target.name}?` : 'Throw something at'}</p>
      {target ? (
        <div className="throw-row">
          {THROWABLES.map((t) => (
            <button key={t.kind} className="throw-thing" onClick={() => onThrow(target.uid, t.kind)}>
              <span className="throw-thing-emoji">{t.emoji}</span>
              <span>{t.label}</span>
            </button>
          ))}
          <button className="throw-cancel" onClick={() => onAim(null)}>
            never mind
          </button>
        </div>
      ) : (
        <div className="throw-row">
          {players.map((p) => (
            <button key={p.uid} className="throw-who" onClick={() => onAim(p.uid)}>
              {p.emoji} {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The lightweight rule, on the drinks screen: whoever has had it easiest picks
 * the next game and drinks double in it. Everyone sees who; only that player
 * (or the one shared phone) gets the buttons. No pick by the time the table is
 * ready just means the rotation carries on, with them still on the spot.
 */
function NextPick({
  room,
  onPick,
}: {
  room: RoomData;
  onPick: (gameId: string, forUid?: string) => Promise<void>;
}) {
  const { me, isAuthority } = useApp();
  const engine = engineOf(room);
  const pickerUid = engine?.next?.pickerUid ?? null;
  if (!pickerUid || !engine?.gate) return null;
  const picker = room.players?.[pickerUid];
  if (!picker) return null;
  const shared = room.meta.mode === 'shared';
  const mine = shared ? isAuthority : me?.uid === pickerUid;
  const pick = room.social?.pick;
  const chosen = pick && pick.uid === pickerUid && pick.gateId === engine.gate.id ? pick.gameId : null;
  const table = livePlayers(room).length;
  const enabled = room.meta.settings.enabledGames ?? [];
  const options = enabled
    .map((id) => gameById.get(id))
    .filter((g): g is NonNullable<typeof g> => !!g && g.minPlayers <= table);
  const chosenDef = chosen ? gameById.get(chosen) : null;

  return (
    <div className="nextpick">
      <span className="fx-tag fx-tag-red">On the spot</span>
      <p className="nextpick-line">
        <b>{mine && !shared ? 'You have' : `${picker.name} has`}</b> had it easy.{' '}
        {mine && !shared ? 'You pick' : `${picker.name} picks`} the next game and{' '}
        {mine && !shared ? 'drink' : 'drinks'} double in it.
      </p>
      {mine ? (
        <div className="nextpick-grid">
          {options.map((g) => (
            <button
              key={g.id}
              className={`nextpick-game ${chosen === g.id ? 'on' : ''}`}
              onClick={() => void onPick(g.id, pickerUid)}
            >
              <span>{g.emoji}</span> {g.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted small">
          {chosenDef ? `Picked: ${chosenDef.name}.` : `Waiting on ${picker.name} to choose.`}
        </p>
      )}
    </div>
  );
}

/**
 * The ready gate: nothing moves on until every phone the gate was opened for
 * has tapped Ready.
 *
 * The gate belongs to the engine, not to whoever happened to be connected at
 * render time: it snapshotted its required players when it opened, so a Wi-Fi
 * blip can neither release it early nor remove a phone from it. A required
 * phone that drops shows as *reconnecting* and keeps holding the gate for a
 * grace period; past that it stops counting, and the host always has the
 * explicit "continue without them". A gate nobody is holding is never a green
 * light — somebody has to say so out loud.
 */
function ReadyGate({ room, intro = false }: { room: RoomData; intro?: boolean }) {
  const { me, setReady, isAuthority, hostSkipRound } = useApp();
  const engine = engineOf(room);
  const gate = engine?.gate ?? null;
  const ready = engine?.ready ?? {};
  const now = serverNow();
  const blockers = gateBlockers(room, now);
  const byUid = new Map(playerList(room).map((p) => [p.uid, p] as const));
  const required = (gate?.uids ?? [])
    .map((uid) => byUid.get(uid))
    .filter((p): p is PlayerInfo => !!p);
  const players = required.length > 0 ? required : livePlayers(room);
  const stateOf = (uid: string): GateBlockerState | null =>
    blockers.find((b) => b.uid === uid)?.state ?? null;
  const waiting = blockers.filter((b) => b.state === 'waiting');
  const reconnecting = blockers.filter((b) => b.state === 'reconnecting');
  const away = blockers.filter((b) => b.state === 'away');
  const readyCount = players.length - blockers.length;
  const allReady = blockers.length === 0 && players.length > 0;
  const iAmReady = !!me && !!gate && ready[me.uid] === gate.id;
  // one phone, one tap — only the lease holder is allowed to flag everyone
  const readyEveryone = room.meta.mode === 'shared' && isAuthority;
  const nameOf = (uid: string) => byUid.get(uid)?.name ?? '?';
  const copy = intro
    ? {
        allReady: 'Everyone is in. Here we go.',
        readyAll: 'We get it, go',
        ready: 'Got it',
      }
    : {
        allReady: 'Everyone is in. Next game coming.',
        readyAll: 'Next game',
        ready: 'Next game',
      };

  if (!gate) return null;

  return (
    <div className="ready">
      <div className="ready-chips">
        {players.map((p) => {
          const state = stateOf(p.uid);
          const isReady = ready[p.uid] === gate.id;
          const mark = isReady ? '✔' : state === 'reconnecting' ? '📶' : state === 'away' ? '📴' : '…';
          const cls = isReady
            ? 'ready-on'
            : state === 'reconnecting'
              ? 'ready-reconnecting'
              : state === 'away'
                ? 'ready-away'
                : '';
          return (
            <span key={p.uid} className={`ready-chip ${cls}`}>
              <span className="ready-chip-emoji">{p.emoji}</span>
              <span className="ready-chip-name">{p.name}</span>
              <span className="ready-chip-mark">{mark}</span>
            </span>
          );
        })}
      </div>
      <p className="ready-count">
        {allReady ? copy.allReady : `${readyCount}/${players.length} ready`}
      </p>

      {reconnecting.length > 0 && (
        <p className="muted small">
          {reconnecting.map((b) => nameOf(b.uid)).join(', ')}{' '}
          {reconnecting.length === 1 ? 'is' : 'are'} reconnecting. Giving them a moment.
        </p>
      )}
      {away.length > 0 && (
        <p className="muted small">
          {away.map((b) => nameOf(b.uid)).join(', ')}{' '}
          {away.length === 1 ? 'has' : 'have'} been gone a while. Not waiting on them.
        </p>
      )}

      {allReady ? null : readyEveryone ? (
        <Button
          variant="gold"
          size="lg"
          full
          onClick={() => setReady(true, players.map((p) => p.uid))}
        >
          {copy.readyAll}
        </Button>
      ) : iAmReady ? (
        <>
          <p className="muted small">
            waiting on {blockers.map((b) => nameOf(b.uid)).join(', ')}…
          </p>
          <Button variant="ghost" size="sm" onClick={() => setReady(false)}>
            not ready yet
          </Button>
        </>
      ) : (
        <Button variant="gold" size="lg" full onClick={() => setReady(true)}>
          {copy.ready}
        </Button>
      )}

      {isAuthority && !allReady && (
        <Button variant="ghost" size="sm" onClick={() => hostSkipRound()}>
          {reconnecting.length > 0 || away.length > 0
            ? 'Go without them'
            : 'Go without them'}
        </Button>
      )}
      {waiting.length > 0 && (
        <p className="muted small">
          {waiting.map((b) => nameOf(b.uid)).join(', ')} still {waiting.length === 1 ? 'has' : 'have'}{' '}
          to tap
        </p>
      )}
    </div>
  );
}

/* ============ scores ============ */

function ScoresModal({ onClose, players }: { onClose: () => void; players: PlayerInfo[] }) {
  const { isAuthority, resetDrinks, finishNight, leaveRoom } = useApp();
  const sorted = [...players].sort((a, b) => b.drinkCount - a.drinkCount);
  const most = Math.max(1, ...sorted.map((p) => p.drinkCount));
  const medal = (i: number) => `${i + 1}.`;
  return (
    <Modal title="The tab" onClose={onClose}>
      <div className="scores-list">
        {sorted.map((p, i) => (
          <div
            key={p.uid}
            className={`scores-row ${i === 0 && p.drinkCount > 0 ? 'scores-lead' : ''}`}
            style={{ ['--fill' as string]: `${(p.drinkCount / most) * 100}%`, animationDelay: `${i * 0.06}s` }}
          >
            <span className="scores-place">{medal(i)}</span>
            <span className="scores-name">
              {p.emoji} {p.name} {!p.connected && !p.local && <span className="muted">(away)</span>}
            </span>
            <span className="scores-val">{p.drinkCount}</span>
          </div>
        ))}
      </div>
      <div className="scores-actions">
        {isAuthority && (
          <>
            <Button variant="ghost" size="sm" onClick={() => resetDrinks()}>
              reset counts
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                finishNight();
                onClose();
              }}
            >
              end the night
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={() => leaveRoom()}>
          leave
        </Button>
      </div>
    </Modal>
  );
}
