/**
 * ============================================================
 *  BOOM CUP — two cups, two balls, one lap of the table
 * ============================================================
 * Two players start with a cup and a ball, as far apart around the table
 * as the seating allows. Everyone else is next in line.
 *
 *  - Flick up to shoot. A miss doesn't pass anything: you keep flicking until
 *    it drops, and every miss makes the mouth a little bigger (see physics.ts)
 *    so nobody is ever stuck forever.
 *  - A sink passes the cup to the NEXT player in the seating order — unless
 *    it was the FIRST try, and then the shooter hands it to anyone at the
 *    table they like, order be damned. Handing it to whoever is still holding
 *    the other ball is legal, and it catches them on the spot.
 *  - If your cup comes down on the player still holding the other ball, they
 *    are CAUGHT: they drink a beer from the middle and your ball plays
 *    straight on to the player after them. They keep their own cup on a fresh
 *    beer from the middle, so nobody is ever left juggling two cups and the
 *    chase never stops moving.
 *  - The middle holds one beer per player (3–6). Every catch drains one, and
 *    drinks land the moment they happen. When the last one goes, the player
 *    caught taking it drinks the BOOM (+2) and the round is over.
 *
 * Party mode: both holders shoot as fast as they can, for real — the
 * reducer simply takes their attempts in the order they arrive, so it's a
 * race with no turns at all. Shared phone: one attempt each, back and
 * forth, via `sharedHolderUid` — a miss still costs you a turn's ground.
 *
 * The round is host-authoritative and pure: the only randomness is the
 * players' own thumbs.
 */

import type {
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  OutcomeRecapGroup,
  PlayerInfo,
  ReduceResult,
} from '../../engine/types';
import { resolveShot } from './physics';
import { View } from './View';

/** what a caught player drinks, every time they're caught */
export const CATCH_SIPS = 1;
/** …and what the last one — the one who drained the middle — drinks on top */
export const BOOM_SIPS = 2;
/** beers in the middle: one per player, clamped to this range */
export const MIDDLE_MIN = 3;
export const MIDDLE_MAX = 6;
/** how long the ball takes to come back before you can flick again */
export const SHOT_COOLDOWN_MS = 450;
/** a first-try sink: how long the shooter gets to pick a victim */
export const HANDOFF_MS = 20_000;
/** nobody has shot for this long → the round closes itself (phones walking off) */
export const IDLE_MS = 150_000;

export type CupIndex = 0 | 1;

/** one attempt, kept in the state so every phone can draw it */
export interface BcShotLog {
  seq: number;
  cup: CupIndex;
  uid: string;
  made: boolean;
  /** where the ball landed, in mouth radii / mouth depths (0,0 = dead centre) */
  ex: number;
  ey: number;
  /** 1 = a perfect flick */
  power: number;
  /** misses burnt on this possession before this shot (the aim assist used) */
  misses: number;
  at: number;
}

export interface BcCatchLog {
  uid: string;
  byUid: string;
  at: number;
  boom: boolean;
}

export interface BcState {
  phase: 'shooting' | 'handoff';
  /** the seating order this round runs on (uids) */
  ring: string[];
  /** who is holding cup 0 and cup 1 */
  hold: [string, string];
  /** consecutive misses since each cup landed in its holder's hands */
  miss: [number, number];
  /** earliest server time each cup can be shot again (the ball is coming back) */
  nextAt: [number, number];
  /** shared phone only: which cup's attempt it is */
  turn: CupIndex;
  /** shot counter */
  seq: number;
  last: BcShotLog | null;
  /** a first-try sink, waiting on the shooter's choice */
  give: { uid: string; cup: CupIndex; nextUid: string; at: number } | null;
  /** beers still in the middle */
  middle: number;
  /** beers the middle started with (the View draws the empties) */
  middleMax: number;
  /** uid → how many times they were caught this round */
  caught: Record<string, number>;
  /** uids in the order they were caught */
  caughtOrder: string[];
  /** uids in the order they landed a catch */
  catchers: string[];
  lastCatch: BcCatchLog | null;
  boomUid: string | null;
  note: string | null;
}

export interface BcInput {
  /** a swipe at the cup you're holding */
  shot?: { dx: number; dy: number; ms: number };
  /** first-try sink: the uid you're handing the cup to */
  give?: string;
}

/* ---------- helpers (pure; also used by the View) ---------- */

const nameOf = (players: PlayerInfo[], uid: string | null | undefined): string =>
  players.find((p) => p.uid === uid)?.name ?? 'someone';

