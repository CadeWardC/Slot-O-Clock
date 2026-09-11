import { AppStateProvider, useApp } from './state/AppState';
import { useHostLoop } from './state/useHostLoop';
import { isFirebaseConfigured } from './firebase-config';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { GameScreen } from './screens/GameScreen';
import { RoomGone, SetupScreen, Splash } from './screens/SetupScreen';
import { Toast } from './components/ui';
import { Component, type ReactNode } from 'react';

/** A crashing game must never blank the whole app. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (this.state.error != null) {
      return (
        <div className="screen splash">
          <div className="gate-card">
            <div className="gate-emoji">💥</div>
            <h2>Something broke</h2>
            <p className="muted small">{String(this.state.error)}</p>
            <button className="btn btn-gold btn-lg btn-full" onClick={() => location.reload()}>
              reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Root() {
  const st = useApp();

  // The room owner's phone runs the authoritative game loop.
  useHostLoop(st.room, st.uid, st.isAuthority);

  let screen;
  if (!isFirebaseConfigured) screen = <SetupScreen />;
  else if (!st.authReady || (st.session && !st.roomLoaded)) screen = <Splash />;
  else if (st.session && st.roomLoaded && !st.room) screen = <RoomGone onHome={() => st.leaveRoom()} />;
  else if (!st.session || !st.room) screen = <Home />;
  else if (st.room.meta.phase === 'lobby') screen = <Lobby />;
  else screen = <GameScreen />;

  return (
    <>
      <ErrorBoundary>{screen}</ErrorBoundary>
      <Toast text={st.notice} />
    </>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <Root />
    </AppStateProvider>
  );
}
