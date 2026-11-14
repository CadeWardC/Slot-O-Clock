import { useApp } from '../state/AppState';
import { activePlayers, engineOf, playerList } from '../types';
import { awardsFor } from '../engine/party';
import { Button } from '../components/ui';
import { Confetti } from '../components/fx';

/**
 * The end of the night. The host ended it; every phone lands here with the
 * same awards, worked out from the tab and the stats the engine kept as the
 * games went by. From here the host either deals another night or closes up.
 */
export function Awards() {
  const { room, isAuthority, reopenRoom, endGame, leaveRoom } = useApp();
  if (!room) return null;
  const engine = engineOf(room);
  const everyone = playerList(room);
  const seated = activePlayers(room);
  const totals = engine?.awards?.drinks ?? {};
  const byUid = new Map(everyone.map((p) => [p.uid, p] as const));
  const nameOf = (uid: string) => byUid.get(uid)?.name ?? 'Someone';
  const awards = awardsFor(
    engine?.stats,
    totals,
    seated.map((p) => p.uid),
    nameOf,
  );
  const games = engine?.stats?.rounds ?? 0;
  const tab = [...seated].sort((a, b) => (totals[b.uid] ?? 0) - (totals[a.uid] ?? 0));
  const unit = room.meta.settings.pointsMode ? 'points' : 'drinks';

  return (
    <div className="screen awards">
      <Confetti count={40} />
      <header className="awards-head">
        <p className="fx-kicker">
          {games} {games === 1 ? 'game' : 'games'} later
        </p>
        <h1 className="fx-title fx-title-gold">Last orders</h1>
      </header>

      {awards.length === 0 && (
        <p className="muted">Not enough happened to hand out any awards. Play longer next time.</p>
      )}

      <div className="awards-list">
        {awards.map((a, i) => (
          <div
            key={a.id}
            className={`award ${i % 2 === 0 ? 'award-l' : 'award-r'}`}
            style={{ animationDelay: `${0.2 + i * 0.35}s` }}
          >
            <span className="award-n">{a.n}</span>
            <div className="award-body">
              <p className="award-title">{a.title}</p>
              <p className="award-who">
                {a.uids.map((uid, j) => (
                  <span key={uid}>
                    {j > 0 && <span className="award-vs"> on </span>}
                    {byUid.get(uid)?.emoji} {nameOf(uid)}
                  </span>
                ))}
              </p>
              <p className="award-line">{a.line}</p>
            </div>
          </div>
        ))}
      </div>

      <section className="awards-tab">
        <p className="fx-kicker">The final tab, in {unit}</p>
        {tab.map((p, i) => (
          <div key={p.uid} className="awards-tab-row">
            <span className="awards-tab-place">{i + 1}.</span>
            <span className="awards-tab-name">
              {p.emoji} {p.name}
            </span>
            <span className="awards-tab-n">{totals[p.uid] ?? 0}</span>
          </div>
        ))}
      </section>

      <div className="awards-actions">
        {isAuthority ? (
          <>
            <Button variant="gold" size="lg" full onClick={() => reopenRoom()}>
              Go again
            </Button>
            <Button variant="ghost" size="sm" onClick={() => endGame()}>
              close the room
            </Button>
          </>
        ) : (
          <>
            <p className="muted">The host can deal another night from here.</p>
            <Button variant="ghost" size="sm" onClick={() => leaveRoom()}>
              leave
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
