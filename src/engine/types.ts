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
  /**
   * Presence of the *page*: true while this player's phone holds a live
   * Realtime Database socket. A phone whose screen went dark drops it for a
   * moment and gets it straight back, so this is never a reason to drop
   * someone from the room — see `left` and `activePlayers`.
   */
  connected: boolean;
  /** true for shared-phone players added locally by the host (no device) */
  local: boolean;
  drinkCount: number;
  score: number;
  joinedAt: number;
  /**
   * Between-round ready gate: true once this player tapped Ready on the
   * outcome screen. The host loop clears it every time a round ends.
   */
  ready?: boolean;
  /**
   * Deliberate exit — the player closed the site or tapped "leave room".
   * Unlike `connected: false` (their phone is asleep; they keep their seat,
   * their score and their turn) this *is* a kick: the room drops them from
   * the ready gate, the turn order and the next round's roster until their
   * phone comes back and clears the flag. Set by the page-exit handler in
   * state/AppState.tsx.
   */
  left?: boolean;
  leftAt?: number;
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
  /**
   * Between-round pacing: 'ready' (the default) parks every round on the
   * outcome screen until all players tap Ready; 'manual' waits for the host.
   * Rooms created before the ready gate stored 'auto' — that now behaves
   * exactly like 'ready' (see `pacingOf` in src/types.ts).
   */
  roundPacing?: 'ready' | 'manual' | 'auto';
  /** trivia topic ids enabled for the Booze Trivia question pool (all if missing — legacy rooms) */
  triviaTopics?: string[];
}

export interface GameContext {
  /**
   * This round's players, join order — the roster the host snapshotted when it
   * launched the round (`meta.roundUids`). Stable for the whole round, so a
   * phone that dies mid-round stays in it and a mid-round joiner waits for the
   * next one.
   */
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

/** one labelled, colour-coded row of the round recap shown when drinks land */
export interface OutcomeRecapGroup {
  label: string;
  /** colour cue: 'bad' = red (the guilty/doomed side), 'good' = green, default plain */
  tone?: 'bad' | 'good' | 'neutral';
  uids: string[];
}

/**
 * Optional end-of-round breakdown a game can hand to the outcome screen —
 * it's where drinks are handed out, so the table gets to see who voted for
 * what (Never Have I Ever) before anyone taps ready.
 */
export interface OutcomeRecap {
  title?: string;
  groups: OutcomeRecapGroup[];
}

export type Effect =
  /** mid-game drinking (applied immediately, shown in the feed) */
  | { type: 'DRINKS'; assignments: DrinkAssignment[] }
  | { type: 'SCORE'; uid: string; delta: number }
  /** arm a server-fair countdown; a TIME_UP event fires when it hits zero */
  | { type: 'TIMER'; ms: number }
  /**
   * Wipe the recorded inputs for this game — multi-phase games use this
   * between phases so the shared-phone pass-around gate restarts and
   * `answeredUids`/`myInput` reflect the new phase only.
   */
  | { type: 'CLEAR_INPUTS' }
  /**
   * End the round; `assignments` are applied AND shown on the outcome screen.
   * `recap` rides along to that same screen as colour-coded groups.
   */
  | { type: 'END'; assignments?: DrinkAssignment[]; note?: string | null; recap?: OutcomeRecap };

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
  /**
   * Shared-phone mode only: which player should be holding the phone right
   * now. Defaults to the first player in join order who hasn't submitted an
   * input yet. Games with a turn order of their own (Poison passes the phone
   * from poisoner to poisoner) override it so the pass-around gate follows
   * the game rather than join order.
   */
  sharedHolderUid?: (
    state: S,
    ctx: { players: PlayerInfo[]; actorUid: string | null },
  ) => string | null;
  createInitialState(ctx: GameContext): S;
  reduce(state: S, event: GameEvent<I>, ctx: GameContext): ReduceResult<S>;
  View: ComponentType<GameViewProps<S, I>>;
}
