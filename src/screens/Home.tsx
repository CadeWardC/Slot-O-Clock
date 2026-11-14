import { useState } from 'react';
import { useApp } from '../state/AppState';
import { Button, PlayerForm } from '../components/ui';
import type { RoomMode } from '../engine/types';
import { allGames } from '../games';

export function Home() {
  const { profile, createRoom, joinRoom } = useApp();
  const [view, setView] = useState<'home' | 'create' | 'join'>('home');
  const [mode, setMode] = useState<RoomMode>('party');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen home">
      <div className="logo-block">
        <div className="logo-reels" aria-hidden="true">
          <span className="logo-reel">🍺</span>
          <span className="logo-reel">🎰</span>
          <span className="logo-reel">🍻</span>
        </div>
        <div className="logo-sign">
          <h1 className="logo-title">
            Slot<span className="logo-o">-O-</span>Clock
          </h1>
        </div>
        <p className="logo-tag">Drinking games for the whole table. One room, everybody on their own phone.</p>
      </div>

      {err && <div className="error-banner">{err}</div>}

      {view === 'home' && (
        <div className="home-actions">
          <Button variant="gold" size="lg" full onClick={() => setView('create')}>
            Start a room
          </Button>
          <Button variant="primary" size="lg" full onClick={() => setView('join')}>
            Join with a code
          </Button>
          <div className="home-games">
            <p className="fx-kicker">{allGames.length} games on tonight</p>
            <div className="home-ticker" aria-hidden="true">
              <div className="home-ticker-track">
                {[...allGames, ...allGames].map((g, i) => (
                  <span key={i} className="home-ticker-item">
                    {g.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {view === 'create' && (
        <div className="subview">
          <button className="back" onClick={() => setView('home')}>← back</button>
          <h2>How many phones?</h2>
          <div className="mode-cards">
            <button
              className={`mode-card ${mode === 'party' ? 'on' : ''}`}
              onClick={() => setMode('party')}
            >
              <span className="mode-name">One each</span>
              <span className="mode-desc">Everyone joins on their own phone</span>
            </button>
            <button
              className={`mode-card ${mode === 'shared' ? 'on' : ''}`}
              onClick={() => setMode('shared')}
            >
              <span className="mode-name">Just this one</span>
              <span className="mode-desc">One phone, passed around the table</span>
            </button>
          </div>

          {mode === 'party' ? (
            <PlayerForm
              initialName={profile.name}
              initialEmoji={profile.emoji}
              submitLabel="Open the room"
              busy={busy}
              onSubmit={(name, emoji) => go(() => createRoom({ mode, name, emoji }))}
            />
          ) : (
            <Button variant="gold" size="lg" full disabled={busy} onClick={() => go(() => createRoom({ mode, name: profile.name || 'Host', emoji: profile.emoji || '🍺' }))}>
              {busy ? '…' : 'Open the room'}
            </Button>
          )}
        </div>
      )}

      {view === 'join' && (
        <div className="subview">
          <button className="back" onClick={() => setView('home')}>← back</button>
          <h2>Room code</h2>
          <input
            className="input code-input"
            placeholder="ABCD"
            value={code}
            maxLength={4}
            autoCapitalize="characters"
            autoCorrect="off"
            inputMode="text"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          {code.length === 4 && (
            <PlayerForm
              initialName={profile.name}
              initialEmoji={profile.emoji}
              submitLabel="Sit down"
              busy={busy}
              onSubmit={(name, emoji) => go(() => joinRoom({ code, name, emoji }))}
            />
          )}
        </div>
      )}

      <p className="home-foot">Know your limits. Water counts as a drink.</p>
    </div>
  );
}
