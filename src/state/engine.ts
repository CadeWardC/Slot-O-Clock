import { hashSeed, mulberry32, shuffled } from '../engine/rng';
import type {
  Effect,
  GameContext,
  GameDefinition,
  PlayerInfo,
  ReduceResult,
} from '../engine/types';
import {
  activePlayers,
  actorFromOrder,
  gateSatisfied,
  livePlayers,
  pacingOf,
  playerList,
  turnOrderForRoom,
  type EngineLogEntry,
  type EngineNode,
  type FaultInfo,
  type GameInputEntry,
  type GameTimer,
  type HostLease,
  type OutcomeInfo,
  type ReadyGate,
  type RecoveryInfo,
  type RoomData,
  type RoomPhase,
} from '../types';
import {
  ENGINE_LOG_MAX,
  ENGINE_STEP_BUDGET,
  ENGINE_TICK_MS,
  LEASE_RENEW_MS,
  LEASE_TTL_MS,
  MAX_COMMIT_ATTEMPTS,
  PROTOCOL_VERSION,
  ROOM_TTL_MS,
  shortId,
  stageKeyOf,
  TIMER_RECOVERY_GRACE_MS,
} from './protocol';
import type { EngineStore } from './store';

/**
 * ============================================================
 *  The engine worker — the host's whole brain, in one queue
 * ============================================================
 * v1 ran the phase machine from three places at once (a snapshot
 * callback, a 400 ms interval and a visibility handler), each writing
 * to the database independently, each trusting a private state mirror
 * that ran ahead of the server, and each able to interleave with the
 * others across an `await`. That is the "more than one transition can
 * run at once, and old work survives cleanup" bug, and it cannot be
 * fixed with more ifs — it is fixed by having exactly one place that
 * may decide anything.
 *
 * So: **one worker, one queue, one commit at a time.**
 *
 *   - Every signal (snapshot, tick, visibility, reconnect, host
 *     command) only *pings* the worker. Nothing else writes progress.
 *   - A ping appends one serialized pump to a promise chain, so two
 *     signals can never run two transitions concurrently.
 *   - Each pump re-derives what to do from the *database's* current
 *     value. There is no state mirror any more: the host's engine state
 *     IS `rooms/{code}/engine`, and a failed write can no longer leave
 *     the host ahead of everyone else.
 *   - Every commit is one `runTransaction` on that subtree, guarded by
 *     the revision, the host lease, the timer id and the input id it was
 *     computed from. A plan that no longer applies is refused and the
 *     worker re-derives, instead of forcing stale work onto a new phase.
 *   - Every await is followed by a generation check, so `stop()` (reload,
 *     lost lease, new host) kills in-flight work at its next boundary.
 */

export interface GameRegistry {
  all: GameDefinition<any, any>[];
  byId: ReadonlyMap<string, GameDefinition<any, any>>;
}

/** A deliberate host action. These enter the same queue as everything else. */
export type EngineCommand =
  | { type: 'start' }
  | { type: 'skip' }
  | { type: 'resume' }
  | { type: 'retry' }
  | { type: 'reset-awards' }
  | { type: 'sync' };

export interface EngineWorkerStatus {
  role: 'host' | 'viewer' | 'idle' | 'stopped';
  rev: number | null;
  fault: FaultInfo | null;
  /** a failure the room could not be told about (rules, offline) */
  localError: string | null;
}

export interface EngineWorkerOptions {
  code: string;
  uid: string;
  instanceId: string;
  store: EngineStore;
  games: GameRegistry;
  /** server-corrected clock */
  now: () => number;
  /** id factory (injectable so tests are deterministic) */
  newId?: () => string;
  onEvent?: (entry: EngineLogEntry) => void;
  onStatus?: (status: EngineWorkerStatus) => void;
  /** 0 disables the internal ticker (tests drive the worker with ping()) */
  tickMs?: number;
}

type Role = EngineWorkerStatus['role'];

interface Expect {
  rev: number;
  timerId?: string;
  inputId?: string;
  stageKey?: string | null;
}

type PlanLog = Omit<EngineLogEntry, 'at' | 'rev'>;

interface PlanParts {
  kind: string;
  expect: Expect;
  log: PlanLog;
  /** precomputed clock reading: no clock reads inside the transaction */
  now: number;
  /** next game content; `null` clears it, `undefined` leaves it alone */
  game?: { type: string; state: unknown; timer: GameTimer | null | undefined } | null;
  /** engine fields applied verbatim (phase machine, gate, recovery…) */
  fields?: Partial<Omit<EngineNode, 'game'>>;
  roundId?: string | null;
  phaseId?: string | null;
  /** pre-scaled drink awards, applied as increments on the absolute ledger */
  drinks?: { uid: string; sips: number; reason: string }[];
  scores?: { uid: string; delta: number }[];
  ack?: { inputId: string; eventId: string; applied: boolean };
  reject?: { inputId: string; reason: string };
}

interface EnginePlan {
  kind: string;
  expect: Expect;
  log: PlanLog;
  apply: (cur: EngineNode) => EngineNode;
  mirrors?: (engine: EngineNode) => Record<string, unknown>;
  /** why the transaction refused the plan (diagnostics only) */
  abort: string | null;
}

type Action =
  | { kind: 'bootstrap' }
  | { kind: 'lease-acquire' }
  | { kind: 'lease-renew' }
  | { kind: 'command'; command: EngineCommand }
  | { kind: 'claim' }
  | { kind: 'launch' }
  | { kind: 'reinit' }
  | { kind: 'input'; inputId: string }
  | { kind: 'reject-input'; inputId: string; reason: string }
  | { kind: 'timer'; timerId: string }
  | { kind: 'outcome' }
  | { kind: 'sync' };

/** Does this browser instance hold the room's engine? */
export function holdsLease(
  engine: EngineNode | null | undefined,
  uid: string,
  instanceId: string,
): boolean {
  const lease = engine?.lease;
  return !!lease && lease.uid === uid && lease.instanceId === instanceId;
}

/**
 * Realtime Database refuses `undefined` anywhere in a written value, and a
 * game that spreads an optional field can produce one. Dropping them here
 * (and turning non-finite numbers into null) keeps a reducer's output
 * writable without changing its meaning.
 */
function sanitize<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sanitize(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[key] = sanitize(v);
    }
    return out as T;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null as unknown as T;
  return value;
}

/**
 * Apply one planned transition to the engine node. Pure: the same plan
 * applied to newer data yields the same transition, which is what makes a
 * transaction retry safe — a retry re-applies the *decision*, it never
 * re-decides, so awards and acks can never be granted twice.
 */
