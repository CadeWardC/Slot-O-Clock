/**
 * ============================================================
 *  The room protocol — v2
 * ============================================================
 * Everything in this file exists so that a timeout, a tap or a
 * Ready acknowledgment can be *identified*: which minigame instance
 * it belongs to, which internal phase, which revision of the
 * authoritative state, which exact countdown.
 *
 * v1 had none of that — a bare deadline and a reusable `ready`
 * boolean — and the whole class of desyncs in the bug report came
 * out of it:
 *
 *   - TIME_UP carried no timer id, so a timeout that belonged to the
 *     *previous* phase could land on the new one and skip it.
 *   - inputs carried no phase id, so a delayed tap could reach a
 *     later phase that accepts the same action.
 *   - `ready: true` was reusable, so a stale flag could release a
 *     gate nobody had actually tapped.
 *   - host authority was just a uid, so two tabs of the host could
 *     both run the engine.
 *
 * Rooms are stamped with PROTOCOL_VERSION in `meta.protocol`. A
 * client that does not understand the stamp refuses to run the
 * engine in that room, and the database rules refuse v1 writes into
 * a v2 room, so an old client can neither corrupt nor drive one.
 */

/** Bumped whenever the shape or the semantics of a room changes. */
export const PROTOCOL_VERSION = 2;

/** Abandoned-room TTL: 12h-ish, mirrored in database.rules.json (see state/gc.ts). */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** How often the engine worker re-checks the room when nothing else happens. */
export const ENGINE_TICK_MS = 400;

/** The host re-stamps its lease this often while it is alive. */
export const LEASE_RENEW_MS = 4000;

/**
 * A lease nobody has renewed for this long is free: the host tab is
 * gone, asleep, or offline. Only the room's own owner may re-acquire
 * it on its own; anybody else has to take over deliberately (👑).
 */
export const LEASE_TTL_MS = 20000;

/**
 * A deadline that came due while the host was away for *longer* than
 * this is not processed quietly — the table gets a recovery pause and
 * a Resume tap, and the activity is re-timed from scratch. A cascade
 * of phases nobody ever saw is worse than a visible pause.
 */
export const TIMER_RECOVERY_GRACE_MS = 10000;

/**
 * How long a Ready gate waits for a phone that was present when the
 * gate opened and then dropped: long enough that a Wi-Fi blip is not
 * treated as permission to move on, short enough that a phone that
 * went to sleep does not hold the table forever. Past this the host
 * gets the explicit "continue without them" and the player stops
 * being counted — a gate is never released by a disconnect alone.
 */
export const GATE_RECONNECT_GRACE_MS = 25000;

/** Ring size of the engine's own log (recent transitions, rejections, timings). */
export const ENGINE_LOG_MAX = 40;

/** Steps the worker may take in one pump before yielding to the event loop. */
export const ENGINE_STEP_BUDGET = 32;

/** Attempts at a commit before the engine stops and reports a fault. */
export const MAX_COMMIT_ATTEMPTS = 5;

/** The identity of one stage: a round instance plus an input epoch. */
export function stageKeyOf(roundId: string | null | undefined, phaseId: string | null | undefined) {
  return roundId && phaseId ? `${roundId}:${phaseId}` : null;
}

/** Short, collision-resistant id for rounds, phases, timers, events. */
export function shortId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
}

/** Deterministic seed for a string (round ids, rotations, per-round rng). */
export function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Does this client understand the room it is looking at? */
export function protocolMatches(protocol: unknown): boolean {
  return protocol === PROTOCOL_VERSION;
}
