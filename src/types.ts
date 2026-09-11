import type { DrinkAssignment, PlayerInfo, RoomMode, RoomSettings } from './engine/types';

export const INTRO_MS = 5000;
export const OUTCOME_MS = 9000;
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
  /** 1-based round counter; doubles as the turnClaim key */
  round: number;
  /** shuffled pool of enabled game ids */
  rotation: string[];
  gameIndex: number;
  /** claimed via I'll Start / I'm Next */
  actorUid: string | null;
  /** actor of the previous round — excluded from the next I'm Next claim */
  lastActorUid: string | null;
  introEndsAt?: number;
  outcomeEndsAt?: number;
  outcome?: OutcomeInfo | null;
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
