import { useApp } from '../state/AppState';
import { activePlayers, playerList } from '../types';
import { allGames } from '../games';
import { triviaTopics } from '../games/Trivia/definition';
import { Button, PlayerChip, PlayerForm } from '../components/ui';

export function Lobby() {
  const {
    room,
    isAuthority,
    startGame,
    updateSettings,
    leaveRoom,
    addLocalPlayer,
    removePlayer,
    takeOverHost,
    notify,
  } = useApp();
  if (!room) return null;
  const meta = room.meta;
  const players = playerList(room);
  const active = activePlayers(room);
  const owner = room.players[meta.ownerUid];
  const ownerGone = meta.mode === 'party' && owner && owner.connected === false;

  const enabled = new Set(meta.settings.enabledGames ?? []);
  const eligible = allGames.filter((g) => enabled.has(g.id));
  const need = eligible.length > 0 ? Math.max(...eligible.map((g) => g.minPlayers)) : Infinity;
  const canStart = eligible.length > 0 && active.length >= need;
  const pointsLabel = meta.settings.pointsMode ? 'points' : 'sips';

  const shareText = `Join my Slot-O-Clock party! 🍺 Code: ${meta.code} → ${location.origin}${location.pathname}`;

  const toggleGame = (id: string) => {
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateSettings({ enabledGames: [...next] });
  };

  // rooms created before topics existed have no triviaTopics — treat as all on
  const savedTopics = meta.settings.triviaTopics?.filter((id) =>
    triviaTopics.some((t) => t.id === id),
  );
  const topicsOn = new Set(
    savedTopics && savedTopics.length > 0 ? savedTopics : triviaTopics.map((t) => t.id),
  );

  const toggleTopic = (id: string) => {
    if (topicsOn.has(id) && topicsOn.size === 1) {
      notify('At least one trivia topic must stay on');
      return;
    }
    const next = new Set(topicsOn);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateSettings({ triviaTopics: [...next] });
  };

  const setMultiplier = (m: number) => updateSettings({ sipMultiplier: m });
  const setPoints = (on: boolean) => updateSettings({ pointsMode: on });

  return (
    <div className="screen lobby">
      <div className="lobby-code-block">
        <p className="muted">room code</p>
        <h1 className="lobby-code" onClick={() => { navigator.clipboard?.writeText(meta.code); notify('Code copied!'); }}>
          {meta.code}
        </h1>
        <div className="lobby-code-actions">
          <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard?.writeText(meta.code); notify('Code copied!'); }}>
            copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (navigator.share) navigator.share({ text: shareText }).catch(() => {});
              else { navigator.clipboard?.writeText(shareText); notify('Invite copied!'); }
            }}
          >
            share invite
          </Button>
        </div>
        <p className="muted small">
          {meta.mode === 'party'
            ? 'Friends: open the same link, hit Join, enter this code.'
            : 'One phone — add the players below and pass it around.'}
        </p>
      </div>

      <section className="lobby-players">
        <h3>{meta.mode === 'shared' ? 'Players' : `Players (${active.length} connected)`}</h3>
        <div className="chip-grid">
          {players.map((p) => (
            <PlayerChip
              key={p.uid}
              player={p}
              crown={p.uid === meta.ownerUid}
              muted={!p.local && !p.connected}
              drinks={p.drinkCount}
              badge={
                isAuthority && p.uid !== meta.ownerUid ? (
                  <button className="chip-x" onClick={() => removePlayer(p.uid)} aria-label="remove">✕</button>
                ) : undefined
              }
            />
          ))}
        </div>

        {meta.mode === 'shared' && isAuthority && (
          <details className="add-player" open={players.length === 0}>
            <summary>+ Add player</summary>
            <PlayerForm submitLabel="Add player" onSubmit={(name, emoji) => addLocalPlayer(name, emoji)} />
          </details>
        )}

        {ownerGone && (
          <Button variant="ghost" size="sm" onClick={() => takeOverHost()}>
            👑 host is away — take over the room
          </Button>
        )}
      </section>

      {isAuthority && (
        <section className="lobby-settings">
          <h3>Games</h3>
          <div className="game-toggles">
            {allGames.map((g) => (
              <button
                key={g.id}
                className={`game-toggle ${enabled.has(g.id) ? 'on' : ''}`}
                onClick={() => toggleGame(g.id)}
              >
                <span className="game-toggle-emoji">{g.emoji}</span>
                <span className="game-toggle-name">{g.name}</span>
                <span className="game-toggle-min">{g.minPlayers}+</span>
              </button>
            ))}
          </div>

          {enabled.has('trivia') && (
            <>
              <h3>Trivia topics</h3>
              <div className="topic-toggles">
                {triviaTopics.map((t) => (
                  <button
                    key={t.id}
                    className={`topic-toggle ${topicsOn.has(t.id) ? 'on' : ''}`}
                    onClick={() => toggleTopic(t.id)}
                  >
                    <span className="topic-toggle-emoji">{t.emoji}</span>
                    <span className="topic-toggle-name">{t.name}</span>
                    <span className="topic-toggle-count">{t.count}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <h3>House rules</h3>
          <div className="setting-row">
            <span>Sober mode (count {pointsLabel === 'points' ? 'points' : 'sips'} as points)</span>
            <button className={`switch ${meta.settings.pointsMode ? 'on' : ''}`} onClick={() => setPoints(!meta.settings.pointsMode)}>
              <span className="switch-knob" />
            </button>
          </div>
          <div className="setting-row">
            <span>Drink intensity</span>
            <div className="seg">
              {[0.5, 1, 2].map((m) => (
                <button key={m} className={`seg-cell ${meta.settings.sipMultiplier === m ? 'on' : ''}`} onClick={() => setMultiplier(m)}>
                  {m === 0.5 ? 'light' : m === 1 ? 'normal' : 'wild'}
                </button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span>Between rounds</span>
            <div className="seg">
              {(['auto', 'manual'] as const).map((p) => (
                <button
                  key={p}
                  className={`seg-cell ${(meta.settings.roundPacing ?? 'auto') === p ? 'on' : ''}`}
                  onClick={() => updateSettings({ roundPacing: p })}
                >
                  {p === 'auto' ? 'auto ▶▶' : 'host ▶'}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="lobby-actions">
        {isAuthority ? (
          <Button variant="gold" size="lg" full disabled={!canStart} onClick={() => startGame()}>
            {canStart
              ? `Start the party 🍻`
              : eligible.length === 0
                ? 'Enable at least one game'
                : `Need ${need} players (${active.length} ready)`}
          </Button>
        ) : (
          <p className="muted">Waiting for the host to start…</p>
        )}
        <Button variant="ghost" size="sm" onClick={() => leaveRoom()}>
          leave room
        </Button>
      </div>
    </div>
  );
}
