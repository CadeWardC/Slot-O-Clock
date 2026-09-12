import type { DrinkAssignment, PlayerInfo, RoomMode, RoomSettings } from './engine/types';

export const INTRO_MS = 5000;
export const ROOM_TTL_MS = 12 * 60 * 60 * 1000; // 12h, mirrored in database.rules.json

export type RoomPhase = 'lobby' | 'claim' | 'intro' | 'playing' | 'outcome' | 'ended';

export interface OutcomeInfo {
  gameId: string;
  gameName: string;
  gameEmoji: string;
  assignments: DrinkAssignment[];
  note?: string;
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
  introEndsAt?: number;
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

/** Players that participate: connected devices plus shared-phone locals. */
export function activePlayers(room: RoomData | null): PlayerInfo[] {
  return playerList(room).filter((p) => p.local || p.connected);
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

/** Everyone still in the room who hasn't tapped Ready for the next round. */
export function notReady(room: RoomData | null): PlayerInfo[] {
  return activePlayers(room).filter((p) => p.ready !== true);
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
