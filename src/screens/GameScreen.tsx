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
          {phase === 'playing' || phase === 'outcome'
            ? (gameById.get(engine?.game?.type ?? '')?.name ?? '…')
            : (gameById.get(engine?.rotation?.[engine.gameIndex] ?? '')?.name ?? '…')}
        </span>
        {hostGone && (
          <button
            className="head-btn"
            onClick={() => takeOverHost()}
            aria-label="take over as host"
            title="the host phone is away — take over the room"
          >
            👑
          </button>
        )}
        <button className="head-btn" onClick={() => setScoresOpen(true)} aria-label="scores">
          📊
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
          <h2>The game engine stopped</h2>
          <p className="muted small">
            A write to the room failed, so nothing authoritative has moved since — no phase runs on
            top of an unconfirmed one.
          </p>
          <p className="engine-detail">{fault.message}</p>
          {isAuthority ? (
            <Button variant="gold" size="lg" full onClick={() => engineCommand({ type: 'retry' })}>
              reconcile & resume ▶
            </Button>
          ) : (
            <p className="muted small">waiting for the host to reconcile it…</p>
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
          {recovery.message}, so the {seconds}s countdown finished with nobody watching. The table
          paused instead of skipping ahead — Resume starts a <b>fresh</b> {seconds}s countdown.
        </p>
        {isAuthority ? (
          <Button variant="gold" size="lg" full onClick={() => engineCommand({ type: 'resume' })}>
            resume with a fresh countdown ▶
          </Button>
        ) : (
          <p className="muted small">waiting for the host to resume…</p>
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
        <div className="gate-emoji">🍻</div>
        <h2>You're in!</h2>
        <h1>Up next game</h1>
        <p className="muted small">
          {nextDef ? `${nextDef.emoji} ${nextDef.name} is playing right now. ` : ''}
          This round is already under way — you'll play the next one. Tap Ready when it shows up.
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
      <h2>{isFirstSlot ? "Who's kicking things off?" : "Who's next in the order?"}</h2>

      <div className="claim-order">
        {ordered.map((p, i) => (
          <span key={p.uid} className="claim-order-item">
            {i > 0 && <span className="claim-order-arrow">→</span>}
            <span className="claim-order-pos">{i + 1}</span> {p.emoji} {p.name}
          </span>
        ))}
        {ordered.length === 0 && <span className="muted">No order yet — tap below to start it.</span>}
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
        <p className="muted">Order locked — let's go! 🍻</p>
      ) : !me ? (
        <p className="muted">You're not in this room — reload the page to take a seat.</p>
      ) : iAmIn ? (
        <p className="muted">You're in at spot {order.indexOf(me.uid) + 1} — waiting for the others…</p>
      ) : (
        <Button variant="claim" size="lg" full className="claim-btn" onClick={() => claimTurn()}>
          {isFirstSlot ? "I'LL START 🍺" : "I'M NEXT 🍻"}
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
  return (
    <div className="intro">
      <div className="intro-emoji">{def.emoji}</div>
      <h1 className="intro-name">{def.name}</h1>
      <p className="intro-rules">{def.rules}</p>
      {pacing === 'manual' ? (
        isAuthority ? (
          <Button variant="gold" size="lg" onClick={() => hostSkipRound()}>
            Start the round ▶
          </Button>
        ) : (
          <p className="muted">⏸ read up — the host starts the round</p>
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
              skip round ⏭
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
            skip round ⏭
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
            skip round ⏭
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
            The host took your seat out. Reload to walk back in — you'll play from the next game.
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
          skip round ⏭
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
  if (status === 'sending') return <p className="muted small send-state">📤 sending…</p>;
  if (status === 'rejected') {
    return <p className="muted small send-state send-rejected">⚠️ that tap didn't count — the phase had moved on</p>;
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
          {`I'm ${player.name}!`}
        </Button>
      </div>
    </div>
  );
}

/* ============ outcome ============ */

function OutcomeView({ room }: { room: RoomData }) {
  const { isAuthority, hostSkipRound, me } = useApp();
  const outcome = engineOf(room)?.outcome;
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

  return (
    <div className="outcome">
      <div className="outcome-emoji">{outcome.gameEmoji}</div>
      <h2>{outcome.gameName}</h2>

      {joined && (
        <p className="muted small">
          🍻 you're in — that round ran without you, you play the next game
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
          <p className="outcome-none">{outcome.note || 'No drinks this round 🎉'}</p>
        )}
        {assignments.map((a, i) => {
          const p = players.find((x) => x.uid === a.uid);
          if (!p) return null;
          return (
            <div key={`${a.uid}-${i}`} className="outcome-row">
              <span className="outcome-who">
                {p.emoji} {p.name}
              </span>
              <span className="outcome-sips">{'🍺'.repeat(Math.min(a.sips, 5))} ×{a.sips}</span>
              <span className="outcome-reason">{a.reason}</span>
            </div>
          );
        })}
      </div>
      {outcome.note && assignments.length > 0 && <p className="outcome-note">{outcome.note}</p>}
      {pacing === 'manual' ? (
        isAuthority ? (
          <Button variant="gold" size="lg" onClick={() => hostSkipRound()}>
            Continue ▶
          </Button>
        ) : (
          <p className="muted">⏸ paused — the host continues when everyone's ready</p>
        )
      ) : (
        <ReadyGate room={room} />
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
        allReady: "everyone's ready — here we go 🍻",
        readyAll: "EVERYONE'S READY — GO 🍻",
        ready: 'READY TO PLAY 🍻',
      }
    : {
        allReady: "everyone's ready — here comes the next game 🍻",
        readyAll: "EVERYONE'S READY 🍻",
        ready: 'READY FOR THE NEXT GAME 🍻',
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
          📶 {reconnecting.map((b) => nameOf(b.uid)).join(', ')}{' '}
          {reconnecting.length === 1 ? 'is' : 'are'} reconnecting — the gate waits a moment rather
          than taking a dropped socket for a yes
        </p>
      )}
      {away.length > 0 && (
        <p className="muted small">
          📴 {away.map((b) => nameOf(b.uid)).join(', ')}{' '}
          {away.length === 1 ? 'has' : 'have'} been dark a while — no longer holding the table up
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
            ? 'continue without them ▶'
            : 'start without them ▶'}
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
  const { isAuthority, resetDrinks, endGame, leaveRoom } = useApp();
  const sorted = [...players].sort((a, b) => b.drinkCount - a.drinkCount);
  return (
    <Modal title="Scoreboard 🏆" onClose={onClose}>
      <div className="scores-list">
        {sorted.map((p, i) => (
          <div key={p.uid} className={`scores-row ${i === 0 ? 'scores-lead' : ''}`}>
            <span className="scores-place">#{i + 1}</span>
            <span className="scores-name">
              {p.emoji} {p.name} {!p.connected && !p.local && <span className="muted">(away)</span>}
            </span>
            <span className="scores-val">🍺 {p.drinkCount}</span>
          </div>
        ))}
      </div>
      <div className="scores-actions">
        {isAuthority && (
          <>
            <Button variant="ghost" size="sm" onClick={() => resetDrinks()}>
              reset counts
            </Button>
            <Button variant="danger" size="sm" onClick={() => endGame()}>
              end game
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
