import type { EngineNode, HostLease, RoomData } from '../src/types.ts';
import type { CommitResult, EngineStore } from '../src/state/store.ts';

/**
 * ============================================================
 *  An in-memory Realtime Database, with RTDB's transaction rules
 * ============================================================
 * The failure scenarios in the plan are all about *timing* and *ordering*:
 * a write that is still waiting for the server while a deadline expires, two
 * authorities racing, a host that dies between two commits. Reproducing those
 * needs a store whose semantics match the real one, so this fake keeps the
 * two properties the engine relies on:
 *
 *   - **A commit re-runs against current data, it never clobbers.** The
 *     callback is handed the value that is in the "server" right now, so a
 *     plan computed from an old revision is refused rather than applied.
 *   - **`write()` is one atomic multi-path update.** Either every path lands
 *     or none does, so a client can never see half a transition.
 *
 * Plus the knobs a test needs: hold a commit in flight, fail one outright,
 * go offline, and observe every value the room ever held.
 */
export class FakeStore implements EngineStore {
  room: RoomData;
  /** when set, commits wait on this before they are applied */
  hold: Promise<void> | null = null;
  /** the next commit fails with this error instead of applying */
  failNext: Error | null = null;
  /** every commit fails while this is set */
  offline = false;
  /** how long a commit "takes" (in ms of fake time), to interleave work */
  commitLatency = 0;

  commits = 0;
  leaseCommits = 0;
  writes = 0;
  /** every room value the server has held, in order — for mixed-snapshot checks */
  history: RoomData[] = [];

  private listeners = new Set<(room: RoomData | null) => void>();
  private release: (() => void) | null = null;

  constructor(room: RoomData) {
    this.room = clone(room);
    this.history.push(clone(this.room));
  }

  /* ---------- EngineStore ---------- */

  async readRoom(): Promise<RoomData | null> {
    if (this.offline) throw new Error('offline');
    return clone(this.room);
  }

  subscribeRoom(cb: (room: RoomData | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async commitEngine(
    fn: (cur: EngineNode | null) => EngineNode | undefined,
  ): Promise<CommitResult<EngineNode>> {
    await this.gate();
    if (this.offline) return failed<EngineNode>('offline');
    const cur = clone(this.room.engine ?? null);
    const next = fn(cur);
    if (next === undefined) {
      // aborted inside the callback: the server value is unchanged
      return { committed: false, value: clone(this.room.engine ?? null) };
    }
    this.room.engine = clone(next);
    this.commits += 1;
    this.emit();
    return { committed: true, value: clone(next) };
  }

  async commitLease(
    fn: (cur: HostLease | null) => HostLease | undefined,
  ): Promise<CommitResult<HostLease>> {
    await this.gate();
    if (this.offline) return failed<HostLease>('offline');
    const cur = clone(this.room.engine?.lease ?? null);
    const next = fn(cur);
    if (next === undefined) {
      return { committed: false, value: clone(this.room.engine?.lease ?? null) };
    }
    if (this.room.engine) this.room.engine.lease = clone(next);
    this.leaseCommits += 1;
    this.emit();
    return { committed: true, value: clone(next) };
  }

  async write(paths: Record<string, unknown>): Promise<void> {
    await this.gate();
    if (this.offline) throw new Error('offline');
    // atomic: apply to a copy, then swap
    const next = clone(this.room) as unknown as Record<string, unknown>;
    for (const [path, value] of Object.entries(paths)) applyPath(next, path, value);
    this.room = next as unknown as RoomData;
    this.writes += 1;
    this.emit();
  }

  async writeRoot(paths: Record<string, unknown>): Promise<void> {
    await this.gate();
    if (this.offline) throw new Error('offline');
    const prefix = `rooms/${this.room.meta.code}/`;
    const relative: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(paths)) {
      if (path.startsWith(prefix)) relative[path.slice(prefix.length)] = value;
    }
    if (Object.keys(relative).length > 0) await this.write(relative);
  }

  /* ---------- test controls ---------- */

  /** Stop applying commits until `releaseCommits()`. */
  holdCommits(): void {
    if (!this.hold) {
      this.hold = new Promise((res) => {
        this.release = res;
      });
    }
  }

  releaseCommits(): void {
    this.release?.();
    this.release = null;
    this.hold = null;
  }

  /** Deliver a client write (an input, a gate ack, a claim) atomically. */
  patch(paths: Record<string, unknown>): void {
    const next = clone(this.room) as unknown as Record<string, unknown>;
    for (const [path, value] of Object.entries(paths)) applyPath(next, path, value);
    this.room = next as unknown as RoomData;
    this.emit();
  }

  snapshot(): RoomData {
    return clone(this.room);
  }

  private async gate(): Promise<void> {
    if (this.hold) await this.hold;
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = null;
      throw err;
    }
  }

  private emit(): void {
    this.history.push(clone(this.room));
    for (const cb of this.listeners) cb(clone(this.room));
  }
}

function failed<T>(message: string): CommitResult<T> {
  return { committed: false, value: null, error: new Error(message) };
}

export function clone<T>(value: T): T {
  return value === undefined ? (undefined as T) : (JSON.parse(JSON.stringify(value)) as T);
}

/** Set (or delete, for null) a slash-separated path inside a plain object. */
export function applyPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('/').filter(Boolean);
  let node: Record<string, unknown> = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const existing = node[key];
    if (!existing || typeof existing !== 'object') node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (value === null) delete node[last];
  else node[last] = value;
}
