export function SetupScreen() {
  return (
    <div className="screen setup">
      <div className="logo-block">
        <div className="logo-emoji">🎰</div>
        <h1 className="logo-title">Slot-O-Clock</h1>
      </div>
      <div className="setup-card">
        <h2>⚙️ One-time setup needed</h2>
        <p>This app talks to <strong>Firebase Realtime Database</strong>. Create a free project and paste your config:</p>
        <ol>
          <li>
            Open <a href="https://console.firebase.google.com" target="_blank" rel="noreferrer">console.firebase.google.com</a> → <em>Add project</em> (any name, Analytics optional).
          </li>
          <li>Build → <strong>Realtime Database</strong> → Create database → <strong>Start in locked mode</strong>.</li>
          <li>Build → Authentication → Sign-in method → enable <strong>Anonymous</strong>.</li>
          <li>Authentication → Settings → <strong>Authorized domains</strong> → add <code>{'<your-user>'}.github.io</code>.</li>
          <li>Project settings → Your apps → <strong>&lt;/&gt; web app</strong> → copy the <code>firebaseConfig</code> values.</li>
          <li>Paste them into <code>src/firebase-config.ts</code>, and paste <code>database.rules.json</code> (repo root) into RTDB → Rules → Publish.</li>
        </ol>
        <p className="muted">Full walkthrough in the repo README. It takes ~5 minutes.</p>
      </div>
    </div>
  );
}

export function Splash() {
  return (
    <div className="screen splash">
      <div className="logo-emoji pulse">🎰</div>
    </div>
  );
}

export function RoomGone({ onHome }: { onHome: () => void }) {
  return (
    <div className="screen splash">
      <div className="gate-card">
        <div className="gate-emoji">🍻</div>
        <h2>Party's over!</h2>
        <p className="muted">The room was closed.</p>
        <button className="btn btn-gold btn-lg btn-full" onClick={onHome}>
          back home
        </button>
      </div>
    </div>
  );
}

/**
 * A room that speaks a protocol this build does not.
 *
 * Room progress is only safe when every client agrees on what a phase, a
 * timer and a Ready tap *are* (see src/state/protocol.ts), so an incompatible
 * room is refused outright rather than half-driven: the older client is left
 * to finish its night, and this one sends the table to a fresh room.
 */
export function VersionMismatch({ onHome }: { onHome: () => void }) {
  return (
    <div className="screen splash">
      <div className="gate-card">
        <div className="gate-emoji">🔄</div>
        <h2>Different version</h2>
        <p className="muted">
          This room was started by another build of Slot-O-Clock. Rooms can't be upgraded while
          they're running — start a fresh room to play on this version.
        </p>
        <button className="btn btn-gold btn-lg btn-full" onClick={onHome}>
          start a new room
        </button>
      </div>
    </div>
  );
}
