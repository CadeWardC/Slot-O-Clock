import type {
  DrinkAssignment,
  OutcomeRecap,
  PlayerInfo,
  RoomMode,
  RoomSettings,
} from './engine/types';
import { GATE_RECONNECT_GRACE_MS, ROOM_TTL_MS } from './state/protocol';

export { ROOM_TTL_MS };

export type RoomPhase = 'lobby' | 'claim' | 'intro' | 'playing' | 'outcome' | 'ended';

export interface OutcomeInfo {
  gameId: string;
  gameName: string;
  gameEmoji: string;
  assignments: DrinkAssignment[];
  note?: string | null;
  /** optional colour-coded breakdown of how the round was decided */
  recap?: OutcomeRecap | null;
  /** the engine event that produced this outcome (traceability, never private data) */
  eventId?: string;
}

/**
 * A countdown with an identity. `id` makes a queued timeout
 * un-fakeable — replacing the timer invalidates the timeout that
 * belonged to its predecessor — and `roundId`/`phaseId` make it
 * impossible for a client to render a deadline that belongs to a
 * phase it is no longer in (the Horse Race "the race already
 * finished" bug).
 */
export interface GameTimer {
  id: string;
  roundId: string;
  phaseId: string;
  startsAt: number;
  endsAt: number;
  /** the activity's full length, so a recovery resume can re-time it */
  durationMs: number;
}

/** One round instance: a minigame's live state plus its timer and inputs. */
export interface EngineGame {
  type: string;
  state: unknown;
  timer: GameTimer | null;
  inputs?: Record<string, GameInputEntry> | null;
}

/**
 * Who is allowed to run the engine. `uid` alone is not enough: a
 * second tab of the host has the same uid, so `instanceId` (one per
 * browser tab) decides, and `generation` increments on every takeover
 * so an old authority's in-flight commit is rejected.
 */
export interface HostLease {
  uid: string;
  instanceId: string;
  generation: number;
  renewedAt: number;
}

/** The players a Ready gate is waiting for, snapshotted when it opened. */
export interface ReadyGate {
  id: string;
  kind: 'intro' | 'outcome';
  /** who has to tap — fixed when the gate opened, so a disconnect can't shrink it */
  uids: string[];
  openedAt: number;
}

/** A pause the whole table can see, instead of an invisible fast-forward. */
export interface RecoveryInfo {
  kind: 'timer-overdue';
  at: number;
  roundId: string | null;
  phaseId: string | null;
  timerId: string | null;
  /** how late the deadline was when the engine noticed */
  lateMs: number;
  /** what the countdown was for, so Resume can re-time it */
  durationMs: number;
  message: string;
}

/** The engine stopped: a commit failed and nothing may run until it is reconciled. */
export interface FaultInfo {
  at: number;
  message: string;
  op: string;
  rev: number;
  attempts: number;
}

export interface EngineLogEntry {
  at: number;
  kind: string;
  detail: string;
  rev?: number;
  eventId?: string;
  /** how long the commit took on the wire (diagnostics only, never a decision) */
  latencyMs?: number;
}

export type InputStatus = 'idle' | 'sending' | 'accepted' | 'rejected';

/**
 * What a client actually wrote. Everything a decision depends on
 * travels with the payload so the engine can check that the action
 * still belongs to the stage it was meant for.
 */
export interface GameInputEntry {
  /** equals the RTDB key — a retry reuses it, so it can only apply once */
  inputId: string;
  /** the phone that sent it */
  uid: string;
  /** shared-phone mode: the local player the input counts for */
  forUid?: string | null;
  at: number;
  roundId: string;
  phaseId: string;
  stageKey: string;
  input: unknown;
  /** written by the engine, in the same commit as the reducer result */
  ack?: { rev: number; at: number; eventId: string; applied: boolean } | null;
  /** written by the engine when it refused the input (stale phase, wrong roster…) */
  rejected?: string | null;
}

/**
 * Everything the engine owns. One subtree, so one RTDB transaction can
 * commit a whole transition — state, timer, phase, gate, awards and
 * input acknowledgments — atomically and against a known revision.
 * Clients never write here except through three scoped subpaths:
 * `claims/*` (the ordering ceremony), `ready/*` (gate taps) and
 * `game/inputs/*` (their own actions).
 */
