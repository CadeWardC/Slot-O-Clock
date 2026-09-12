import type {
  DrinkAssignment,
  OutcomeRecap,
  PlayerInfo,
  RoomMode,
  RoomSettings,
} from './engine/types';

export const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // 12h, mirrored in database.rules.json

export type RoomPhase = 'lobby' | 'claim' | 'intro' | 'playing' | 'outcome' | 'ended';

export interface OutcomeInfo {
  gameId: string;
  gameName: string;
  gameEmoji: string;
  assignments: DrinkAssignment[];
  note?: string;
  /** optional colour-coded breakdown of how the round was decided */
  recap?: OutcomeRecap | null;
}

export interface RoomMeta {
  code: string;
  createdAt: number;
  ownerUid: string;
  mode: RoomMode;
  phase: RoomPhase;
  /** 0 during the ordering ceremony, 1+ once rounds begin */
  round: number;
  /** shuffled pool of enabled game ids */
  rotation: string[];
  gameIndex: number;
  /**
   * Turn order claimed once at game start via I'll Start / I'm Next.
   * Round N's actor is turnOrder[(N - 1) % turnOrder.length].
   */
  turnOrder?: string[];
  /** host escape hatch: lock in the current order without waiting for everyone */
  forceStart?: boolean;
  /** actor for the current round, derived from turnOrder by the host loop */
  actorUid: string | null;
  /**
   * Who is playing the round currently on screen, snapshotted by the host when
   * it launches the round. Stable for the whole round: a phone that dies
   * mid-round keeps its seat, and a player who joins mid-round is out of it
   * and plays from the next one. Cleared on the way into the next intro.
   */
  roundUids?: string[] | null;
  /**
   * Legacy field (rooms created before the intro ready gate stored a splash
   * deadline here). The intro splash is not on a clock any more — see the
   * 'intro' branch of the host loop.
   */
  introEndsAt?: number | null;
  outcomeEndsAt?: number | null;
  /** manual pacing: set by the host's continue button to leave the outcome screen */
  forceNext?: boolean;
  outcome?: OutcomeInfo | null;
  /** server-time TTL — any client may delete the room once past it (see state/gc.ts) */
  expiresAt?: number;
  settings: RoomSettings;
}

export interface GameInputEntry {
  uid: string;
  /** shared-phone mode: the local player the input counts for */
  forUid?: string | null;
  at: number;
  input: unknown;
}

export interface GameNode {
  type: string;
  state: any;
  timerEndsAt?: number | null;
  inputs?: Record<string, GameInputEntry>;
}

export interface EventEntry {
  at: number;
  text: string;
}

export interface RoomData {
  meta: RoomMeta;
  players: Record<string, PlayerInfo>;
  /** turnClaim/{slot} = first player to claim that order position */
  turnClaim?: Record<string, { uid: string; at: number }>;
  game?: GameNode | null;
  events?: Record<string, EventEntry>;
}

export interface Session {
  code: string;
  uid: string;
}

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

export function playerList(room: RoomData | null): PlayerInfo[] {
  if (!room?.players) return [];
  return Object.values(room.players).sort((a, b) => a.joinedAt - b.joinedAt);
}

/* ---------- who is in the room, who is around, who plays this round ---------- */

/**
 * Everyone who still has a seat: shared-phone locals, live phones **and**
 * phones that merely went dark. A sleeping phone is *not* a departure — it
 * keeps its seat, score and turn and slides straight back in when it wakes.
 * Only `left` (closed the site / tapped leave) takes a seat away.
 */
export function activePlayers(room: RoomData | null): PlayerInfo[] {
  return playerList(room).filter((p) => p.left !== true);
}

/** Players whose phone is actually live right now (plus shared-phone locals). */
export function livePlayers(room: RoomData | null): PlayerInfo[] {
  return activePlayers(room).filter((p) => p.local || p.connected);
}

/** Seats given up on purpose — closed the site, or tapped "leave room". */
export function departedPlayers(room: RoomData | null): PlayerInfo[] {
  return playerList(room).filter((p) => p.left === true);
}

/**
 * The round on screen: the roster the host snapshotted at launch. Rooms that
 * predate the snapshot (or a round the host never got to label) fall back to
 * every seat in the room.
 */
export function roundPlayers(room: RoomData | null): PlayerInfo[] {
  const roster = room?.meta?.roundUids;
  if (!roster || roster.length === 0) return activePlayers(room);
  const byUid = new Map(playerList(room).map((p) => [p.uid, p]));
  return roster
    .map((uid) => byUid.get(uid))
    .filter((p): p is PlayerInfo => p != null);
}

/** Is this phone playing the round that's on screen? */
export function inCurrentRound(room: RoomData | null, uid: string | null | undefined): boolean {
  const roster = room?.meta?.roundUids;
  if (!uid) return false;
  if (!roster || roster.length === 0) return true; // pre-snapshot round: everyone plays
  return roster.includes(uid);
}

/* ---------- between-round pacing ---------- */

export type Pacing = 'ready' | 'manual';

/**
 * Between-round pacing. The ready gate is the default *and* the fallback for
 * legacy rooms that stored 'auto' — auto-advance no longer exists.
 */
export function pacingOf(settings: RoomSettings | undefined | null): Pacing {
  return settings?.roundPacing === 'manual' ? 'manual' : 'ready';
}

/**
 * Who the round still has to wait for before it can start: only phones that
 * can actually tap. An asleep phone sits the count out instead of freezing the
 * table (it's still in the room, and it re-joins the next round it's awake for).
 */
export function notReady(room: RoomData | null): PlayerInfo[] {
  return livePlayers(room).filter((p) => p.ready !== true);
}

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
  const order = (room?.meta?.turnOrder ?? []).filter((uid) => seatUids.has(uid));
  for (const p of seated) if (!order.includes(p.uid)) order.push(p.uid);
  return order;
}

/**
 * Multi-path update payload that clears every player's ready flag. Written
 * as part of the *same* update that enters the outcome screen, so the ready
 * gate can never be satisfied by a stale flag from the round before.
 */
export function readyResetPaths(room: RoomData | null): Record<string, boolean> {
  const paths: Record<string, boolean> = {};
  for (const uid of Object.keys(room?.players ?? {})) paths[`players/${uid}/ready`] = false;
  return paths;
}
