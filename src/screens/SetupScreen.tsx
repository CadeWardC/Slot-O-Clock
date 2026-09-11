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
