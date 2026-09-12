import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../state/AppState';
import {
  activePlayers,
  inCurrentRound,
  livePlayers,
  pacingOf,
  playerList,
  roundPlayers,
  type GameInputEntry,
  type RoomData,
} from '../types';
import { gameById } from '../games';
import { Button, Modal, PlayerChip } from '../components/ui';
import type { PlayerInfo } from '../engine/types';

export function GameScreen() {
  const { room, me, isAuthority, takeOverHost } = useApp();
  const [scoresOpen, setScoresOpen] = useState(false);
  if (!room) return null;
  const meta = room.meta;
  const players = activePlayers(room);
  const owner = room.players?.[meta.ownerUid];
  // The host phone *is* the game server, so when it's asleep or gone the room
  // can pick hosting up from here instead of waiting for a lobby nobody sees.
  const hostGone =
    meta.mode === 'party' &&
    !isAuthority &&
    !!owner &&
    !owner.local &&
    (owner.connected === false || owner.left === true);
  // Joined mid-match: this round is already running without them.
  const waitingForNext =
    meta.phase === 'playing' &&
    meta.mode === 'party' &&
    !!me &&
    me.left !== true &&
    !inCurrentRound(room, me.uid);

  return (
    <div className="screen game-screen">
      <header className="game-head">
        <span className="round-chip">{meta.phase === 'claim' ? 'ORDER' : `R${meta.round}`}</span>
        <span className="game-title">
          {meta.phase === 'playing' || meta.phase === 'outcome'
            ? (gameById.get(room.game?.type ?? '')?.name ?? '…')
            : (gameById.get(meta.rotation[meta.gameIndex] ?? '')?.name ?? '…')}
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
        {waitingForNext ? (
          <JoiningNext />
        ) : (
          <>
            {meta.phase === 'claim' && <ClaimView room={room} />}
            {meta.phase === 'intro' && <IntroView room={room} />}
            {meta.phase === 'playing' && <PlayingView room={room} />}
            {meta.phase === 'outcome' && <OutcomeView room={room} />}
          </>
        )}
      </main>

      {scoresOpen && <ScoresModal onClose={() => setScoresOpen(false)} players={players} />}
    </div>
  );
}

