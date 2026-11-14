import pack from '../../content/sketchy.json';
import type {
  DrinkAssignment,
  Effect,
  GameContext,
  GameDefinition,
  GameEvent,
  OutcomeRecap,
  ReduceResult,
  Highlight,
} from '../../engine/types';
import { View } from './View';

const WORDS = pack as string[];

export const PICK_MS = 15_000;
export const DRAW_MS = 40_000;
/** one phone: nobody is typing, the table shouts — a little longer */
export const SHARED_DRAW_MS = 60_000;
export const REVEAL_MS = 6_000;

/** a stroke is hex "xxyy" per point on a 0–255 grid */
export const MAX_POINTS = 40;
/** a long line travels in several short pieces, so the cap counts pieces */
export const MAX_STROKES = 160;
export const MAX_GUESS = 24;
const FEED_SIZE = 6;
const MISS_SIPS = 1;
const BLANK_SIPS = 2;

export interface SkFeedLine {
  /** who */
  u: string;
  /** what they typed; empty when `ok` (the word is never echoed) */
  t: string;
  ok?: boolean;
  /** running number, so the view can key and animate new lines */
  k: number;
}

export interface SkState {
  phase: 'pick' | 'draw' | 'reveal';
  /** the three words the artist chooses from */
  options: string[];
  word: string | null;
  /** finished strokes, oldest first — RTDB drops this while it is empty */
  strokes?: string[];
  /** uids who got it, in the order they got it */
  got?: string[];
  feed?: SkFeedLine[];
  n: number;
  /** shared phone: what the artist said happened */
  verdict: 'got' | 'none' | null;
  assignments?: DrinkAssignment[];
  note: string | null;
}

export type SkInput =
  | { action: 'pick'; index: number }
  | { action: 'stroke'; pts: string }
  /** take back the last `n` pieces: one pen stroke, however many pieces it went out in */
  | { action: 'undo'; n?: number }
  | { action: 'clear' }
  | { action: 'guess'; text: string }
  | { action: 'verdict'; got: boolean };

