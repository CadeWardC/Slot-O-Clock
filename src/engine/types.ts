import type { ComponentType } from 'react';

/**
 * ============================================================
 *  Slot-O-Clock game plugin contract
 * ============================================================
 * A minigame is a folder under src/games/<Name>/ exporting a
 * `definition.ts` with a default GameDefinition. It is picked up
 * automatically at build time — no registry to edit.
 *
 * You write:
 *   - metadata (id, name, emoji, rules)
 *   - createInitialState(): fresh state for one round
 *   - reduce(): pure state transitions, runs ONLY on the host device
 *   - View: one React component rendered identically on every phone
 *
 * The engine gives you for free: turn claiming ("I'll Start" /
 * "I'm Next"), intro splash, input plumbing, server-fair timers,
 * drink assignments, outcome screen, scores, shared-phone gating.
 */

export interface PlayerInfo {
  uid: string;
  name: string;
  emoji: string;
  isHost: boolean;
  /** false once the device disconnects (party mode) */
  connected: boolean;
  /** true for shared-phone players added locally by the host (no device) */
  local: boolean;
  drinkCount: number;
  score: number;
  joinedAt: number;
}

export type RoomMode = 'party' | 'shared';

export interface RoomSettings {
  mode: RoomMode;
  /** true = count "points" instead of sips (sober play) */
  pointsMode: boolean;
  /** multiplies every drink assignment */
  sipMultiplier: number;
  /** game ids enabled for this room's rotation */
  enabledGames: string[];
  /** trivia topic ids enabled for the Booze Trivia question pool (all if missing — legacy rooms) */
  triviaTopics?: string[];
}

export interface GameContext {
  /** connected players (plus local shared-phone players), join order */
  players: PlayerInfo[];
  /** player who claimed this round via I'll Start / I'm Next */
  actorUid: string | null;
  /** the room's claimed turn order (ceremony result); may be empty */
  turnOrder: string[];
  settings: RoomSettings;
  /** seeded 0..1 rng — use for all randomness so it stays host-authoritative */
  rng: () => number;
  /** server-corrected timestamp (ms) */
  now: number;
}

export type GameEvent<I = unknown> =
  | { type: 'BEGIN' }
  | { type: 'INPUT'; uid: string; input: I }
  | { type: 'TIME_UP'; now: number };

export interface DrinkAssignment {
  uid: string;
  sips: number;
  reason: string;
}

export type Effect =
  /** mid-game drinking (applied immediately, shown in the feed) */
  | { type: 'DRINKS'; assignments: DrinkAssignment[] }
  | { type: 'SCORE'; uid: string; delta: number }
  /** arm a server-fair countdown; a TIME_UP event fires when it hits zero */
  | { type: 'TIMER'; ms: number }
  /** end the round; `assignments` are applied AND shown on the outcome screen */
  | { type: 'END'; assignments?: DrinkAssignment[]; note?: string | null };

export interface ReduceResult<S> {
  state: S;
  effects?: Effect[];
}

export interface GameViewProps<S = any, I = any> {
  state: S;
  /** you (party) or the player currently holding the shared phone (shared) */
  me: PlayerInfo;
  players: PlayerInfo[];
  /** claimed this round via I'll Start / I'm Next */
  actorUid: string | null;
  isActor: boolean;
  /** true if this device runs the authoritative host loop */
  isAuthority: boolean;
  /** my (or the shared holder's) latest submitted input this game, if any */
  myInput: I | null;
  /** uids that have submitted an input this game (normalized to forUid) */
  answeredUids: string[];
  /** server-time deadline for the current engine timer, if armed */
  timerEndsAt: number | null;
  /** submit an input; engine routes it to the host reducer */
  submitInput: (input: I) => void;
  variant: RoomMode;
}

export interface GameDefinition<S = any, I = any> {
  id: string;
  name: string;
  emoji: string;
  /** shown on the intro splash — one or two short sentences */
  rules: string;
  minPlayers: number;
  /**
   * Shared-phone input mode:
   *  - 'all' (default): every player submits something — the engine gates
   *    inputs pass-the-phone style.
   *  - 'actor': only the turn actor plays — the phone goes straight to
   *    them (Slots, Categories).
   */
  sharedInput?: 'all' | 'actor';
  createInitialState(ctx: GameContext): S;
  reduce(state: S, event: GameEvent<I>, ctx: GameContext): ReduceResult<S>;
  View: ComponentType<GameViewProps<S, I>>;
}
