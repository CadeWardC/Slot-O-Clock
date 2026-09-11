import { useState } from 'react';
import { useApp } from '../state/AppState';
import { Button, PlayerForm } from '../components/ui';
import type { RoomMode } from '../engine/types';

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
        <div className="logo-emoji">🎰</div>
        <h1 className="logo-title">Slot-O-Clock</h1>
        <p className="logo-tag">drinking minigames · one room · everyone's phone</p>
      </div>

      {err && <div className="error-banner">{err}</div>}

      {view === 'home' && (
        <div className="home-actions">
          <Button variant="gold" size="lg" full onClick={() => setView('create')}>
            Create a room 🍺
          </Button>
          <Button variant="primary" size="lg" full onClick={() => setView('join')}>
            Join a room 📱
          </Button>
        </div>
      )}

      {view === 'create' && (
        <div className="subview">
          <button className="back" onClick={() => setView('home')}>← back</button>
          <h2>How will you play?</h2>
          <div className="mode-cards">
            <button
              className={`mode-card ${mode === 'party' ? 'on' : ''}`}
              onClick={() => setMode('party')}
            >
              <span className="mode-emoji">📱📱📱</span>
              <span className="mode-name">Party mode</span>
              <span className="mode-desc">Everyone joins on their own phone</span>
            </button>
            <button
              className={`mode-card ${mode === 'shared' ? 'on' : ''}`}
              onClick={() => setMode('shared')}
            >
              <span className="mode-emoji">📱➡️🤚</span>
              <span className="mode-name">Shared phone</span>
              <span className="mode-desc">One phone, passed around</span>
            </button>
          </div>

          {mode === 'party' ? (
            <PlayerForm
              initialName={profile.name}
              initialEmoji={profile.emoji}
              submitLabel="Create room 🍻"
              busy={busy}
              onSubmit={(name, emoji) => go(() => createRoom({ mode, name, emoji }))}
            />
          ) : (
            <Button variant="gold" size="lg" full disabled={busy} onClick={() => go(() => createRoom({ mode, name: profile.name || 'Host', emoji: profile.emoji || '🍺' }))}>
              {busy ? '…' : 'Create room 🍻'}
            </Button>
          )}
        </div>
      )}

      {view === 'join' && (
        <div className="subview">
          <button className="back" onClick={() => setView('home')}>← back</button>
          <h2>Enter the room code</h2>
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
              submitLabel="Join 🎉"
              busy={busy}
              onSubmit={(name, emoji) => go(() => joinRoom({ code, name, emoji }))}
            />
          )}
        </div>
      )}

      <p className="home-foot">🍻 know your limits · play responsibly</p>
    </div>
  );
}