export interface EngineNode {
  protov: number;
  lease: HostLease;
  /** increases with every committed engine update */
  rev: number;
  phase: RoomPhase;
  /** 0 during the ordering ceremony, 1+ once rounds begin */
  round: number;
  /** unique to each minigame instance */
  roundId: string | null;
  /** changes whenever the internal phase (or the input epoch) changes */
  phaseId: string | null;
  /** `roundId:phaseId` — the identity every input is stamped with */
  stageKey: string | null;
  /** shuffled pool of enabled game ids */
  rotation: string[];
  gameIndex: number;
  /** claimed once at game start; round N's actor is turnOrder[(N-1) % len] */
  turnOrder: string[];
  actorUid: string | null;
  /** who is playing the round on screen, snapshotted at launch */
  roundUids: string[] | null;
  /** host escape hatch: release the current gate / end the round */
  forceNext: boolean;
  outcome: OutcomeInfo | null;
  gate: ReadyGate | null;
  /** uid → the gate id that player has acknowledged */
  ready: Record<string, string>;
  /** turnClaim/{slot} = first player to claim that order position */
  claims: Record<string, { uid: string; at: number }>;
  game: EngineGame | null;
  /**
   * The authoritative score/drink ledger. Absolute totals, not deltas:
   * they only ever change inside a revision-checked transaction, so a
   * retried commit can never double-award drinks or points.
   */
  awards: { scores: Record<string, number>; drinks: Record<string, number> };
  recovery: RecoveryInfo | null;
  fault: FaultInfo | null;
  log: EngineLogEntry[];
}

/**
 * Lobby-side room data. Everything progress-related lives in `engine`
 * — this is the stuff that is true before a game ever starts.
 */
export interface RoomMeta {
  code: string;
  createdAt: number;
  ownerUid: string;
  mode: RoomMode;
  settings: RoomSettings;
  /** server-time TTL — any client may delete the room once past it (see state/gc.ts) */
  expiresAt?: number;
  /** the room protocol this room was created under (see state/protocol.ts) */
  protocol?: number;
  /** legacy v1 field: the phase machine used to live here */
  phase?: RoomPhase;
  /** legacy v1 fields, kept so old rooms still render their lobby */
  round?: number;
  rotation?: string[];
  gameIndex?: number;
  turnOrder?: string[];
  forceStart?: boolean;
  actorUid?: string | null;
  roundUids?: string[] | null;
  introEndsAt?: number | null;
  outcomeEndsAt?: number | null;
  forceNext?: boolean;
  outcome?: OutcomeInfo | null;
}

export interface EventEntry {
  at: number;
  text: string;
}

export interface RoomData {
  meta: RoomMeta;
  engine?: EngineNode | null;
  players: Record<string, PlayerInfo>;
  /** legacy v1 nodes — read-only under the v2 rules */
  game?: { type?: string; state?: unknown; timerEndsAt?: number | null } | null;
  events?: Record<string, EventEntry>;
  turnClaim?: Record<string, { uid: string; at: number }>;
}

export interface Session {
  code: string;
  uid: string;
}

/* ============================================================
 *  Reading a room
 * ============================================================ */

/** The engine subtree, or null for a room that predates this protocol. */
export function engineOf(room: RoomData | null | undefined): EngineNode | null {
  return room?.engine ?? null;
}

/** The room's phase — from the engine, or the legacy field for old rooms. */
export function phaseOf(room: RoomData | null | undefined): RoomPhase {
  return room?.engine?.phase ?? room?.meta?.phase ?? 'lobby';
}

export function roundOf(room: RoomData | null | undefined): number {
  return room?.engine?.round ?? room?.meta?.round ?? 0;
}

export function gameOf(room: RoomData | null | undefined): EngineGame | null {
  return room?.engine?.game ?? null;
}

export function stageKeyOfRoom(room: RoomData | null | undefined): string | null {
  return room?.engine?.stageKey ?? null;
}

/**
 * The deadline a phone is allowed to draw right now.
 *
 * A timer only counts when it belongs to the round and the phase on
 * screen *and* nothing is paused: this is the client-side half of the
 * fix for "a new phase arrives with the previous phase's timer".
 */
export function activeTimer(room: RoomData | null | undefined): GameTimer | null {
  const engine = room?.engine;
  const timer = engine?.game?.timer;
  if (!engine || !timer) return null;
  if (engine.recovery || engine.fault) return null;
  if (timer.roundId !== engine.roundId || timer.phaseId !== engine.phaseId) return null;
  return timer;
}