/** Everyone in the claimed turn order first, then anyone who joined later. */
function ringFor(ctx: GameContext): string[] {
  const ids = ctx.players.map((p) => p.uid);
  const ordered = (ctx.turnOrder ?? []).filter((u) => ids.includes(u));
  return [...ordered, ...ids.filter((u) => !ordered.includes(u))];
}

const flip = (c: CupIndex): CupIndex => (c === 0 ? 1 : 0);

/** The cups you're holding. */
export function cupsHeld(s: BcState, uid: string): CupIndex[] {
  return ([0, 1] as CupIndex[]).filter((c) => s.hold?.[c] === uid);
}

/** The cup you shoot right now (shared phone shoots the cup whose turn it is). */
export function activeCupFor(s: BcState, uid: string, shared: boolean): CupIndex | null {
  const mine = cupsHeld(s, uid);
  if (mine.length === 0) return null;
  if (shared && mine.includes(s.turn)) return s.turn;
  return mine[0];
}

/** Cup 0's holder, then cup 1's — the two people playing. */
export function holdersOf(s: BcState): [string, string] {
  return [s.hold?.[0] ?? '', s.hold?.[1] ?? ''];
}

/**
 * RTDB drops empty objects and arrays on the way out, so anything the View
 * reads gets a default here rather than a `??` on every line.
 */
export function readState(state: BcState): BcState {
  return {
    phase: state?.phase ?? 'shooting',
    ring: state?.ring ?? [],
    hold: state?.hold ?? ['', ''],
    miss: state?.miss ?? [0, 0],
    nextAt: state?.nextAt ?? [0, 0],
    turn: state?.turn ?? 0,
    seq: state?.seq ?? 0,
    last: state?.last ?? null,
    give: state?.give ?? null,
    middle: state?.middle ?? 0,
    middleMax: state?.middleMax ?? 3,
    caught: state?.caught ?? {},
    caughtOrder: state?.caughtOrder ?? [],
    catchers: state?.catchers ?? [],
    lastCatch: state?.lastCatch ?? null,
    boomUid: state?.boomUid ?? null,
    note: state?.note ?? null,
  };
}

/** Drop players who left mid-round; a vanished holder's cup moves on. */
function reconcile(s: BcState, ctx: GameContext): BcState {
  const ring0 = s.ring ?? [];
  const hold0 = s.hold ?? (['', ''] as [string, string]);
  const present = new Set(ctx.players.map((p) => p.uid));
  if (ring0.every((u) => present.has(u)) && hold0.every((u) => present.has(u))) return s;

  const ring = ring0.filter((u) => present.has(u));
  const nextPresent = (from: string): string => {
    const i = Math.max(0, ring0.indexOf(from));
    for (let k = 1; k <= ring0.length; k++) {
      const u = ring0[(i + k) % ring0.length];
      if (u && present.has(u)) return u;
    }
    return ring[0] ?? '';
  };
  const hold: [string, string] = [
    present.has(hold0[0]) ? hold0[0] : nextPresent(hold0[0]),
    present.has(hold0[1]) ? hold0[1] : nextPresent(hold0[1]),
  ];
  return { ...s, ring, hold };
}

/** the next player in the seating order (wrapping) */
function nextHolder(s: BcState, uid: string): string {
  const ring = s.ring ?? [];
  if (ring.length === 0) return uid;
  const i = ring.indexOf(uid);
  return ring[(i + 1) % ring.length] ?? uid;
}

function endOfRound(s: BcState, note: string): Effect[] {
  const caughtOrder = (s.caughtOrder ?? []).filter((u) => (s.caught ?? {})[u]);
  const catchers = [...new Set(s.catchers ?? [])];
  const groups: OutcomeRecapGroup[] = [];
  if (s.boomUid) groups.push({ label: '💥 Took the BOOM', tone: 'bad', uids: [s.boomUid] });
  if (caughtOrder.length > 0) {
    groups.push({ label: '🍺 Caught — drank from the middle', tone: 'bad', uids: caughtOrder });
  }
  if (catchers.length > 0) groups.push({ label: '🎯 Catchers', tone: 'good', uids: catchers });
  // Every sip was already applied the moment it landed (the table drinks as
  // it plays), so this effect only closes the round and recaps it.
  return [
    {
      type: 'END',
      assignments: [],
      note,
      recap: groups.length > 0 ? { title: 'how the table got caught', groups } : undefined,
    },
  ];
}

