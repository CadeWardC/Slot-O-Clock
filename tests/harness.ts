import { EngineWorker, type EngineCommand, type GameRegistry } from '../src/state/engine.ts';
import { initialEngine } from '../src/state/room.ts';
import { LEASE_TTL_MS, PROTOCOL_VERSION } from '../src/state/protocol.ts';
import type { GameDefinition, PlayerInfo, RoomMode, RoomSettings } from '../src/engine/types.ts';
import type { EngineNode, GameInputEntry, GameTimer, RoomData, RoomPhase } from '../src/types.ts';
import { FakeStore } from './fakeStore.ts';

/** A clock the test owns: every deadline in these scenarios is a number. */
export class TestClock {
  now: number;
  constructor(start = 1_700_000_000_000) {
    this.now = start;
  }
  advance(ms: number): void {
    this.now += ms;
  }
}

export interface HarnessOptions {
  game: GameDefinition<any, any>;
  /** extra games the room's rotation may fall back to */
  allGames?: GameDefinition<any, any>[];
  players?: string[];
  mode?: RoomMode;
  settings?: Partial<RoomSettings>;
  uid?: string;
  instanceId?: string;
}

/**
 * ============================================================
 *  A whole table, in one process
 * ============================================================
 * `Harness` is the room: a fake server, one host worker (or several, for the
 * two-authority scenarios), a clock, and helpers that do exactly what a phone
 * does — write an input stamped with the stage it is looking at, acknowledge
 * the gate it can see, claim a turn-order slot.
 *
 * Nothing here reaches into the engine's internals: assertions are made
 * against the *store*, because the store is the only thing the phones see.
 */
export class Harness {
  readonly code = 'TEST';
  readonly uid: string;
  store: FakeStore;
  clock: TestClock;
  worker: EngineWorker;
  instanceId: string;
  readonly playerUids: string[];

  private idCounter = 0;
  private games: GameRegistry;
  private opts: HarnessOptions;

  constructor(opts: HarnessOptions) {
    this.opts = opts;
    this.clock = new TestClock();
    this.uid = opts.uid ?? 'host';
    this.instanceId = opts.instanceId ?? 'tab-1';
    this.playerUids = opts.players ?? ['host', 'p2', 'p3'];
    this.games = {
      all: opts.allGames ?? [opts.game],
      byId: new Map((opts.allGames ?? [opts.game]).map((g) => [g.id, g])),
    };
    this.store = new FakeStore(this.makeRoom());
    this.worker = this.makeWorker();
  }

  /* ---------------- room construction ---------------- */

  private makeRoom(): RoomData {
    const mode = this.opts.mode ?? 'party';
    const settings: RoomSettings = {
      mode,
      pointsMode: false,
      sipMultiplier: 1,
      enabledGames: [this.opts.game.id],
      roundPacing: 'ready',
      ...this.opts.settings,
    };
    const players: Record<string, PlayerInfo> = {};
    for (const uid of this.playerUids) {
      players[uid] = {
        uid,
        name: uid,
        emoji: '🍺',
        isHost: uid === this.uid,
        local: false,
        connected: true,
        connections: { 'tab-1': { at: this.clock.now } },
        drinkCount: 0,
        score: 0,
        joinedAt: this.clock.now,
      };
    }
    return {
      meta: {
        code: this.code,
        createdAt: this.clock.now,
        ownerUid: this.uid,
        mode,
        protocol: PROTOCOL_VERSION,
        settings,
        expiresAt: this.clock.now + 60 * 60 * 1000,
      },
      engine: initialEngine(this.uid, this.instanceId, this.clock.now),
      players,
    };
  }

  private makeWorker(instanceId = this.instanceId, uid = this.uid): EngineWorker {
    return new EngineWorker({
      code: this.code,
      uid,
      instanceId,
      store: this.store,
      games: this.games,
      now: () => this.clock.now,
      newId: () => `id${++this.idCounter}`,
      tickMs: 0, // the tests drive the queue themselves
    });
  }

  /* ---------------- lifecycle ---------------- */

  start(): void {
    this.worker.start();
  }

  /** Run everything queued, including work the pumps queue themselves. */
  async settle(rounds = 10): Promise<void> {
    for (let i = 0; i < rounds; i++) await this.worker.ping();
  }

  /** A host reload: same tab (same instance id), brand-new process. */
  async reload(): Promise<void> {
    this.worker.stop();
    this.worker = this.makeWorker();
    this.worker.start();
    await this.settle();
  }

  /**
   * The host process died without cleanup and another tab of the same player
   * picks the room up (the lease is stale, so it may take it over).
   */
  async takeoverAfterCrash(instanceId = 'tab-2'): Promise<void> {
    this.worker.stop();
    this.store.patch({ 'engine/lease/renewedAt': this.clock.now - LEASE_TTL_MS - 1 });
    this.instanceId = instanceId;
    this.worker = this.makeWorker(instanceId);
    this.worker.start();
    await this.settle();
  }

