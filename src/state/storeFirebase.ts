import {
  get,
  onValue,
  ref,
  runTransaction,
  update,
  type Database,
  type DatabaseReference,
} from 'firebase/database';
import type { EngineNode, HostLease, RoomData } from '../types';
import type { CommitResult, EngineStore } from './store';

/**
 * The real thing: Firebase Realtime Database.
 *
 * Two properties are load-bearing here and worth stating plainly:
 *
 *  1. **A root-level `update()` is atomic.** Every mirror write (and
 *     every client-facing multi-path write) either lands completely or
 *     not at all, so a client can never observe half a transition.
 *  2. **`runTransaction` re-runs its callback against newer server data
 *     instead of clobbering it.** That is what lets the engine check a
 *     revision and a lease inside the callback and still be safe when a
 *     player writes something concurrently — the callback is pure, so a
 *     retry re-applies the same decision to fresher data, and never
 *     applies it twice.
 */
export function firebaseStore(db: Database, code: string): EngineStore {
  const roomRef = ref(db, `rooms/${code}`);
  const engineRef = ref(db, `rooms/${code}/engine`);
  const leaseRef = ref(db, `rooms/${code}/engine/lease`);

  const commit = async <T>(
    target: DatabaseReference,
    fn: (cur: T | null) => T | undefined,
  ): Promise<CommitResult<T>> => {
    try {
      // `undefined` aborts the transaction (null would *delete* the node), which
      // is exactly how a stale plan is refused.
      const res = await runTransaction(target, (currentData: unknown) =>
        fn((currentData ?? null) as T | null),
      );
      return { committed: res.committed, value: (res.snapshot.val() ?? null) as T | null };
    } catch (error) {
      return { committed: false, value: null, error };
    }
  };

  return {
    async readRoom(): Promise<RoomData | null> {
      const snap = await get(roomRef);
      const val = snap.val() as RoomData | null;
      return val && val.meta ? val : null;
    },

    subscribeRoom(cb) {
      return onValue(
        roomRef,
        (snap) => {
          const val = snap.val() as RoomData | null;
          cb(val && val.meta ? val : null);
        },
        () => cb(null),
      );
    },

    commitEngine: (fn: (cur: EngineNode | null) => EngineNode | undefined) =>
      commit<EngineNode>(engineRef, fn),

    commitLease: (fn: (cur: HostLease | null) => HostLease | undefined) =>
      commit<HostLease>(leaseRef, fn),

    async write(paths) {
      await update(roomRef, paths);
    },

    async writeRoot(paths) {
      await update(ref(db), paths);
    },
  };
}