/**
 * The cup moves. If it arrives where the other ball still lives, that player is
 * caught: they drink on the spot, and the ball that caught them carries
 * straight on to the player after them — nobody is ever left juggling two
 * cups. They keep their own cup, on a fresh beer from the middle, so their
 * streak (and their next first-try free choice) starts over.
 */
function passTo(
  s: BcState,
  cup: CupIndex,
  targetUid: string,
  byUid: string,
  ctx: GameContext,
): ReduceResult<BcState> {
  const other = flip(cup);
  const shared = ctx.settings.mode === 'shared';
  const hold: [string, string] = [s.hold[0], s.hold[1]];
  const miss: [number, number] = [s.miss[0], s.miss[1]];
  hold[cup] = targetUid;
  miss[cup] = 0;

  const effects: Effect[] = [{ type: 'TIMER', ms: IDLE_MS }];
  let caught = s.caught ?? {};
  let caughtOrder = s.caughtOrder ?? [];
  let catchers = s.catchers ?? [];
  let middle = s.middle ?? 0;
  let boomUid = s.boomUid ?? null;
  let lastCatch = s.lastCatch ?? null;
  let boom = false;

  if ((hold[other] ?? '') === targetUid) {
    caught = { ...caught, [targetUid]: (caught[targetUid] ?? 0) + 1 };
    caughtOrder = [...caughtOrder, targetUid].filter((u, i, a) => a.indexOf(u) === i);
    if (byUid) catchers = [...catchers, byUid];
    middle = Math.max(0, middle - 1);
    // the beer they're drinking replaces their cup: fresh streak, and their
    // next first-try sink is a free choice again
    miss[other] = 0;
    // …and the ball that caught them doesn't stop there — it plays on to the
    // next player, so the catch costs them a drink and a turn's ground
    hold[cup] = nextHolder(s, targetUid);
    boom = middle <= 0;
    lastCatch = { uid: targetUid, byUid, at: ctx.now, boom };
    effects.push({
      type: 'DRINKS',
      assignments: [
        {
          uid: targetUid,
          sips: CATCH_SIPS,
          reason: byUid ? `Caught by ${nameOf(ctx.players, byUid)} — 🍺 from the middle` : 'Caught 🍺',
        },
      ],
    });
    if (byUid) effects.push({ type: 'SCORE', uid: byUid, delta: 1 });
    if (boom) {
      boomUid = targetUid;
      effects.push({
        type: 'DRINKS',
        assignments: [{ uid: targetUid, sips: BOOM_SIPS, reason: 'BOOM — the middle ran dry 💥' }],
      });
    }
  }

  const next: BcState = {
    ...s,
    hold,
    miss,
    middle,
    caught,
    caughtOrder,
    catchers,
    boomUid,
    lastCatch,
    phase: 'shooting',
    give: null,
    turn: shared ? flip(s.turn ?? 0) : (s.turn ?? 0),
  };

  if (boom) {
    effects.push(...endOfRound(next, `💥 ${nameOf(ctx.players, boomUid)} took the BOOM — the middle is dry`));
  }

  return { state: next, effects };
}

function shoot(
  s: BcState,
  uid: string,
  gesture: BcInput['shot'],
  ctx: GameContext,
): ReduceResult<BcState> {
  const shared = ctx.settings.mode === 'shared';
  const cup = activeCupFor(s, uid, shared);
  if (cup == null) return { state: s };
  if (shared && (s.turn ?? 0) !== cup) return { state: s };
  if (ctx.now < (s.nextAt?.[cup] ?? 0)) return { state: s }; // ball still coming back

  const misses = s.miss?.[cup] ?? 0;
  const shot = resolveShot(gesture, misses);
  if (!shot.ok) return { state: s };

  const nextAt: [number, number] = [s.nextAt?.[0] ?? 0, s.nextAt?.[1] ?? 0];
  nextAt[cup] = ctx.now + SHOT_COOLDOWN_MS;
  const seq = (s.seq ?? 0) + 1;
  const last: BcShotLog = {
    seq,
    cup,
    uid,
    made: shot.made,
    ex: shot.ex,
    ey: shot.ey,
    power: shot.power,
    misses,
    at: ctx.now,
  };
  const base: BcState = { ...s, seq, last, nextAt, note: null };

  if (!shot.made) {
    const miss: [number, number] = [s.miss?.[0] ?? 0, s.miss?.[1] ?? 0];
    miss[cup] = misses + 1;
    return {
      state: { ...base, miss, turn: shared ? flip(s.turn ?? 0) : (s.turn ?? 0) },
      effects: [{ type: 'TIMER', ms: IDLE_MS }],
    };
  }

  if (misses === 0) {
    // first try: pick anyone at the table, in any order
    return {
      state: {
        ...base,
        phase: 'handoff',
        give: { uid, cup, nextUid: nextHolder(s, uid), at: ctx.now },
      },
      effects: [{ type: 'TIMER', ms: HANDOFF_MS }],
    };
  }

  return passTo(base, cup, nextHolder(s, uid), uid, ctx);
}