/** Inputs that belong to the stage on screen, in submission order. */
export function stageInputs(room: RoomData | null | undefined): GameInputEntry[] {
  const engine = room?.engine;
  const stageKey = engine?.stageKey;
  if (!engine || !stageKey) return [];
  return Object.values(engine.game?.inputs ?? {})
    .filter((entry): entry is GameInputEntry => !!entry && entry.stageKey === stageKey)
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/** Every input the room still holds, current stage first. */
export function allInputs(room: RoomData | null | undefined): GameInputEntry[] {
  return Object.values(room?.engine?.game?.inputs ?? {}).filter(
    (entry): entry is GameInputEntry => !!entry,
  );
}

/* ============================================================
 *  Seats, presence, rosters
 * ============================================================ */

/** Unambiguous 4-char room code alphabet. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomRoomCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export const EMOJI_CHOICES = [
  '🍺', '🍻', '🥃', '🍷', '🍹', '🦄', '🐸', '🦊', '🐼', '🐙',
  '👽', '🤖', '🦖', '🐯', '🐷', '🐵', '🦅', '🐝', '🦉', '🐺',
];

/** The authoritative drink count for a seat (ledger first, legacy field second). */
export function drinkCountOf(room: RoomData | null | undefined, uid: string): number {
  const ledger = room?.engine?.awards?.drinks?.[uid];
  if (typeof ledger === 'number') return ledger;
  return room?.players?.[uid]?.drinkCount ?? 0;
}

/** The authoritative score for a seat. */
export function scoreOf(room: RoomData | null | undefined, uid: string): number {
  const ledger = room?.engine?.awards?.scores?.[uid];
  if (typeof ledger === 'number') return ledger;
  return room?.players?.[uid]?.score ?? 0;
}

/**
 * Every seat in the room, with the engine's ledger folded in. The
 * ledger is the truth (it is the only thing committed atomically with
 * a transition); `players/{uid}/score|drinkCount` is a legacy mirror
 * the engine no longer needs to maintain.
 */
export function playerList(room: RoomData | null): PlayerInfo[] {
  if (!room?.players) return [];
  return Object.values(room.players)
    .map((p) => ({
      ...p,
      drinkCount: drinkCountOf(room, p.uid),
      score: scoreOf(room, p.uid),
    }))
    .sort((a, b) => a.joinedAt - b.joinedAt);
}

/**
 * Everyone who still has a seat: shared-phone locals, live phones **and**
 * phones that merely went dark. A sleeping phone is *not* a departure —
 * it keeps its seat, score and turn and slides straight back in when it wakes.
 * Only `left` (closed the site / tapped leave) takes a seat away.
 */
export function activePlayers(room: RoomData | null): PlayerInfo[] {
  return playerList(room).filter((p) => p.left !== true);
}

/**
 * Presence, per connection rather than per player: each tab/device
 * writes `players/{uid}/connections/{instanceId}` and arms an
 * onDisconnect for *that* child, so a second tab closing — or the
 * browser unloading one page to reclaim memory — can no longer mark a
 * player who is still there as gone.
 */
export function connectionIds(room: RoomData | null, uid: string): string[] {
  const connections = (room?.players?.[uid] as { connections?: Record<string, unknown> } | undefined)
    ?.connections;
  return connections ? Object.keys(connections) : [];
}

export function isPresent(room: RoomData | null, uid: string): boolean {
  const player = room?.players?.[uid];
  if (!player) return false;
  if (player.local) return true; // shared-phone seat: no device, always "here"
  if (player.connections) return connectionIds(room, uid).length > 0;
  // legacy rooms (or a room whose first heartbeat has not landed yet)
  return player.connected === true;
}

/** Players whose phone is actually live right now (plus shared-phone locals). */
export function livePlayers(room: RoomData | null): PlayerInfo[] {
  return activePlayers(room).filter((p) => p.left !== true && isPresent(room, p.uid));
}

/** Seats given up on purpose — closed the site, or tapped "leave room". */
export function departedPlayers(room: RoomData | null): PlayerInfo[] {
  return playerList(room).filter((p) => p.left === true);
}

/**
 * The round on screen: the roster the engine snapshotted at launch.
 * Rooms with no snapshot yet (the ordering ceremony) fall back to
 * every seat in the room.
 */
export function roundPlayers(room: RoomData | null): PlayerInfo[] {
  const roster = room?.engine?.roundUids ?? room?.meta?.roundUids;
  if (!roster || roster.length === 0) return activePlayers(room);
  const byUid = new Map(playerList(room).map((p) => [p.uid, p]));
  return roster
    .map((uid) => byUid.get(uid))
    .filter((p): p is PlayerInfo => p != null);
}

/**
 * Is this phone playing the round that's on screen? A player who handed the
 * seat back (closed the site) is not playing anything any more; one who merely
 * went dark still is, and keeps its place in a round it was rostered for.
 */
export function inCurrentRound(room: RoomData | null, uid: string | null | undefined): boolean {
  const roster = room?.engine?.roundUids ?? room?.meta?.roundUids;
  if (!uid) return false;
  const player = room?.players?.[uid];
  if (!player || player.left === true) return false;
  if (!roster || roster.length === 0) return true; // pre-snapshot round: everyone plays
  return roster.includes(uid);
}

/* ============================================================
 *  Between-round pacing and the Ready gate
 * ============================================================ */

export type Pacing = 'ready' | 'manual';

/**
 * Between-round pacing. The ready gate is the default *and* the fallback for
 * legacy rooms that stored 'auto' — auto-advance no longer exists.
 */
export function pacingOf(settings: RoomSettings | undefined | null): Pacing {
  return settings?.roundPacing === 'manual' ? 'manual' : 'ready';
}

export type GateBlockerState = 'waiting' | 'reconnecting' | 'away';

export interface GateBlocker {
  uid: string;
  state: GateBlockerState;
}

/**
 * Who the open gate is still waiting for.
 *
 * The gate belongs to the engine (`engine.gate`): it snapshots the
 * players it needs when it opens, so a disconnect cannot quietly shrink
 * the list. A required phone that drops is `reconnecting` for a grace
 * period — visible, and still holding the gate — and only becomes
 * `away` (not counted) after that. A phone that was already dark when
 * the gate opened was never required.
 */
export function gateBlockers(room: RoomData | null, now: number): GateBlocker[] {
  const gate = room?.engine?.gate;
  if (!gate || !gate.id) return [];
  const ready = room?.engine?.ready ?? {};
  const out: GateBlocker[] = [];
  // RTDB drops empty arrays: a gate that needs nobody has nothing to block on
  for (const uid of gate.uids ?? []) {
    if (ready[uid] === gate.id) continue;
    const player = room?.players?.[uid];
    if (!player || player.left === true) continue; // gave the seat back: not required any more
    if (player.local || isPresent(room, uid)) {
      out.push({ uid, state: 'waiting' });
    } else if (now - gate.openedAt < GATE_RECONNECT_GRACE_MS) {
      out.push({ uid, state: 'reconnecting' });
    } else {
      out.push({ uid, state: 'away' });
    }
  }
  return out;
}

/**
 * Is the gate satisfied? Every required phone must be present and have
 * tapped *this* gate, or be past the reconnect grace. Zero present
 * players is never unanimous — the host has to say so explicitly.
 */
export function gateSatisfied(room: RoomData | null, now: number): boolean {
  const gate = room?.engine?.gate;
  if (!gate || !gate.id) return false;
  const required = gate.uids ?? [];
  if (required.length === 0) return false;
  const present = required.filter((uid) => {
    const p = room?.players?.[uid];
    return !!p && p.left !== true && (p.local || isPresent(room, uid));
  });
  if (present.length === 0) return false; // nobody is holding the gate: not a green light
  return !gateBlockers(room, now).some((b) => b.state !== 'away');
}

/** Players the current gate still needs, ignoring the reconnect grace (for UI copy). */
export function notReady(room: RoomData | null, now: number): PlayerInfo[] {
  const byUid = new Map(playerList(room).map((p) => [p.uid, p]));
  return gateBlockers(room, now)
    .map((b) => byUid.get(b.uid))
    .filter((p): p is PlayerInfo => !!p);
}

/* ============================================================
 *  Turn order
 * ============================================================ */

/**
 * Whose turn it is for `round`: walk the claimed order from its scheduled
 * position until we hit somebody who is actually around to take it, so a phone
 * that's asleep never parks a round on a player who can't act. Falls back to
 * the round's first player (and to null for an empty room).
 */
export function actorFromOrder(
  order: string[] | undefined,
  players: PlayerInfo[],
  round: number,
): string | null {
  const cycle = order ?? [];
  if (cycle.length === 0) return players[0]?.uid ?? null;
  const start = (((round - 1) % cycle.length) + cycle.length) % cycle.length;
  for (let i = 0; i < cycle.length; i++) {
    const uid = cycle[(start + i) % cycle.length];
    if (players.some((p) => p.uid === uid)) return uid;
  }
  return players[0]?.uid ?? null;
}

/**
 * The claimed turn order, kept in step with the room: everyone who still has a
 * seat keeps their slot (a sleeping phone resumes its own when it wakes),
 * anybody who joined mid-match is appended at the back, and only players who
 * left the room drop out. Idempotent — write it back only when it changed.
 */
export function turnOrderForRoom(room: RoomData | null): string[] {
  const seated = activePlayers(room);
  const seatUids = new Set(seated.map((p) => p.uid));
  const claimed = room?.engine?.turnOrder ?? room?.meta?.turnOrder ?? [];
  const order = claimed.filter((uid) => seatUids.has(uid));
  for (const p of seated) if (!order.includes(p.uid)) order.push(p.uid);
  return order;
}
