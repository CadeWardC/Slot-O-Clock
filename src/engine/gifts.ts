import type { DrinkAssignment, Effect, GameContext, GameDefinition, GameEvent, ReduceResult } from './types';

/**
 * ============================================================
 *  The hand-out: whoever did best gives drinks
 * ============================================================
 * A game that names `givers` on its END effect does not end there. This
 * wrapper holds the result back, opens one more stage in which each giver
 * taps names, and only then lets the END through — with the gifts added to
 * its assignments, each carrying `fromUid`.
 *
 * It is a reducer around the game's reducer, so the engine needs no new
 * phase and no new write path: the hand-out is an ordinary input in an
 * ordinary stage, with the stage's own countdown. The pending result rides in
 * the game state under `__gift`, which the game's own code never reads. The
 * shell draws the stage (screens/GameScreen.tsx) instead of the game's View.
 */

/** how long givers get; anything not dealt by then goes to nobody */
export const GIFT_MS = 20_000;
/** a single giver never hands out more than this, whatever a game asks for */
export const GIFT_MAX = 10;

export interface GiftGiver {
  uid: string;
  sips: number;
  why?: string;
}

export interface GiftStage {
  givers: GiftGiver[];
  /** giver uid → (target uid → sips); present once that giver has dealt */
  given?: Record<string, Record<string, number>>;
  /** the END the game produced, held until the hand-out is over */
  pending: Extract<Effect, { type: 'END' }>;
}

export type GiftInput = { gift: Record<string, number> };

type AnyState = Record<string, unknown> | null | undefined;

export function giftStageOf(state: unknown): GiftStage | null {
  const g = (state as AnyState)?.__gift as GiftStage | undefined;
  return g && Array.isArray(g.givers) && g.givers.length > 0 && g.pending ? g : null;
}

/** who still has drinks to hand out, in the order the game named them */
export function giftersWaiting(stage: GiftStage): GiftGiver[] {
  return stage.givers.filter((g) => !stage.given?.[g.uid]);
}

function finish<S>(state: S, stage: GiftStage, nameOf: (uid: string) => string): ReduceResult<S> {
  const gifts: DrinkAssignment[] = [];
  for (const giver of stage.givers) {
    for (const [uid, sips] of Object.entries(stage.given?.[giver.uid] ?? {})) {
      if (sips > 0) gifts.push({ uid, sips, reason: `From ${nameOf(giver.uid)}`, fromUid: giver.uid });
    }
  }
  const { givers: _givers, ...end } = stage.pending;
  const rest = { ...(state as Record<string, unknown>) };
  delete rest.__gift;
  return {
    state: rest as S,
    effects: [{ ...end, assignments: [...(end.assignments ?? []), ...gifts] }],
  };
}

/**
 * The game's reducer, with the hand-out stage folded in. Everything the
 * engine dispatches to a game goes through here.
 */
export function reduceWithGifts<S, I>(
  def: Pick<GameDefinition<S, I>, 'reduce'>,
  state: S,
  event: GameEvent<I>,
  ctx: GameContext,
): ReduceResult<S> {
  const stage = giftStageOf(state);
  const nameOf = (uid: string) => ctx.players.find((p) => p.uid === uid)?.name ?? 'Someone';

  if (stage) {
    if (event.type === 'TIME_UP') return finish(state, stage, nameOf);
    if (event.type !== 'INPUT') return { state };
    const giver = stage.givers.find((g) => g.uid === event.uid);
    const raw = (event.input as unknown as GiftInput | null)?.gift;
    if (!giver || stage.given?.[giver.uid] || !raw || typeof raw !== 'object') return { state };
    // only to players at the table, never to yourself, never more than you hold
    let left = giver.sips;
    const dealt: Record<string, number> = {};
    for (const p of ctx.players) {
      if (p.uid === giver.uid || left <= 0) continue;
      const want = Math.floor(Number(raw[p.uid]));
      if (!Number.isFinite(want) || want <= 0) continue;
      const n = Math.min(want, left);
      dealt[p.uid] = n;
      left -= n;
    }
    // an explicit "nobody" is still an answer: record it so the stage can close
    const given = { ...(stage.given ?? {}), [giver.uid]: Object.keys(dealt).length > 0 ? dealt : { [giver.uid]: 0 } };
    const next: GiftStage = { ...stage, given };
    const nextState = { ...(state as Record<string, unknown>), __gift: next } as S;
    return giftersWaiting(next).length === 0 ? finish(nextState, next, nameOf) : { state: nextState };
  }

  const res = def.reduce(state, event, ctx);
  const effects = res.effects ?? [];
  const end = effects.find((fx): fx is Extract<Effect, { type: 'END' }> => fx.type === 'END');
  if (!end || !end.givers || end.givers.length === 0) return res;

  // one entry per giver, at the table, with somebody else to give to
  const seen = new Set<string>();
  const givers: GiftGiver[] = [];
  for (const g of end.givers) {
    const sips = Math.min(GIFT_MAX, Math.floor(Number(g.sips)));
    if (!g.uid || seen.has(g.uid) || !(sips > 0)) continue;
    if (!ctx.players.some((p) => p.uid === g.uid)) continue;
    seen.add(g.uid);
    givers.push(g.why ? { uid: g.uid, sips, why: g.why } : { uid: g.uid, sips });
  }
  if (givers.length === 0 || ctx.players.length < 2) {
    const { givers: _drop, ...plain } = end;
    return { state: res.state, effects: effects.map((fx) => (fx === end ? plain : fx)) };
  }

  const stageNew: GiftStage = { givers, pending: end };
  return {
    state: { ...(res.state as Record<string, unknown>), __gift: stageNew } as S,
    effects: [
      ...effects.filter((fx) => fx !== end && fx.type !== 'TIMER'),
      { type: 'CLEAR_INPUTS' },
      { type: 'TIMER', ms: GIFT_MS },
    ],
  };
}
