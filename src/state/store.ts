import type { EngineNode, HostLease, RoomData } from '../types';

/**
 * ============================================================
 *  The authoritative store
 * ============================================================
 * Everything the engine worker does to the room goes through this
 * interface, and the interface is deliberately tiny:
 *
 *   - `readRoom` / `subscribeRoom` — the worker always works from the
 *     database's own snapshot, never from a React render's copy, and
 *     never from a private mirror it wrote ahead of the server.
 *   - `commitEngine` — one transaction on `rooms/{code}/engine`, so a
 *     whole transition commits atomically (state + timer + phase +
 *     gate + awards + input acks) and only against the revision and
 *     host lease the plan was computed from. This is the CAS that
 *     makes "exactly once" true for timeouts, inputs and awards.
 *   - `commitLease` — the same, for the small host-lease node.
 *   - `write` — atomic multi-path updates for the few things that live
 *     outside the engine subtree (mirrors, TTL).
 *
 * A test double implements exactly this file, which is how the failure
 * scenarios in `tests/` are reproduced deterministically: real
 * transaction semantics (retry-on-concurrent-write, abort by returning
 * undefined, delayed acknowledgment) with no network.
 */

export interface CommitResult<T> {
  /** true when the transaction applied the callback's value */
  committed: boolean;
  /** the value in the database after the attempt (committed or not) */
  value: T | null;
  /** set when the transaction failed outright (rules, offline, bad value) */
  error?: unknown;
}

export interface EngineStore {
  readRoom(): Promise<RoomData | null>;
  subscribeRoom(cb: (room: RoomData | null) => void): () => void;
  /**
   * Transactionally update `rooms/{code}/engine`.
   * Return `undefined` from `fn` to abort without writing; the callback may
   * be re-run against newer data, so it must be pure — no nested writes, no
   * clock reads, no fresh randomness. Every value the plan needs is
   * precomputed by the worker before the transaction starts.
   */
  commitEngine(fn: (cur: EngineNode | null) => EngineNode | undefined): Promise<CommitResult<EngineNode>>;
  /** Transactionally update `rooms/{code}/engine/lease`. */
  commitLease(fn: (cur: HostLease | null) => HostLease | undefined): Promise<CommitResult<HostLease>>;
  /** One atomic multi-path update, room-relative paths. */
  write(paths: Record<string, unknown>): Promise<void>;
  /** One atomic multi-path update from the database root (room creation, sweeps). */
  writeRoot(paths: Record<string, unknown>): Promise<void>;
}