  /** A second host tab: same uid, different browser instance. */
  secondTab(instanceId = 'tab-2'): EngineWorker {
    const w = this.makeWorker(instanceId);
    w.start();
    return w;
  }

  command(cmd: EngineCommand): boolean {
    return this.worker.command(cmd);
  }

  async run(command: EngineCommand): Promise<void> {
    this.worker.command(command);
    await this.settle();
  }

  /* ---------------- what a phone sees ---------------- */

  get engine(): EngineNode {
    const engine = this.store.room.engine;
    if (!engine) throw new Error('room has no engine');
    return engine;
  }

  get phase(): RoomPhase {
    return this.engine.phase;
  }

  get timer(): GameTimer | null {
    return this.engine.game?.timer ?? null;
  }

  get state(): Record<string, any> {
    return this.engine.game?.state as Record<string, any>;
  }

  player(uid: string): PlayerInfo {
    const p = this.store.room.players[uid];
    if (!p) throw new Error(`no player ${uid}`);
    return p;
  }

  /** Presence is per connection: dropping the last one means "away". */
  setPresent(uid: string, present: boolean, instanceId = 'tab-1'): void {
    this.store.patch({
      [`players/${uid}/connections/${instanceId}`]: present
        ? { at: this.clock.now, tab: instanceId }
        : null,
    });
  }

  /** Exactly what AppState.submitInput writes. */
  async submit(uid: string, input: unknown, forUid?: string): Promise<string> {
    const engine = this.engine;
    const inputId = `in${++this.idCounter}`;
    const entry: GameInputEntry = {
      inputId,
      uid,
      forUid: forUid ?? null,
      at: this.clock.now,
      roundId: engine.roundId ?? '',
      phaseId: engine.phaseId ?? '',
      stageKey: engine.stageKey ?? '',
      input,
    };
    this.store.patch({ [`engine/game/inputs/${inputId}`]: entry });
    await this.settle();
    return inputId;
  }

  /** A submission stamped with an *older* stage, i.e. a delayed write. */
  submitStale(uid: string, input: unknown, roundId = 'old', phaseId = 'old'): string {
    const inputId = `stale${++this.idCounter}`;
    const entry: GameInputEntry = {
      inputId,
      uid,
      forUid: null,
      at: this.clock.now,
      roundId,
      phaseId,
      stageKey: `${roundId}:${phaseId}`,
      input,
    };
    this.store.patch({ [`engine/game/inputs/${inputId}`]: entry });
    return inputId;
  }

  async claim(uid: string): Promise<void> {
    const slot = Object.keys(this.engine.claims ?? {}).length;
    this.store.patch({ [`engine/claims/${slot}`]: { uid, at: this.clock.now } });
    await this.settle();
  }

  async ready(uid: string): Promise<void> {
    const gate = this.engine.gate;
    if (!gate) throw new Error('no gate open');
    this.store.patch({ [`engine/ready/${uid}`]: gate.id });
    await this.settle();
  }

  /** Every phone the gate asked for taps Ready. */
  async readyAll(): Promise<void> {
    const gate = this.engine.gate;
    if (!gate) throw new Error('no gate open');
    const paths: Record<string, unknown> = {};
    for (const uid of gate.uids ?? []) paths[`engine/ready/${uid}`] = gate.id;
    this.store.patch(paths);
    await this.settle();
  }

  /** The whole opening ceremony, up to the first round being on screen. */
  async startGame(): Promise<void> {
    await this.run({ type: 'start' });
    for (const uid of this.playerUids) {
      if (this.engine.phase !== 'claim') break;
      await this.claim(uid);
    }
    await this.readyAll();
  }

  /* ---------------- observations ---------------- */

  /** Every (phase, timer) pair the server has ever held — for mixed-snapshot checks. */
  snapshots(): { phase: RoomPhase; timerId: string | null; roundId: string | null }[] {
    return this.store.history.map((room) => ({
      phase: room.engine?.phase ?? 'lobby',
      timerId: room.engine?.game?.timer?.id ?? null,
      roundId: room.engine?.roundId ?? null,
    }));
  }

  /** Room values that show a new game stage still carrying the previous timer. */
  mixedSnapshots(): string[] {
    const bad: string[] = [];
    for (const room of this.store.history) {
      const engine = room.engine;
      if (!engine) continue;
      const timer = engine.game?.timer;
      if (!timer) continue;
      if (!engine.game || timer.roundId !== engine.roundId || timer.phaseId !== engine.phaseId) {
        bad.push(`${engine.phase}:${timer.id}`);
      }
    }
    return bad;
  }

  logKinds(): string[] {
    return (this.engine.log ?? []).map((entry) => entry.kind);
  }
}