function giveAway(s: BcState, uid: string, target: string, ctx: GameContext): ReduceResult<BcState> {
  const give = s.give;
  if (!give || give.uid !== uid) return { state: s };
  const ring = s.ring ?? [];
  // handing it to yourself isn't a thing; anything else at the table is —
  // including the player holding the other ball, which catches them
  const wanted = ring.includes(target) && target !== uid ? target : give.nextUid;
  return passTo(s, give.cup, wanted, uid, ctx);
}

export const definition: GameDefinition<BcState, BcInput> = {
  id: 'boom-cup',
  name: 'Boom Cup',
  emoji: '💥',
  rules:
    'Two of you start with a cup and a ball — everyone else is next in line. Flick up to shoot: miss and you keep flicking; sink it and the cup goes to the next player, unless it was your FIRST try, and then you hand it to anyone at the table, order be damned. If your cup comes down on whoever is still holding the other ball they are CAUGHT: they drink a beer from the middle, and your ball plays straight on to the player after them. They keep their own cup, fresh, and the chase carries on. The middle holds a beer per player — when the last one is drained, whoever is caught taking it drinks the BOOM.',
  minPlayers: 2,
  sharedInput: 'all',

  createInitialState(ctx: GameContext): BcState {
    const ring = ringFor(ctx);
    const n = ring.length;
    // as far apart as the table allows — the chase starts with a gap
    const second = n >= 2 ? Math.floor(n / 2) : 0;
    const middle = Math.min(MIDDLE_MAX, Math.max(MIDDLE_MIN, n));
    return {
      phase: 'shooting',
      ring,
      hold: [ring[0] ?? '', ring[second] ?? ring[0] ?? ''],
      miss: [0, 0],
      nextAt: [0, 0],
      turn: 0,
      seq: 0,
      last: null,
      give: null,
      middle,
      middleMax: middle,
      caught: {},
      caughtOrder: [],
      catchers: [],
      lastCatch: null,
      boomUid: null,
      note: null,
    };
  },

  reduce(state, event: GameEvent<BcInput>, ctx: GameContext): ReduceResult<BcState> {
    const s = reconcile(state, ctx);

    // everyone else's phone died / walked off — close the round rather than hang
    if (ctx.players.length < 2 || (s.ring ?? []).length < 2) {
      return { state: s, effects: endOfRound(s, '🥤 not enough players left — round over') };
    }

    if (event.type === 'BEGIN') {
      // nothing is on a clock until somebody shoots; this only closes a round
      // nobody ever actually plays
      return { state: s, effects: [{ type: 'TIMER', ms: IDLE_MS }] };
    }

    if (event.type === 'INPUT') {
      const input = event.input ?? {};
      if (s.phase === 'handoff' && input.give) return giveAway(s, event.uid, input.give, ctx);
      if (s.phase === 'shooting' && input.shot) return shoot(s, event.uid, input.shot, ctx);
      return { state: s };
    }

    if (event.type === 'TIME_UP') {
      if (s.phase === 'handoff' && s.give) {
        // the shooter wandered off mid-choice — it just goes to the next player
        return passTo(s, s.give.cup, s.give.nextUid, s.give.uid, ctx);
      }
      const caught = (s.caughtOrder ?? []).length;
      return {
        state: s,
        effects: endOfRound(
          s,
          caught > 0
            ? `⏱ the table stopped shooting — ${caught} caught this round`
            : '⏱ nobody sank a ball — no drinks 🥤',
        ),
      };
    }

    return { state: s };
  },

  /** shared phone: it travels to whichever of the two shooters is up */
  sharedHolderUid(state: BcState): string | null {
    const s = readState(state);
    if (s.phase === 'handoff') return s.give?.uid ?? null;
    return s.hold[s.turn] ?? null;
  },

  View,
};

export default definition;