/** lowercase letters and digits only: "Hot-Dog " and "hotdog" are the same guess */
export function normalise(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function matches(guess: string, word: string): boolean {
  const g = normalise(guess);
  const w = normalise(word);
  if (!g || !w) return false;
  const strip = (s: string) => (s.length > 3 && s.endsWith('s') ? s.slice(0, -1) : s);
  return g === w || strip(g) === strip(w);
}

export function validStroke(pts: unknown): pts is string {
  return (
    typeof pts === 'string' &&
    pts.length >= 4 &&
    pts.length <= MAX_POINTS * 4 &&
    pts.length % 4 === 0 &&
    /^[0-9a-f]+$/.test(pts)
  );
}

function guessers(ctx: GameContext) {
  return ctx.players.filter((p) => p.uid !== ctx.actorUid);
}

function toDraw(state: SkState, ctx: GameContext, index: number): ReduceResult<SkState> {
  const options = state.options ?? [];
  const word = options[Math.max(0, Math.min(options.length - 1, index))] ?? options[0] ?? 'beer';
  return {
    state: { ...state, phase: 'draw', word, strokes: [], got: [], feed: [] },
    effects: [{ type: 'TIMER', ms: ctx.settings.mode === 'shared' ? SHARED_DRAW_MS : DRAW_MS }],
  };
}

/** The moments worth a line on the drinks screen (see engine/roast.ts). */
function highlightsOf(state: SkState, ctx: GameContext): Highlight[] {
  if (!state.word || !ctx.actorUid) return [];
  // quoted, so the line reads right whether the word is "shark" or "spaghetti"
  const text = `"${state.word}"`;
  const got = state.got ?? [];
  if (ctx.settings.mode === 'shared') {
    return state.verdict === 'got' ? [] : [{ kind: 'sketch-nobody', uid: ctx.actorUid, text }];
  }
  if (got.length === 0) return [{ kind: 'sketch-nobody', uid: ctx.actorUid, text }];
  const all = guessers(ctx);
  if (all.length < 3) return [];
  const missed = all.filter((p) => !got.includes(p.uid));
  if (missed.length === 0) return [{ kind: 'sketch-everyone', uid: ctx.actorUid, text }];
  if (missed.length === 1) return [{ kind: 'sketch-one-missed', uid: missed[0].uid, text }];
  return [];
}

function toReveal(
  state: SkState,
  ctx: GameContext,
  extra: Effect[] = [],
  verdict: SkState['verdict'] = null,
): ReduceResult<SkState> {
  const artist = ctx.players.find((p) => p.uid === ctx.actorUid);
  const got = state.got ?? [];
  const shared = ctx.settings.mode === 'shared';
  const assignments: DrinkAssignment[] = [];
  let note: string;

  if (shared) {
    if (verdict === 'got') {
      note = `It was ${state.word}. Somebody got it, nobody drinks.`;
    } else {
      if (artist) assignments.push({ uid: artist.uid, sips: BLANK_SIPS, reason: 'Nobody could tell what it was' });
      note = `It was ${state.word}. Nobody got it.`;
    }
  } else if (got.length === 0) {
    if (artist) assignments.push({ uid: artist.uid, sips: BLANK_SIPS, reason: 'Nobody could tell what it was' });
    note = `It was ${state.word}. Nobody got it.`;
  } else {
    const missed = guessers(ctx).filter((p) => !got.includes(p.uid));
    for (const p of missed) assignments.push({ uid: p.uid, sips: MISS_SIPS, reason: `Did not get "${state.word}"` });
    const first = ctx.players.find((p) => p.uid === got[0]);
    note =
      missed.length === 0
        ? `It was ${state.word}. Everyone got it.`
        : `It was ${state.word}. ${first?.name ?? 'Someone'} got it first.`;
  }

  return {
    state: { ...state, phase: 'reveal', verdict, assignments, note },
    effects: [...extra, { type: 'TIMER', ms: REVEAL_MS }],
  };
}

function recapOf(state: SkState, ctx: GameContext): OutcomeRecap | undefined {
  if (ctx.settings.mode === 'shared') return undefined;
  const got = state.got ?? [];
  return {
    title: `The word was ${state.word}`,
    groups: [
      { label: 'Got it', tone: 'good', uids: got },
      { label: 'Missed it', tone: 'bad', uids: guessers(ctx).map((p) => p.uid).filter((u) => !got.includes(u)) },
    ],
  };
}

export const definition: GameDefinition<SkState, SkInput> = {
  id: 'sketchy',
  name: 'Sketchy',
  emoji: '✏️',
  rules:
    'One player picks a word and draws it with a finger. Everyone else types guesses. Miss it and you drink 1, and if nobody gets it the artist drinks 2. First to get it hands out 1.',
  minPlayers: 3,
  sharedInput: 'actor',

  createInitialState(ctx: GameContext): SkState {
    const options: string[] = [];
    let guard = 0;
    while (options.length < 3 && guard++ < 50) {
      const w = WORDS[Math.floor(ctx.rng() * WORDS.length)];
      if (w && !options.includes(w)) options.push(w);
    }
    return { phase: 'pick', options, word: null, n: 0, verdict: null, note: null };
  },

  reduce(state, event: GameEvent<SkInput>, ctx: GameContext): ReduceResult<SkState> {
    if (event.type === 'BEGIN') {
      return { state, effects: [{ type: 'TIMER', ms: PICK_MS }] };
    }

    if (event.type === 'TIME_UP') {
      if (state.phase === 'pick') return toDraw(state, ctx, 0);
      if (state.phase === 'draw') return toReveal(state, ctx, [], ctx.settings.mode === 'shared' ? 'none' : null);
      return {
        state,
        effects: [
          {
            type: 'END',
            assignments: state.assignments ?? [],
            note: state.note,
            recap: recapOf(state, ctx),
            highlights: highlightsOf(state, ctx),
            // first to get it hands 1 out (party mode: shared has no guessers)
            givers:
              ctx.settings.mode !== 'shared' && (state.got ?? []).length > 0
                ? [{ uid: (state.got ?? [])[0], sips: 1, why: 'First to get it' }]
                : undefined,
          },
        ],
      };
    }

    const input = event.input;
    if (!input || typeof input !== 'object') return { state };
    const isArtist = event.uid === ctx.actorUid;

    if (state.phase === 'pick') {
      if (input.action === 'pick' && isArtist) return toDraw(state, ctx, Number(input.index) || 0);
      return { state };
    }

    if (state.phase !== 'draw') return { state };
    const strokes = state.strokes ?? [];

    if (input.action === 'stroke') {
      if (!isArtist || !validStroke(input.pts) || strokes.length >= MAX_STROKES) return { state };
      return { state: { ...state, strokes: [...strokes, input.pts] } };
    }
    if (input.action === 'undo') {
      if (!isArtist || strokes.length === 0) return { state };
      const n = Math.max(1, Math.min(strokes.length, Math.floor(Number(input.n) || 1)));
      return { state: { ...state, strokes: strokes.slice(0, strokes.length - n) } };
    }
    if (input.action === 'clear') {
      if (!isArtist || strokes.length === 0) return { state };
      return { state: { ...state, strokes: [] } };
    }

    if (input.action === 'verdict') {
      // one phone: the artist reports what the table managed out loud
      if (!isArtist || ctx.settings.mode !== 'shared') return { state };
      return toReveal(state, ctx, [], input.got ? 'got' : 'none');
    }

    if (input.action === 'guess') {
      if (isArtist || ctx.settings.mode === 'shared') return { state };
      if (!ctx.players.some((p) => p.uid === event.uid)) return { state };
      const got = state.got ?? [];
      if (got.includes(event.uid)) return { state };
      const text = String(input.text ?? '').trim().slice(0, MAX_GUESS);
      if (!normalise(text)) return { state };
      const n = (state.n ?? 0) + 1;
      const feed = state.feed ?? [];

      if (!matches(text, state.word ?? '')) {
        return {
          state: { ...state, n, feed: [...feed, { u: event.uid, t: text, k: n }].slice(-FEED_SIZE) },
        };
      }

      const nextGot = [...got, event.uid];
      const next: SkState = {
        ...state,
        n,
        got: nextGot,
        feed: [...feed, { u: event.uid, t: '', ok: true, k: n }].slice(-FEED_SIZE),
      };
      const effects: Effect[] = got.length === 0 ? [{ type: 'SCORE', uid: event.uid, delta: 1 }] : [];
      if (guessers(ctx).every((p) => nextGot.includes(p.uid))) return toReveal(next, ctx, effects);
      return { state: next, effects };
    }

    return { state };
  },

  View,
};

export default definition;