/** You walked in halfway through a round — you're in the room, up next game. */
function JoiningNext() {
  const { room } = useApp();
  const nextDef = gameById.get(room?.meta.rotation[room.meta.gameIndex] ?? '');
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
  const players = activePlayers(room);
  const nextDef = gameById.get(meta.rotation[meta.gameIndex] ?? '');
  const order = meta.turnOrder ?? [];
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
        First up: <span className="claim-game">{nextDef?.emoji} {nextDef?.name}</span>
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
        <p className="muted">You're in at spot {order.indexOf(me!.uid) + 1} — waiting for the others…</p>
      ) : (
        <Button
          variant="claim"
          size="lg"
          full
          className="claim-btn"
          onClick={() => claimTurn()}
        >
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
  const def = gameById.get(room.meta.rotation[room.meta.gameIndex] ?? '');
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
  const { me, submitInput, isAuthority, hostSkipRound } = useApp();
  const def = gameById.get(room.game?.type ?? '');
  // this round's roster, not the room: a phone that died mid-round keeps its
  // seat, and anyone who joined mid-round plays from the next game
  const players = roundPlayers(room);
  const variant = room.meta.mode;

  const inputs = useMemo(() => {
    const list = Object.values(room.game?.inputs ?? {}) as GameInputEntry[];
    return list.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  }, [room.game?.inputs]);

  const answeredUids = useMemo(
    () => [...new Set(inputs.map((v) => v.forUid ?? v.uid))],
    [inputs],
  );

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
    const actor = players.find((p) => p.uid === room.meta.actorUid) ?? players[0];
    return (
      <div className="playing-wrap">
        <def.View
          state={room.game?.state ?? {}}
          me={actor}
          players={players}
          actorUid={room.meta.actorUid}
          isActor={true}
          isAuthority={isAuthority}
          myInput={latestInput(inputs, actor.uid)}
          answeredUids={answeredUids}
          timerEndsAt={room.game?.timerEndsAt ?? null}
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
    const declaredUid = def.sharedHolderUid?.(room.game!.state, {
      players,
      actorUid: room.meta.actorUid,
    });
    const declared = declaredUid ? (players.find((p) => p.uid === declaredUid) ?? null) : null;
    const awaiting = players.filter((p) => !answeredUids.includes(p.uid));
    const holder = declared ?? awaiting[0] ?? players[0];
    return (
      <div className="playing-wrap">
        <SharedGate player={declared ?? awaiting[0] ?? null} answeredCount={answeredUids.length} total={players.length}>
          {() => (
            <def.View
              state={room.game!.state}
              me={holder}
              players={players}
              actorUid={room.meta.actorUid}
              isActor={holder.uid === room.meta.actorUid}
              isAuthority={isAuthority}
              myInput={latestInput(inputs, holder.uid)}
              answeredUids={answeredUids}
              timerEndsAt={room.game?.timerEndsAt ?? null}
              submitInput={(input: unknown) => submitInput(input, holder.uid)}
              variant="shared"
            />
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
      <def.View
        state={room.game?.state ?? {}}
        me={me}
        players={players}
        actorUid={room.meta.actorUid}
        isActor={me.uid === room.meta.actorUid}
        isAuthority={isAuthority}
        myInput={latestInput(inputs, me.uid)}
        answeredUids={answeredUids}
        timerEndsAt={room.game?.timerEndsAt ?? null}
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

function latestInput(inputs: GameInputEntry[], uid: string): any {
  const mine = inputs.filter((v) => (v.forUid ?? v.uid) === uid);
  return mine.length > 0 ? mine[mine.length - 1].input : null;
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
        <p className="gate-progress">{answeredCount}/{total} done</p>
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
  const outcome = room.meta.outcome;
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
        {assignments.map((a) => {
          const p = players.find((x) => x.uid === a.uid);
          if (!p) return null;
          return (
            <div key={a.uid} className="outcome-row">
              <span className="outcome-who">
                {p.emoji} {p.name}
              </span>
              <span className="outcome-sips">{'🍺'.repeat(Math.min(a.sips, 5))} ×{a.sips}</span>
              <span className="outcome-reason">{a.reason}</span>
            </div>
          );
        })}
      </div>
      {outcome.note && assignments.length > 0 && (
        <p className="outcome-note">{outcome.note}</p>
      )}
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
 * The ready gate: nothing moves on until every player who can actually tap has
 * tapped Ready. It guards two moments — the rules splash (`intro`) and the
 * between-round outcome screen — and it only counts phones that are awake, so a
 * phone that nodded off never freezes the table (it keeps its seat and its
 * score and slides back in when it wakes). On a shared phone there is only one
 * device to tap, so one press readies the whole table.
 */
function ReadyGate({ room, intro = false }: { room: RoomData; intro?: boolean }) {
  const { me, setReady, isAuthority, hostSkipRound } = useApp();
  const players = livePlayers(room);
  // asleep phones are still in the game, they just can't hold the table up
  const away = activePlayers(room).filter((p) => !p.local && !p.connected);
  const shared = room.meta.mode === 'shared';
  const waiting = players.filter((p) => p.ready !== true);
  const readyCount = players.length - waiting.length;
  const allReady = waiting.length === 0;
  const iAmReady = !!me && me.ready === true;
  // one phone, one tap — only the room owner is allowed to flag everyone
  const readyEveryone = shared && isAuthority;
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

  return (
    <div className="ready">
      <div className="ready-chips">
        {players.map((p) => (
          <span key={p.uid} className={`ready-chip ${p.ready === true ? 'ready-on' : ''}`}>
            <span className="ready-chip-emoji">{p.emoji}</span>
            <span className="ready-chip-name">{p.name}</span>
            <span className="ready-chip-mark">{p.ready === true ? '✔' : '…'}</span>
          </span>
        ))}
      </div>
      <p className="ready-count">
        {allReady ? copy.allReady : `${readyCount}/${players.length} ready`}
      </p>

      {away.length > 0 && (
        <p className="muted small">
          📴 {away.map((p) => p.name).join(', ')}{' '}
          {away.length === 1 ? 'has' : 'have'} a dark screen — still in the game, just not
          holding anyone up
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
          <p className="muted small">waiting on {waiting.map((p) => p.name).join(', ')}…</p>
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
          start without them ▶
        </Button>
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