function applyParts(cur: EngineNode, parts: PlanParts): EngineNode {
  const next: EngineNode = { ...cur };

  if (parts.roundId !== undefined) next.roundId = parts.roundId;
  if (parts.phaseId !== undefined) next.phaseId = parts.phaseId;
  if (parts.fields) Object.assign(next, parts.fields);
  next.stageKey = stageKeyOf(next.roundId, next.phaseId);

  // ---- inputs: acknowledge or refuse, then keep only the live stage ----
  const inputs: Record<string, GameInputEntry> = { ...(cur.game?.inputs ?? {}) };
  if (parts.ack) {
    const entry = inputs[parts.ack.inputId];
    if (entry) {
      inputs[parts.ack.inputId] = {
        ...entry,
        ack: {
          rev: cur.rev + 1,
          at: parts.now,
          eventId: parts.ack.eventId,
          applied: parts.ack.applied,
        },
        rejected: null,
      };
    }
  }
  if (parts.reject) {
    const entry = inputs[parts.reject.inputId];
    if (entry) inputs[parts.reject.inputId] = { ...entry, ack: null, rejected: parts.reject.reason };
  }
  const kept: Record<string, GameInputEntry> = {};
  for (const [id, entry] of Object.entries(inputs)) {
    if (!entry) continue;
    // a submission is only ever visible inside the stage it was made for…
    if (entry.stageKey === next.stageKey) {
      kept[id] = entry;
    } else if (entry.rejected && entry.roundId === next.roundId) {
      // …except a refusal, which stays readable for the rest of its own round
      // so the phone that sent it can see *why* it did not count.
      kept[id] = entry;
    }
  }

  const source = parts.game === undefined ? (cur.game ?? null) : parts.game;
  // `timer: undefined` means "the step did not touch the clock" — a state change
  // inside the same stage (a bet, a vote, a read card) leaves the running
  // countdown exactly where it was. Only a step that moves the stage, or arms a
  // timer of its own, may replace or cancel it.
  const timer: GameTimer | null =
    source && source.timer === undefined ? (cur.game?.timer ?? null) : (source?.timer ?? null);
  next.game = source
    ? { type: source.type, state: source.state, timer, inputs: kept }
    : null;

  // ---- awards: absolute totals, so a retry can never double-award ----
  if (parts.drinks || parts.scores) {
    const drinks = { ...(cur.awards?.drinks ?? {}) };
    for (const d of parts.drinks ?? []) {
      if (d.sips > 0) drinks[d.uid] = (drinks[d.uid] ?? 0) + d.sips;
    }
    const scores = { ...(cur.awards?.scores ?? {}) };
    for (const s of parts.scores ?? []) scores[s.uid] = (scores[s.uid] ?? 0) + s.delta;
    next.awards = { drinks, scores };
  }

  next.rev = cur.rev + 1;
  next.log = [...(cur.log ?? []), { ...parts.log, at: parts.now, rev: next.rev }].slice(
    -ENGINE_LOG_MAX,
  );
  return sanitize(next);
}

function checkExpect(
  cur: EngineNode,
  expect: Expect,
  uid: string,
  instanceId: string,
): string | null {
  if (cur.protov !== PROTOCOL_VERSION) return 'protocol-mismatch';
  if (cur.rev !== expect.rev) return 'stale-revision';
  if (!holdsLease(cur, uid, instanceId)) return 'lost-lease';
  if (expect.timerId !== undefined && cur.game?.timer?.id !== expect.timerId) return 'timer-replaced';
  if (expect.inputId !== undefined) {
    const entry = cur.game?.inputs?.[expect.inputId];
    if (!entry || entry.ack || entry.rejected) return 'already-processed';
  }
  if (expect.stageKey !== undefined && cur.stageKey !== expect.stageKey) return 'stage-changed';
  return null;
}

export class EngineWorker {
  private readonly code: string;
  private readonly uid: string;
  private readonly instanceId: string;
  private readonly store: EngineStore;
  private readonly games: GameRegistry;
  private readonly clock: () => number;
  private readonly newIdFn: () => string;
  private readonly tickMs: number;
  private onEvent?: (entry: EngineLogEntry) => void;
  private onStatusListener?: (status: EngineWorkerStatus) => void;

  private running = false;
  private generation = 0;
  private chain: Promise<void> = Promise.resolve();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;

  private room: RoomData | null = null;
  private commands: EngineCommand[] = [];
  private role: Role = 'idle';
  private localError: string | null = null;
  /** a commit failed here: nothing authoritative runs until a retry reconciles */
  private faulted = false;
  private lastTtlRefresh = 0;

  constructor(opts: EngineWorkerOptions) {
    this.code = opts.code;
    this.uid = opts.uid;
    this.instanceId = opts.instanceId;
    this.store = opts.store;
    this.games = opts.games;
    this.clock = opts.now;
    this.newIdFn = opts.newId ?? shortId;
    this.tickMs = opts.tickMs ?? ENGINE_TICK_MS;
    this.onEvent = opts.onEvent;
    this.onStatusListener = opts.onStatus;
  }

