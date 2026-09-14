import { useEffect, useState } from 'react';
import { db } from '../firebase';
import { allGames, gameById } from '../games';
import { protocolMatches } from './protocol';
import { serverNow } from './serverTime';
import { firebaseStore } from './storeFirebase';
import { EngineWorker, type EngineCommand, type EngineWorkerStatus } from './engine';
import { tabInstanceId } from './instance';
import type { RoomData } from '../types';

/**
 * The React side of the engine.
 *
 * It does three things and nothing else: start a worker while a room is
 * open, hand the UI a way to reach it (👑 skip / continue / resume /
 * retry), and stop it — which invalidates the worker's generation, so a
 * reload can never leave a transition writing behind it.
 *
 * Every decision lives in `state/engine.ts`; this hook is deliberately
 * too small to hide a second phase machine in.
 */

const registry = new Map<string, EngineWorker>();

/** This tab's worker for a room, if it has one. */
export function engineFor(code: string | null | undefined): EngineWorker | null {
  return code ? (registry.get(code) ?? null) : null;
}

/** Ask the room's engine to do something. False = this tab is not the authority. */
export function sendEngineCommand(code: string | null | undefined, command: EngineCommand): boolean {
  const worker = engineFor(code);
  return worker ? worker.command(command) : false;
}

export function useHostLoop(room: RoomData | null, uid: string | null): EngineWorkerStatus | null {
  const [status, setStatus] = useState<EngineWorkerStatus | null>(null);
  const code = room?.meta?.code ?? null;
  // A room from another protocol must never be driven by this build.
  const supported = !!room?.meta && protocolMatches(room.meta.protocol);

  useEffect(() => {
    if (!db || !code || !uid || !supported) return;
    const worker = new EngineWorker({
      code,
      uid,
      instanceId: tabInstanceId(),
      store: firebaseStore(db, code),
      games: { all: allGames, byId: gameById },
      now: serverNow,
      onStatus: setStatus,
      onEvent: (entry) => {
        // transition ids, revisions, timer ids, rejections — never answers
        if (import.meta.env.DEV) console.debug('[engine]', entry);
      },
    });
    registry.set(code, worker);
    worker.start();

    // Coming back from a locked screen or a dead network: re-read the room
    // first, then let the queue decide. The order matters — a phone that wakes
    // up must not act on a snapshot from before it slept.
    const wake = () => {
      if (document.visibilityState === 'visible') void worker.resync();
    };
    const online = () => void worker.resync();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', online);

    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('pageshow', wake);
      window.removeEventListener('online', online);
      if (registry.get(code) === worker) registry.delete(code);
      worker.stop();
    };
  }, [code, uid, supported]);

  return status;
}
