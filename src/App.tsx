import { AppStateProvider, useApp } from './state/AppState';
import { useHostLoop } from './state/useHostLoop';
import { protocolMatches } from './state/protocol';
import { isFirebaseConfigured } from './firebase-config';
import { phaseOf } from './types';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { GameScreen } from './screens/GameScreen';
import { RoomGone, SetupScreen, Splash, VersionMismatch } from './screens/SetupScreen';
import { Button, Toast } from './components/ui';
import { SlotIntro } from './components/SlotIntro';
import { Component, useCallback, useState, type ReactNode } from 'react';

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

/**
 * A failure the host's own room could not be told about (rules rejected the
 * write, the network is down). The engine has already stopped itself, so the
 * host's screen has to say so — silently carrying on from a private copy of
 * the state is exactly the bug this whole layer exists to prevent.
 */
function EngineFaultBanner({ message }: { message: string }) {
  const { engineCommand } = useApp();
  return (
    <div className="toast toast-error">
      <span>🧯 engine stopped: {message}</span>
      <Button variant="ghost" size="sm" onClick={() => engineCommand({ type: 'retry' })}>
        retry
      </Button>
    </div>
  );
}

function Root() {
  const st = useApp();

  // The room owner's tab runs the authoritative engine; every other phone runs
  // a worker too, but only the lease holder is allowed to commit.
  const engineStatus = useHostLoop(st.room, st.uid);
  const phase = phaseOf(st.room);
  const wrongProtocol = !!st.room && !protocolMatches(st.room.meta.protocol);
  const localFault = engineStatus?.localError ?? null;

  let screen;
  if (!isFirebaseConfigured) screen = <SetupScreen />;
  else if (!st.authReady || (st.session && !st.roomLoaded)) screen = <Splash />;
  else if (st.session && st.roomLoaded && !st.room) screen = <RoomGone onHome={() => st.leaveRoom()} />;
  else if (wrongProtocol) screen = <VersionMismatch onHome={() => st.leaveRoom()} />;
  else if (!st.session || !st.room) screen = <Home />;
  else if (phase === 'lobby') screen = <Lobby />;
  else screen = <GameScreen />;

  return (
    <>
      <ErrorBoundary>{screen}</ErrorBoundary>
      {st.isAuthority && localFault && !st.room?.engine?.fault && (
        <EngineFaultBanner message={localFault} />
      )}
      <Toast text={st.notice} />
    </>
  );
}

export default function App() {
  // Plays once per page load, over the top of whatever is still booting.
  const [intro, setIntro] = useState(true);
  const closeIntro = useCallback(() => setIntro(false), []);

  return (
    <AppStateProvider>
      {intro && <SlotIntro onDone={closeIntro} />}
      <Root />
    </AppStateProvider>
  );
}