  /* ---------------- lifecycle ---------------- */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    const g = this.generation;
    this.unsub = this.store.subscribeRoom((room) => {
      if (!this.alive(g)) return;
      this.room = room;
      this.ping();
    });
    if (this.tickMs > 0) this.ticker = setInterval(() => this.ping(), this.tickMs);
    void this.resync();
  }

  /** Invalidate the generation first: in-flight work dies at its next boundary. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    this.unsub?.();
    this.unsub = null;
    if (this.ticker != null) clearInterval(this.ticker);
    this.ticker = null;
    this.commands = [];
    this.chain = Promise.resolve();
    this.setRole('stopped');
  }

  /** A host action. Refused when this tab is not the authority. */
  command(cmd: EngineCommand): boolean {
    if (!this.running) return false;
    if (this.role === 'viewer' || this.role === 'stopped') return false;
    this.commands.push(cmd);
    if (this.commands.length > 8) this.commands.splice(0, this.commands.length - 8);
    this.ping();
    return true;
  }

  /** Re-read the room from the server (reconnect, wake-up) and act on it. */
  async resync(): Promise<void> {
    if (!this.running) return;
    const g = this.generation;
    try {
      const room = await this.store.readRoom();
      if (!this.alive(g)) return;
      if (room) this.room = room;
      this.ping();
    } catch (e) {
      if (!this.alive(g)) return;
      this.noteError('read', e);
    }
  }

  status(): EngineWorkerStatus {
    return {
      role: this.role,
      rev: this.room?.engine?.rev ?? null,
      fault: this.room?.engine?.fault ?? null,
      localError: this.localError,
    };
  }

  /** Is the engine paused on a failure (in the room, or only on this device)? */
  get stopped(): boolean {
    return this.faulted || !!this.room?.engine?.fault;
  }

  /* ---------------- the queue ---------------- */

  /**
   * Append one pump. Signals never run two transitions concurrently, and the
   * returned promise settles when everything queued so far has been processed
   * (the tests use that as their determinism point; callers ignore it).
   */
  ping(): Promise<void> {
    if (!this.running) return Promise.resolve();
    const g = this.generation;
    this.chain = this.chain
      .then(() => (this.alive(g) ? this.pump(g) : undefined))
      .catch((e) => {
        if (this.alive(g)) this.noteError('pump', e);
      });
    return this.chain;
  }

  private alive(g: number): boolean {
    return this.running && this.generation === g;
  }

  private async pump(g: number): Promise<void> {
    let budget = ENGINE_STEP_BUDGET;
    while (budget-- > 0) {
      if (!this.alive(g)) return;
      const action = this.nextAction();
      if (!action) return;
      const outcome = await this.perform(action, g);
      if (!this.alive(g)) return;
      if (outcome === 'stop') return;
    }
  }

  /**
   * What to do next, decided from the database's own snapshot. Nothing is
   * queued privately any more: an input is "pending" because it is sitting in
   * `engine/game/inputs` without an acknowledgment, so a host reload or a
   * takeover recovers exactly the work that is genuinely outstanding — and
   * never re-runs work that was already committed.
   */
  private nextAction(): Action | null {
    const room = this.room;
    if (!room?.meta) return null;
    if (room.meta.protocol !== PROTOCOL_VERSION) {
      // A room this build does not understand is never driven, and never
      // commanded: the older client finishes its night on its own.
      this.commands.length = 0;
      this.setRole('viewer');
      return null;
    }
    const engine = room.engine;
    const now = this.clock();

    if (!engine) {
      return room.meta.ownerUid === this.uid ? { kind: 'bootstrap' } : null;
    }

    if (engine.fault || this.faulted) {
      // Nothing authoritative runs until the room is reconciled. A failure the
      // room could not even be told about (offline, rules) stops the engine
      // just as hard — a private copy of the state is not a fallback.
      const i = this.commands.findIndex((c) => c.type === 'retry');
      if (i >= 0) return { kind: 'command', command: this.commands.splice(i, 1)[0] };
      this.commands.length = 0;
      return null;
    }

    if (!holdsLease(engine, this.uid, this.instanceId)) {
      if (this.canAcquireLease(room, now)) return { kind: 'lease-acquire' };
      this.commands.length = 0; // not ours to run
      this.setRole('viewer');
      return null;
    }
    this.setRole('host');

    // Keep the lease warm *before* anything else: it is what stops a second
    // authority from appearing while this one is mid-transition.
    if (now - (engine.lease?.renewedAt ?? 0) >= LEASE_RENEW_MS) return { kind: 'lease-renew' };

    const command = this.commands.shift();
    if (command) return { kind: 'command', command };

    if (now - this.lastTtlRefresh > 10 * 60 * 1000) return { kind: 'sync' };

    if (engine.phase === 'lobby' || engine.phase === 'ended') return null;
    if (engine.phase === 'claim') return { kind: 'claim' };
    if (engine.phase === 'intro') {
      if (!this.currentDef(room)) return null;
      // 'manual' pacing left the splash in the host's hands (their tap sets
      // forceNext); 'ready' is the table's gate.
      const go =
        engine.forceNext === true ||
        (pacingOf(room.meta.settings) === 'ready' && gateSatisfied(room, now));
      return go ? { kind: 'launch' } : null;
    }
    if (engine.phase === 'playing') {
      if (!engine.game || engine.game.state == null) return { kind: 'reinit' };
      // Inputs before the clock: a tap that reached the database before the
      // deadline still counts, which is what makes "the final answer lands at
      // the deadline" produce exactly one transition instead of a skip.
      const pending = this.pendingInput(engine);
      if (pending) return pending;
      const timer = engine.game.timer;
      if (
        timer &&
        timer.roundId === engine.roundId &&
        timer.phaseId === engine.phaseId &&
        now >= timer.endsAt
      ) {
        if (engine.recovery) return null; // paused, visibly, for the table
        return { kind: 'timer', timerId: timer.id };
      }
      return null;
    }
    if (engine.phase === 'outcome') {
      const go =
        engine.forceNext === true ||
        (pacingOf(room.meta.settings) === 'ready' && gateSatisfied(room, now));
      return go ? { kind: 'outcome' } : null;
    }
    return null;
  }

  private pendingInput(engine: EngineNode): Action | null {
    const inputs = engine.game?.inputs ?? {};
    for (const [inputId, entry] of Object.entries(inputs)) {
      if (!entry || entry.ack || entry.rejected) continue;
      if (entry.stageKey === engine.stageKey) return { kind: 'input', inputId };
      // A submission from an earlier stage — a delayed write, or work left
      // over from a round that was skipped: refuse it visibly, never silently.
      return {
        kind: 'reject-input',
        inputId,
        reason: entry.roundId !== engine.roundId ? 'stale-round' : 'stale-phase',
      };
    }
    return null;
  }

  /* ---------------- performing actions ---------------- */

  private async perform(action: Action, g: number): Promise<'continue' | 'stop'> {
    try {
      if (action.kind === 'lease-acquire') return await this.acquireLease(g);
      if (action.kind === 'lease-renew') return await this.renewLease(g);
      if (action.kind === 'bootstrap') return await this.bootstrap(g);
      if (action.kind === 'sync') {
        await this.refreshTtl(g);
        return this.alive(g) ? 'continue' : 'stop';
      }

      for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt++) {
        if (!this.alive(g)) return 'stop';
        const room = this.room;
        if (!room?.engine) return 'stop';
        const plan = this.planFor(action, room);
        if (!plan) return 'continue'; // nothing left to do for this action
        const result = await this.commitPlan(plan, g);
        if (!this.alive(g)) return 'stop';
        if (result === 'committed') return 'continue';
        if (result === 'retry') continue; // re-derive from the newer revision
        return 'stop';
      }
      await this.reportFault('commit', `gave up after ${MAX_COMMIT_ATTEMPTS} attempts`, action.kind, g);
      return 'stop';
    } catch (e) {
      await this.reportFault('exception', e, action.kind, g);
      return 'stop';
    }
  }

  /**
   * One commit, against a known revision. Returning `undefined` from the
   * transaction callback aborts it, which is how a stale plan is refused
   * rather than applied to a room that has moved on.
   */
  private async commitPlan(plan: EnginePlan, g: number): Promise<'committed' | 'retry' | 'stop'> {
    plan.abort = null;
    const startedWall = Date.now();
    const res = await this.store.commitEngine((cur) => {
      if (!cur) return undefined;
      const refused = checkExpect(cur, plan.expect, this.uid, this.instanceId);
      if (refused) {
        plan.abort = refused;
        return undefined;
      }
      return plan.apply(cur);
    });
    if (!this.alive(g)) return 'stop';
    const latencyMs = Date.now() - startedWall;

    if (res.committed && res.value) {
      this.adopt(res.value);
      this.log({ ...plan.log, at: this.clock(), rev: res.value.rev, latencyMs });
      this.afterCommit(plan, res.value);
      return 'committed';
    }

    if (res.error) {
      await this.reportFault('commit', res.error, plan.kind, g);
      return 'stop';
    }

    // Aborted inside the transaction. A stale revision is normal — another
    // commit landed first — and means "re-derive", never "try the same thing
    // again": the decision itself may no longer be the right one.
    if (plan.abort === 'stale-revision') {
      await this.resync();
      return 'retry';
    }
    if (plan.abort === 'lost-lease') {
      this.log({ at: this.clock(), kind: 'lease-lost', detail: plan.kind });
      this.setRole('viewer');
      return 'stop';
    }
    // already-processed / timer-replaced / stage-changed: the work is done or
    // obsolete — exactly the outcomes we want, so drop it quietly.
    this.log({ at: this.clock(), kind: 'refused', detail: `${plan.kind}: ${plan.abort}` });
    return 'committed';
  }

  /** Take the committed value as the local truth — never a private guess. */
  private adopt(engine: EngineNode): void {
    if (this.room) this.room = { ...this.room, engine };
    this.onStatusListener?.(this.status());
  }

  private afterCommit(plan: EnginePlan, engine: EngineNode): void {
    if (!plan.mirrors) return;
    const paths = plan.mirrors(engine);
    if (Object.keys(paths).length > 0) {
      void this.store.write(paths).catch((e) => this.noteError('mirror', e));
    }
  }

  /* ---------------- lease ---------------- */

  private canAcquireLease(room: RoomData, now: number): boolean {
    const engine = room.engine;
    if (!engine) return false;
    const lease = engine.lease;
    if (!lease) return room.meta.ownerUid === this.uid;
    if (lease.uid !== this.uid) return false; // someone else's: takeover is explicit (👑)
    if (lease.instanceId === this.instanceId) return false; // we are the holder
    return now - lease.renewedAt > LEASE_TTL_MS; // our own uid, from a tab that is gone
  }

  private async acquireLease(g: number): Promise<'continue' | 'stop'> {
    const now = this.clock();
    const lease: HostLease = {
      uid: this.uid,
      instanceId: this.instanceId,
      generation: 0,
      renewedAt: now,
    };
    const res = await this.store.commitLease((cur) => {
      if (cur && cur.uid !== this.uid) return undefined;
      if (cur && cur.instanceId === this.instanceId) return undefined;
      if (cur && now - cur.renewedAt <= LEASE_TTL_MS) return undefined;
      lease.generation = (cur?.generation ?? 0) + 1;
      return lease;
    });
    if (!this.alive(g)) return 'stop';
    if (res.error) {
      await this.reportFault('lease', res.error, 'lease-acquire', g);
      return 'stop';
    }
    if (res.committed) {
      this.log({
        at: now,
        kind: 'lease-acquired',
        detail: `generation ${lease.generation} on ${this.instanceId}`,
      });
      this.setRole('host');
      await this.resync();
      return 'continue';
    }
    this.setRole('viewer');
    return 'stop';
  }

  private async renewLease(g: number): Promise<'continue' | 'stop'> {
    const now = this.clock();
    const generation = this.room?.engine?.lease?.generation ?? -1;
    const res = await this.store.commitLease((cur) => {
      if (!cur) return undefined;
      if (cur.uid !== this.uid || cur.instanceId !== this.instanceId) return undefined;
      if (cur.generation !== generation) return undefined;
      return { ...cur, renewedAt: now };
    });
    if (!this.alive(g)) return 'stop';
    if (res.error) {
      await this.reportFault('lease', res.error, 'lease-renew', g);
      return 'stop';
    }
    if (res.committed && res.value && this.room?.engine) {
      this.room = { ...this.room, engine: { ...this.room.engine, lease: res.value } };
      return 'continue';
    }
    // Somebody took the room while we were away: stand down immediately.
    await this.resync();
    this.setRole('viewer');
    return 'stop';
  }

  /* ---------------- a room with no engine node ---------------- */

  private async bootstrap(g: number): Promise<'continue' | 'stop'> {
    const now = this.clock();
    const roundId = this.newIdFn();
    const phaseId = this.newIdFn();
    const node: EngineNode = {
      protov: PROTOCOL_VERSION,
      lease: { uid: this.uid, instanceId: this.instanceId, generation: 1, renewedAt: now },
      rev: 1,
      phase: 'lobby',
      round: 0,
      roundId,
      phaseId,
      stageKey: stageKeyOf(roundId, phaseId),
      rotation: [],
      gameIndex: 0,
      turnOrder: [],
      actorUid: null,
      roundUids: null,
      forceNext: false,
      outcome: null,
      gate: null,
      ready: {},
      claims: {},
      game: null,
      awards: { scores: {}, drinks: {} },
      recovery: null,
      fault: null,
      log: [{ at: now, kind: 'bootstrap', detail: 'engine node created', rev: 1 }],
    };
    const res = await this.store.commitEngine((cur) => (cur ? undefined : node));
    if (!this.alive(g)) return 'stop';
    if (res.error) {
      await this.reportFault('bootstrap', res.error, 'bootstrap', g);
      return 'stop';
    }
    if (res.committed && res.value) {
      this.adopt(res.value);
      return 'continue';
    }
    return 'stop';
  }

  /* ---------------- planning ---------------- */

  private currentDef(room: RoomData): GameDefinition<any, any> | undefined {
    const id = room.engine?.rotation?.[room.engine.gameIndex] ?? '';
    return id ? this.games.byId.get(id) : undefined;
  }

  private defOf(room: RoomData): GameDefinition<any, any> | undefined {
    const id = room.engine?.game?.type ?? '';
    return id ? this.games.byId.get(id) : undefined;
  }

  /** This round's players: the roster the engine snapshotted at launch. */
  private roster(room: RoomData): PlayerInfo[] {
    const all = playerList(room);
    const ids = room.engine?.roundUids ?? null;
    if (!ids || ids.length === 0) return all.filter((p) => p.left !== true);
    const byUid = new Map(all.map((p) => [p.uid, p] as const));
    return ids.map((uid) => byUid.get(uid)).filter((p): p is PlayerInfo => !!p);
  }

  /** The roster a round starts with: whoever is here right now. */
  private launchRoster(room: RoomData): PlayerInfo[] {
    const present = livePlayers(room);
    return present.length > 0 ? present : activePlayers(room);
  }

  private buildCtx(room: RoomData, players: PlayerInfo[], now: number): GameContext {
    const engine = room.engine as EngineNode;
    return {
      players,
      actorUid: engine.actorUid,
      turnOrder: engine.turnOrder ?? [],
      settings: room.meta.settings,
      // seeded per round instance, and only ever used *before* the transaction
      rng: mulberry32(hashSeed(`${this.code}:${engine.roundId ?? engine.round}`)),
      now,
      roundId: engine.roundId ?? '',
      phaseId: engine.phaseId ?? '',
      revision: engine.rev,
    };
  }

  private planFor(action: Action, room: RoomData): EnginePlan | null {
    const now = this.clock();
    const rev = room.engine?.rev ?? -1;
    switch (action.kind) {
      case 'claim':
        return this.planClaim(room, now, rev);
      case 'launch':
        return this.planLaunch(room, now, rev);
      case 'reinit':
        return this.planReinit(room, now, rev);
      case 'input':
        return this.planInput(room, action.inputId, now, rev);
      case 'reject-input':
        return this.planReject(room, action.inputId, action.reason, now, rev);
      case 'timer':
        return this.planTimer(room, action.timerId, now, rev);
      case 'outcome':
        return this.planNextRound(room, now, rev);
      case 'command':
        return this.planCommand(room, action.command, now, rev);
      default:
        return null;
    }
  }

  private simplePlan(o: {
    kind: string;
    expect: Expect;
    log: PlanLog;
    now: number;
    parts: Omit<PlanParts, 'kind' | 'expect' | 'log' | 'now'>;
  }): EnginePlan {
    const parts: PlanParts = {
      kind: o.kind,
      expect: o.expect,
      log: o.log,
      now: o.now,
      ...o.parts,
    };
    return {
      kind: o.kind,
      expect: o.expect,
      log: o.log,
      abort: null,
      apply: (cur) => applyParts(cur, parts),
    };
  }

  /** The ordering ceremony: fold the claims in, then open round 1. */
  private planClaim(room: RoomData, now: number, rev: number): EnginePlan | null {
    const engine = room.engine as EngineNode;
    const order = [...(engine.turnOrder ?? [])];
    const claims = engine.claims ?? {};
    const slots = Object.keys(claims)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    for (const slot of slots) {
      const uid = (claims[slot] ?? claims[String(slot)])?.uid;
      if (!uid || order.includes(uid)) continue;
      const player = room.players?.[uid];
      if (!player || player.left === true) continue;
      order.push(uid);
    }
    const orderChanged = JSON.stringify(order) !== JSON.stringify(engine.turnOrder ?? []);
    const present = livePlayers(room);
    const complete = order.length > 0 && order.length >= Math.max(1, present.length);

    if (!complete) {
      if (!orderChanged) return null;
      return this.simplePlan({
        kind: 'claim-order',
        expect: { rev },
        log: { kind: 'claim-order', detail: `order now ${order.length} deep` },
        now,
        parts: { fields: { turnOrder: order } },
      });
    }
    return this.planRoundStart(room, order, now, rev, 'claim-complete');
  }

  /**
   * Open a round: lock the roster, hand out the actor, and open the intro
   * Ready gate from a clean slate — one commit, so no stale flag can ever
   * release the gate.
   */
  private planRoundStart(
    room: RoomData,
    order: string[],
    now: number,
    rev: number,
    kind: string,
  ): EnginePlan | null {
    const engine = room.engine as EngineNode;
    const roster = activePlayers(room);
    if (roster.length === 0) return null;
    const present = livePlayers(room);
    const round = engine.phase === 'claim' ? 1 : (engine.round ?? 1);
    const roundId = this.newIdFn();
    const phaseId = this.newIdFn();
    const actor = actorFromOrder(order, present.length > 0 ? present : roster, round);
    const gate: ReadyGate = {
      id: this.newIdFn(),
      kind: 'intro',
      // snapshot who the gate needs: a disconnect later cannot shrink the list
      uids: present.map((p) => p.uid),
      openedAt: now,
    };
    return this.simplePlan({
      kind,
      expect: { rev },
      log: { kind, detail: `round ${round} · ${present.length} phones · gate ${gate.id}` },
      now,
      parts: {
        roundId,
        phaseId,
        game: null,
        fields: {
          phase: 'intro' as RoomPhase,
          round,
          turnOrder: order,
          actorUid: actor,
          roundUids: null,
          forceNext: false,
          outcome: null,
          gate,
          ready: {},
          claims: {},
        },
      },
    });
  }

  /** Intro → playing: create the round's state and arm its first timer, once. */
  private planLaunch(room: RoomData, now: number, rev: number): EnginePlan | null {
    const engine = room.engine as EngineNode;
    const def = this.currentDef(room);
    if (!def) return null;
    // already launched for this round (a reload mid-intro must not re-roll it)
    if (engine.game && engine.game.type === def.id && engine.game.state != null) return null;
    const roster = this.launchRoster(room);
    if (roster.length === 0) return null;
    const ctx = this.buildCtx(room, roster, now);
    const initial = def.createInitialState(ctx);
    // BEGIN arms the first timer. Computed here, before the transaction, so the
    // transaction callback stays pure: no clock, no randomness, no rng.
    const res = def.reduce(initial, { type: 'BEGIN' }, ctx);
    return this.transitionPlan({
      kind: 'launch',
      room,
      now,
      rev,
      def,
      res,
      forceNewStage: true,
      fields: {
        phase: 'playing' as RoomPhase,
        roundUids: roster.map((p) => p.uid),
        gate: null,
        ready: {},
        forceNext: false,
        outcome: null,
      },
      detail: `${def.id} launched · ${roster.length} players`,
    });
  }

  /** RTDB drops empty objects: a game whose state vanished is rebuilt once. */
  private planReinit(room: RoomData, now: number, rev: number): EnginePlan | null {
    const engine = room.engine as EngineNode;
    const def = this.defOf(room) ?? this.currentDef(room);
    if (!def) return null;
    const roster = this.roster(room);
    const players = roster.length > 0 ? roster : this.launchRoster(room);
    if (players.length === 0) return null;
    const ctx = this.buildCtx(room, players, now);
    const initial = def.createInitialState(ctx);
    const res = def.reduce(initial, { type: 'BEGIN' }, ctx);
    return this.transitionPlan({
      kind: 'reinit',
      room,
      now,
      rev,
      def,
      res,
      forceNewStage: true,
      expectStageKey: engine.stageKey,
      detail: `${def.id} state rebuilt after data loss`,
    });
  }

  private planInput(room: RoomData, inputId: string, now: number, rev: number): EnginePlan | null {
    const engine = room.engine as EngineNode;
    const entry = engine.game?.inputs?.[inputId];
    if (!entry || entry.ack || entry.rejected) return null;
    const def = this.defOf(room) ?? this.currentDef(room);
    if (!def || !engine.game) return null;

    const roster = this.roster(room);
    const invalid = this.validateInput(room, entry, roster);
    if (invalid) return this.planReject(room, inputId, invalid, now, rev);

    const uid = entry.forUid ?? entry.uid;
    const ctx = this.buildCtx(room, roster, now);
    const before = engine.game.state;
    const res = def.reduce(before, { type: 'INPUT', uid, input: entry.input, inputId }, ctx);
    return this.transitionPlan({
      kind: 'input',
      room,
      now,
      rev,
      def,
      res,
      ack: { inputId, eventId: this.newIdFn(), applied: res.state !== before },
      expectInputId: inputId,
      detail: `${def.id} input from ${uid}`,
    });
  }

  /**
   * Round, phase, roster membership and shared-phone impersonation are all
   * checked here as well as by the database rules: a write that slipped
   * through a reconnect window still cannot act on a phase it was not made for.
   */
  private validateInput(room: RoomData, entry: GameInputEntry, roster: PlayerInfo[]): string | null {
    const engine = room.engine as EngineNode;
    if (entry.roundId !== engine.roundId || entry.phaseId !== engine.phaseId) return 'stale-phase';
    if (!entry.input || typeof entry.input !== 'object') return 'bad-payload';
    if (room.meta.mode === 'shared') {
      if (!entry.forUid) return 'no-holder';
      const target = room.players?.[entry.forUid];
      if (!target) return 'unknown-player';
      if (!target.local && entry.forUid !== entry.uid) return 'impersonation';
      if (!roster.some((p) => p.uid === entry.forUid)) return 'not-in-round';
    } else {
      if (entry.forUid && entry.forUid !== entry.uid) return 'impersonation';
      if (!roster.some((p) => p.uid === entry.uid)) return 'not-in-round';
    }
    return null;
  }

  private planReject(
    room: RoomData,
    inputId: string,
    reason: string,
    now: number,
    rev: number,
  ): EnginePlan | null {
    const entry = room.engine?.game?.inputs?.[inputId];
    if (!entry || entry.ack || entry.rejected) return null;
    return this.simplePlan({
      kind: 'input-rejected',
      expect: { rev, inputId },
      log: { kind: 'input-rejected', detail: `${inputId}: ${reason}` },
      now,
      parts: { reject: { inputId, reason } },
    });
  }

  /**
   * A deadline came due. The timeout is only ever dispatched for the exact
   * timer that is still active, and the transition that consumes it replaces
   * that timer in the same commit — so a stale timeout can neither fire twice
   * nor land on the phase that replaced it.
   */
  private planTimer(room: RoomData, timerId: string, now: number, rev: number): EnginePlan | null {
    const engine = room.engine as EngineNode;
    const timer = engine.game?.timer;
    if (!timer || timer.id !== timerId) return null;
    if (timer.roundId !== engine.roundId || timer.phaseId !== engine.phaseId) return null;
    if (now < timer.endsAt) return null;
    if (engine.recovery) return null;

    const lateMs = now - timer.endsAt;
    if (lateMs > TIMER_RECOVERY_GRACE_MS) {
      // Too much of the activity happened with nobody watching. Pause and say
      // so, rather than cascading through phases the table never saw.
      const recovery: RecoveryInfo = {
        kind: 'timer-overdue',
        at: now,
        roundId: timer.roundId,
        phaseId: timer.phaseId,
        timerId: timer.id,
        lateMs,
        durationMs: timer.durationMs,
        message: `The host was away for ${Math.round(lateMs / 1000)}s`,
      };
      return this.simplePlan({
        kind: 'recovery-pause',
        expect: { rev, timerId },
        log: { kind: 'recovery-pause', detail: `${Math.round(lateMs / 1000)}s late on ${timer.id}` },
        now,
        parts: { fields: { recovery } },
      });
    }

    const def = this.defOf(room) ?? this.currentDef(room);
    if (!def) return null;
    const game = engine.game;
    if (!game) return null;
    const roster = this.roster(room);
    const ctx = this.buildCtx(room, roster, now);
    const res = def.reduce(
      game.state,
      { type: 'TIME_UP', now, timerId: timer.id, phaseId: timer.phaseId, roundId: timer.roundId },
      ctx,
    );
    return this.transitionPlan({
      kind: 'timer',
      room,
      now,
      rev,
      def,
      res,
      expectTimerId: timer.id,
      detail: `${def.id} deadline reached`,
    });
  }

  /** Outcome → the next round's intro, with a fresh gate and round identity. */
  private planNextRound(room: RoomData, now: number, rev: number): EnginePlan | null {
    const engine = room.engine as EngineNode;
    const settings = room.meta.settings;
    const enabled = (settings.enabledGames ?? []).filter((id) => this.games.byId.has(id));
    const pool = enabled.length > 0 ? enabled : this.games.all.map((g) => g.id);
    if (pool.length === 0) return null;

    const rotation = [...(engine.rotation ?? [])];
    let gameIndex = (engine.gameIndex ?? 0) + 1;
    let nextRotation = rotation;
    if (rotation.length === 0 || gameIndex >= rotation.length) {
      const rng = mulberry32(hashSeed(`${this.code}:rotation:${engine.round ?? 0}`));
      nextRotation = shuffled(pool, rng);
      gameIndex = 0;
    }
    const roster = activePlayers(room);
    if (roster.length === 0) return null;
    const present = livePlayers(room);
    const order = turnOrderForRoom(room);
    const round = (engine.round ?? 0) + 1;
    const actor = actorFromOrder(order, present.length > 0 ? present : roster, round);
    const gate: ReadyGate = {
      id: this.newIdFn(),
      kind: 'outcome',
      uids: present.map((p) => p.uid),
      openedAt: now,
    };
    const roundId = this.newIdFn();
    const phaseId = this.newIdFn();
    return this.simplePlan({
      kind: 'next-round',
      expect: { rev },
      log: { kind: 'next-round', detail: `round ${round} · ${nextRotation[gameIndex] ?? '?'}` },
      now,
      parts: {
        roundId,
        phaseId,
        game: null,
        fields: {
          phase: 'intro' as RoomPhase,
          round,
          rotation: nextRotation,
          gameIndex,
          turnOrder: order,
          actorUid: actor,
          roundUids: null,
          forceNext: false,
          outcome: null,
          gate,
          ready: {},
          claims: {},
        },
      },
    });
  }

  /** Host escape hatches, applied per phase but always through the same queue. */
  private planCommand(
    room: RoomData,
    command: EngineCommand,
    now: number,
    rev: number,
  ): EnginePlan | null {
    const engine = room.engine as EngineNode;
    switch (command.type) {
      case 'start': {
        if (engine.phase !== 'lobby') return null;
        const enabled = (room.meta.settings.enabledGames ?? []).filter((id) =>
          this.games.byId.has(id),
        );
        const pool = enabled.length > 0 ? enabled : this.games.all.map((g) => g.id);
        if (pool.length === 0) return null;
        const rng = mulberry32(hashSeed(`${this.code}:start:${now}`));
        const rotation = shuffled(pool, rng);
        const roundId = this.newIdFn();
        const phaseId = this.newIdFn();
        return this.simplePlan({
          kind: 'start',
          expect: { rev },
          log: { kind: 'start', detail: `${rotation.length} games enabled` },
          now,
          parts: {
            roundId,
            phaseId,
            game: null,
            fields: {
              phase: 'claim' as RoomPhase,
              round: 0,
              rotation,
              gameIndex: 0,
              turnOrder: [],
              actorUid: null,
              roundUids: null,
              outcome: null,
              gate: null,
              ready: {},
              claims: {},
              forceNext: false,
            },
          },
        });
      }

      case 'skip': {
        if (engine.phase === 'lobby' || engine.phase === 'ended') return null;
        if (engine.phase === 'intro' || engine.phase === 'outcome') {
          return this.simplePlan({
            kind: 'skip-gate',
            expect: { rev },
            log: { kind: 'skip', detail: `${engine.phase} gate released by the host` },
            now,
            parts: { fields: { forceNext: true } },
          });
        }
        if (engine.phase === 'claim') {
          const order = [...(engine.turnOrder ?? [])];
          for (const uid of Object.values(engine.claims ?? {}).map((c) => c?.uid)) {
            if (uid && !order.includes(uid)) order.push(uid);
          }
          const present = livePlayers(room);
          const seed = (present.length > 0 ? present : activePlayers(room)).map((p) => p.uid);
          const finalOrder = order.length > 0 ? order : seed.slice(0, 1);
          if (finalOrder.length === 0) return null;
          return this.planRoundStart(room, finalOrder, now, rev, 'claim-skipped');
        }
        // playing: end the round without a result, down the same path a game's
        // END effect takes, so the gate and the outcome stay consistent.
        const def = this.defOf(room) ?? this.currentDef(room);
        if (!def) return null;
        const present = livePlayers(room);
        const gate: ReadyGate = {
          id: this.newIdFn(),
          kind: 'outcome',
          uids: present.map((p) => p.uid),
          openedAt: now,
        };
        const phaseId = this.newIdFn();
        return this.simplePlan({
          kind: 'skip-round',
          expect: { rev },
          log: { kind: 'skip', detail: 'round skipped by the host' },
          now,
          parts: {
            phaseId,
            fields: {
              phase: 'outcome' as RoomPhase,
              outcome: {
                gameId: def.id,
                gameName: def.name,
                gameEmoji: def.emoji,
                assignments: [],
                note: 'Round skipped',
              },
              gate,
              ready: {},
              forceNext: false,
            },
            game: {
              type: def.id,
              state: engine.game?.state ?? null,
              timer: null,
            },
          },
        });
      }

      case 'resume': {
        const recovery = engine.recovery;
        if (!recovery) return null;
        const timer = engine.game?.timer;
        // Re-time the interrupted activity: the same countdown, the same
        // length, starting now — never a shortened or skipped one.
        const duration = Math.max(1000, timer?.durationMs ?? recovery.durationMs);
        const fresh: GameTimer | null =
          timer && timer.roundId === engine.roundId && timer.phaseId === engine.phaseId
            ? {
                id: this.newIdFn(),
                roundId: timer.roundId,
                phaseId: timer.phaseId,
                startsAt: now,
                endsAt: now + duration,
                durationMs: duration,
              }
            : null;
        return this.simplePlan({
          kind: 'resume',
          expect: { rev },
          log: { kind: 'resume', detail: `after ${Math.round(recovery.lateMs / 1000)}s away` },
          now,
          parts: {
            fields: { recovery: null },
            game: engine.game
              ? { type: engine.game.type, state: engine.game.state, timer: fresh }
              : undefined,
          },
        });
      }

      case 'retry': {
        this.localError = null;
        this.faulted = false;
        if (!engine.fault) return null; // only a local failure: re-derived next pump
        return this.simplePlan({
          kind: 'retry',
          expect: { rev },
          log: { kind: 'retry', detail: 'engine resumed by the host' },
          now,
          parts: { fields: { fault: null } },
        });
      }

      case 'reset-awards':
        return this.simplePlan({
          kind: 'reset-awards',
          expect: { rev },
          log: { kind: 'reset-awards', detail: 'ledger cleared' },
          now,
          parts: { fields: { awards: { scores: {}, drinks: {} } } },
        });

      default:
        return null;
    }
  }

  /**
   * The one place a reducer result becomes a plan: state, timer, stage
   * identity, awards, outcome, gate and acknowledgment, all committed
   * together — so a phone can never see a new phase paired with an old timer.
   */
  private transitionPlan(o: {
    kind: string;
    room: RoomData;
    now: number;
    rev: number;
    def: GameDefinition<any, any>;
    res: ReduceResult<unknown>;
    forceNewStage?: boolean;
    fields?: Partial<Omit<EngineNode, 'game'>>;
    ack?: { inputId: string; eventId: string; applied: boolean };
    expectInputId?: string;
    expectTimerId?: string;
    expectStageKey?: string | null;
    detail: string;
  }): EnginePlan {
    const engine = o.room.engine as EngineNode;
    const effects: Effect[] = o.res.effects ?? [];
    const statePhase = (o.res.state as { phase?: unknown } | null | undefined)?.phase;
    const prevPhase = (engine.game?.state as { phase?: unknown } | null | undefined)?.phase;
    const clears = effects.some((fx) => fx.type === 'CLEAR_INPUTS');
    // The phase id is the *input epoch*: a new internal phase, or an explicit
    // CLEAR_INPUTS, opens a new one, and everything stamped with the old one
    // (submissions, timeouts, acknowledgments) is out of scope from then on.
    const newStage = o.forceNewStage === true || clears || statePhase !== prevPhase;
    const roundId = engine.roundId ?? this.newIdFn();
    const phaseId = newStage ? this.newIdFn() : (engine.phaseId ?? this.newIdFn());

    const end = effects.find((fx) => fx.type === 'END');
    const timerFx = [...effects].reverse().find((fx) => fx.type === 'TIMER');
    const mult = o.room.meta.settings.pointsMode ? 1 : (o.room.meta.settings.sipMultiplier ?? 1);
    // Drinks come from mid-game DRINKS effects *and* from the END effect's
    // assignments: both land in the ledger that this same commit writes, so an
    // interruption can never leave the round finished with drinks unawarded.
    const awards = effects.flatMap((fx) =>
      fx.type === 'DRINKS'
        ? fx.assignments
        : fx.type === 'END'
          ? (fx.assignments ?? [])
          : [],
    );
    const drinks = awards
      .map((a) => ({ uid: a.uid, sips: Math.max(1, Math.round(a.sips * mult)), reason: a.reason }))
      .filter((a) => a.sips > 0);
    const scores = effects.flatMap((fx) =>
      fx.type === 'SCORE' ? [{ uid: fx.uid, delta: fx.delta }] : [],
    );

    // A timer the result asked for belongs to the *new* stage — never to the one
    // it replaced. A result that moves the stage without arming one ends the
    // countdown; a result that stays put leaves the running clock alone.
    const timer: GameTimer | null | undefined =
      timerFx && timerFx.type === 'TIMER'
        ? {
            id: this.newIdFn(),
            roundId,
            phaseId,
            startsAt: o.now,
            endsAt: o.now + timerFx.ms,
            durationMs: timerFx.ms,
          }
        : newStage || end
          ? null
          : undefined;

    const fields: Partial<Omit<EngineNode, 'game'>> = { ...o.fields };
    if (end && end.type === 'END') {
      const present = livePlayers(o.room);
      const gate: ReadyGate = {
        id: this.newIdFn(),
        kind: 'outcome',
        uids: present.map((p) => p.uid),
        openedAt: o.now,
      };
      const outcome: OutcomeInfo = {
        gameId: o.def.id,
        gameName: o.def.name,
        gameEmoji: o.def.emoji,
        assignments: end.assignments ?? [],
        note: end.note ?? null,
        recap: end.recap ?? null,
        eventId: o.ack?.eventId,
      };
      Object.assign(fields, {
        phase: 'outcome' as RoomPhase,
        outcome,
        gate,
        ready: {},
        forceNext: false,
      });
    }

    const expect: Expect = { rev: o.rev };
    if (o.expectTimerId !== undefined) expect.timerId = o.expectTimerId;
    if (o.expectInputId !== undefined) expect.inputId = o.expectInputId;
    if (o.expectStageKey !== undefined) expect.stageKey = o.expectStageKey;

    const log: PlanLog = { kind: o.kind, detail: o.detail, eventId: o.ack?.eventId };
    return this.simplePlan({
      kind: o.kind,
      expect,
      log,
      now: o.now,
      parts: {
        roundId,
        phaseId,
        fields,
        game: { type: o.def.id, state: o.res.state, timer },
        drinks,
        scores,
        ack: o.ack,
      },
    });
  }

  /* ---------------- failures, mirrors, logging ---------------- */

  private noteError(op: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.localError = `${op}: ${message}`;
    console.error(`[engine ${this.code}] ${op} failed`, error);
    this.log({ at: this.clock(), kind: 'error', detail: `${op}: ${message}` });
    this.onStatusListener?.(this.status());
  }

  /**
   * A commit failed outright. Authoritative processing stops here — the worker
   * will not touch the room again until the host reconciles — and the fault is
   * reported locally *and* (best effort) into the room, so every phone can see
   * that the table is paused instead of guessing why nothing moves.
   */
  private async reportFault(op: string, error: unknown, action: string, g: number): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.localError = `${op}: ${message}`;
    this.faulted = true;
    console.error(`[engine ${this.code}] ${op} failed during ${action}`, error);
    const fault: FaultInfo = {
      at: this.clock(),
      message: `${op}: ${message}`.slice(0, 200),
      op: action,
      rev: this.room?.engine?.rev ?? -1,
      attempts: MAX_COMMIT_ATTEMPTS,
    };
    try {
      await this.store.write({ 'engine/fault': fault });
    } catch {
      // the room is unwritable: the host's own banner is all we have
    }
    if (!this.alive(g)) return;
    if (this.room?.engine) this.room = { ...this.room, engine: { ...this.room.engine, fault } };
    this.onStatusListener?.(this.status());
  }

  private async refreshTtl(g: number): Promise<void> {
    const now = this.clock();
    this.lastTtlRefresh = now;
    const until = now + ROOM_TTL_MS - 60000;
    try {
      await this.store.writeRoot({
        [`rooms/${this.code}/meta/expiresAt`]: until,
        [`roomIndex/${this.code}`]: until,
      });
    } catch (e) {
      if (this.alive(g)) this.noteError('ttl', e);
    }
  }

  private log(entry: EngineLogEntry): void {
    this.onEvent?.(entry);
  }

  private setRole(role: Role): void {
    if (this.role === role) return;
    this.role = role;
    this.onStatusListener?.(this.status());
  }
}
