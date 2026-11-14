import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Button, TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import {
  DRAW_MS,
  MAX_GUESS,
  MAX_POINTS,
  MAX_STROKES,
  PICK_MS,
  SHARED_DRAW_MS,
  type SkInput,
  type SkState,
} from './definition';

type Pt = [number, number];
/**
 * A line is sent every this many points while the finger is still down, so
 * the table watches it being drawn instead of getting each stroke when it ends.
 */
const CHUNK_POINTS = 12;
/** a new point is kept once the finger has moved this far (0–255 grid) */
const MIN_STEP = 5;

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
const pack = (pts: Pt[]) => pts.map(([x, y]) => hex(x) + hex(y)).join('');

function unpack(s: string): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 4 <= s.length; i += 4) {
    out.push([parseInt(s.slice(i, i + 2), 16), parseInt(s.slice(i + 2, i + 4), 16)]);
  }
  return out;
}

/** a lone dot still has to show up: give it somewhere to go */
const pointsAttr = (pts: Pt[]) =>
  (pts.length === 1 ? [pts[0], [pts[0][0] + 0.01, pts[0][1]] as Pt] : pts).map((p) => p.join(',')).join(' ');

function Strokes({ strokes, live }: { strokes: string[]; live?: Pt[] }) {
  return (
    <>
      {strokes.map((s, i) => (
        <polyline key={i} points={pointsAttr(unpack(s))} />
      ))}
      {live && live.length > 0 && <polyline points={pointsAttr(live)} />}
    </>
  );
}

/** Everyone but the artist: the drawing as it stands in the room. */
function Paper({ strokes, small, empty }: { strokes: string[]; small?: boolean; empty?: string }) {
  return (
    <div className={`sk-paper ${small ? 'sk-paper-small' : ''}`}>
      <svg viewBox="0 0 255 255" className="sk-svg" aria-label="the drawing">
        <Strokes strokes={strokes} />
      </svg>
      {empty && strokes.length === 0 && <span className="sk-paper-hint">{empty}</span>}
    </div>
  );
}

/**
 * The artist's paper. Ink lands under the finger straight away; each finished
 * stroke (or every MAX_POINTS of a long one) is sent once, whole.
 */
function Pad({
  initial,
  onStroke,
  onUndo,
  onClear,
}: {
  initial: string[];
  onStroke: (pts: string) => void;
  onUndo: () => void;
  onClear: () => void;
}) {
  const [mine, setMine] = useState<string[]>(initial);
  const [live, setLive] = useState<Pt[]>([]);
  const liveRef = useRef<Pt[]>([]);
  const countRef = useRef(initial.length);
  const drawing = useRef(false);
  const full = mine.length >= MAX_STROKES;

  const at = (e: RPointerEvent<SVGSVGElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 255, ((e.clientY - r.top) / r.height) * 255];
  };

  const commit = (pts: Pt[]) => {
    if (pts.length === 0 || countRef.current >= MAX_STROKES) return;
    const s = pack(pts);
    countRef.current += 1;
    setMine((m) => [...m, s]);
    onStroke(s);
  };

  const down = (e: RPointerEvent<SVGSVGElement>) => {
    if (countRef.current >= MAX_STROKES) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    liveRef.current = [at(e)];
    setLive(liveRef.current);
  };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    const p = at(e);
    const cur = liveRef.current;
    const last = cur[cur.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < MIN_STEP) return;
    let next = [...cur, p];
    if (next.length >= Math.min(CHUNK_POINTS, MAX_POINTS)) {
      // a long line goes out in pieces, each picking up where the last ended
      commit(next);
      next = [p];
      if (countRef.current >= MAX_STROKES) drawing.current = false;
    }
    liveRef.current = next;
    setLive(next);
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    commit(liveRef.current);
    liveRef.current = [];
    setLive([]);
  };

  return (
    <>
      <div className="sk-paper sk-paper-pad">
        <svg
          viewBox="0 0 255 255"
          className="sk-svg"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          data-sk="pad"
        >
          <Strokes strokes={mine} live={live} />
        </svg>
        {mine.length === 0 && live.length === 0 && <span className="sk-paper-hint">Draw here</span>}
      </div>
      <div className="sk-tools">
        <button
          className="sk-tool"
          disabled={mine.length === 0}
          onClick={() => {
            countRef.current = Math.max(0, countRef.current - 1);
            setMine((m) => m.slice(0, -1));
            onUndo();
          }}
        >
          Undo
        </button>
        <button
          className="sk-tool"
          disabled={mine.length === 0}
          onClick={() => {
            countRef.current = 0;
            setMine([]);
            onClear();
          }}
        >
          Start over
        </button>
        <span className="sk-ink">
          {full ? 'Out of ink' : `Ink ${Math.round(((MAX_STROKES - mine.length) / MAX_STROKES) * 100)}%`}
        </span>
      </div>
    </>
  );
}

function Blanks({ word }: { word: string }) {
  return (
    <p className="sk-blanks" aria-label={`${word.replace(/[^a-z]/gi, '').length} letters`}>
      {word.split('').map((ch, i) =>
        ch === ' ' ? <span key={i} className="sk-gap" /> : <span key={i} className="sk-blank" />,
      )}
    </p>
  );
}

function Feed({ state, players }: { state: SkState; players: PlayerInfo[] }) {
  const feed = state.feed ?? [];
  if (feed.length === 0) return <p className="muted small sk-feed-empty">No guesses yet.</p>;
  return (
    <ul className="sk-feed">
      {[...feed].reverse().map((line) => {
        const p = players.find((x) => x.uid === line.u);
        return (
          <li key={line.k} className={line.ok ? 'sk-feed-ok' : ''}>
            <span className="sk-feed-who">
              {p?.emoji} {p?.name ?? '?'}
            </span>
            {line.ok ? <span className="sk-feed-got">got it</span> : <span className="sk-feed-text">{line.t}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function View({
  state,
  me,
  players,
  actorUid,
  isActor,
  variant,
  timerEndsAt,
  submitInput,
}: GameViewProps<SkState, SkInput>) {
  const left = useCountdown(timerEndsAt);
  const [text, setText] = useState('');
  const artist = players.find((p) => p.uid === actorUid);
  const strokes = state.strokes ?? [];
  const got = state.got ?? [];
  const options = state.options ?? [];
  const word = state.word ?? '';
  const shared = variant === 'shared';
  const others = players.filter((p) => p.uid !== actorUid);

  useEffect(() => {
    setText('');
  }, [state.phase, me.uid]);

  /* ---------- pick a word ---------- */
  if (state.phase === 'pick') {
    if (!isActor) {
      return (
        <div className="gv sk">
          <span className="fx-tag">Sketchy</span>
          <h2 className="fx-title">{artist?.name ?? 'Someone'} is picking a word</h2>
          <p className="muted sk-line">They draw it. You guess it. Miss it and you drink.</p>
          <TimerBar deadline={timerEndsAt} totalMs={PICK_MS} />
        </div>
      );
    }
    return (
      <div className="gv sk">
        <span className="fx-tag">You draw</span>
        <h2 className="fx-title">Pick a word</h2>
        <div className="sk-options">
          {options.map((w, i) => (
            <button
              key={w}
              className="sk-option"
              style={{ ['--sk-tilt' as string]: `${(i - 1) * 1.4}deg` }}
              onClick={() => submitInput({ action: 'pick', index: i })}
            >
              {w}
            </button>
          ))}
        </div>
        <TimerBar deadline={timerEndsAt} totalMs={PICK_MS} />
        <p className="muted small sk-line">
          {shared ? 'Keep the screen to yourself.' : 'No pick means you get the first one.'}
        </p>
      </div>
    );
  }

  /* ---------- draw / guess ---------- */
  if (state.phase === 'draw') {
    const secs = left != null ? Math.ceil(left / 1000) : null;
    const total = shared ? SHARED_DRAW_MS : DRAW_MS;

    if (isActor) {
      return (
        <div className="gv sk">
          <div className="sk-head">
            <span className="fx-tag">Draw</span>
            <span className="sk-word">{word}</span>
            {secs != null && <span className={`sk-clock ${secs <= 10 ? 'sk-clock-hot' : ''}`}>{secs}</span>}
          </div>
          <Pad
            key={`${actorUid}-${word}`}
            initial={strokes}
            onStroke={(pts) => submitInput({ action: 'stroke', pts })}
            onUndo={() => submitInput({ action: 'undo' })}
            onClear={() => submitInput({ action: 'clear' })}
          />
          <TimerBar deadline={timerEndsAt} totalMs={total} />
          {shared ? (
            <>
              <p className="muted small sk-line">No letters, no talking. The table shouts guesses.</p>
              <div className="sk-verdict">
                <Button variant="gold" size="md" full onClick={() => submitInput({ action: 'verdict', got: true })}>
                  Someone got it
                </Button>
                <Button variant="ghost" size="md" full onClick={() => submitInput({ action: 'verdict', got: false })}>
                  Nobody got it
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="sk-count">
                {got.length} of {others.length} got it
              </p>
              <Feed state={state} players={players} />
            </>
          )}
        </div>
      );
    }

    const iGotIt = got.includes(me.uid);
    return (
      <div className="gv sk">
        <div className="sk-head">
          <span className="fx-tag">Guess</span>
          <Blanks word={word} />
          {secs != null && <span className={`sk-clock ${secs <= 10 ? 'sk-clock-hot' : ''}`}>{secs}</span>}
        </div>
        {iGotIt ? (
          <p className="sk-gotit">
            <span className="fx-stamp fx-stamp-good sk-stamp">Got it</span>
            <span>Keep it to yourself.</span>
          </p>
        ) : (
          <form
            className="sk-guess"
            onSubmit={(e) => {
              e.preventDefault();
              const t = text.trim();
              if (!t) return;
              submitInput({ action: 'guess', text: t });
              setText('');
            }}
          >
            <input
              className="input sk-guess-input"
              value={text}
              maxLength={MAX_GUESS}
              placeholder="What is it?"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="send"
              onChange={(e) => setText(e.target.value)}
            />
            <button className="btn btn-gold sk-guess-go" type="submit" disabled={!text.trim()}>
              Guess
            </button>
          </form>
        )}
        <Paper strokes={strokes} small empty={`${artist?.name ?? 'The artist'} hasn't drawn anything yet`} />
        <TimerBar deadline={timerEndsAt} totalMs={total} />
        <p className="sk-count">
          {artist?.name ?? 'Someone'} is drawing · {got.length} of {others.length} got it
        </p>
        <Feed state={state} players={players} />
      </div>
    );
  }

  /* ---------- the reveal ---------- */
  const nobody = shared ? state.verdict !== 'got' : got.length === 0;
  const drinks = state.assignments ?? [];
  return (
    <div className="gv sk">
      <span className="fx-tag">It was</span>
      <div className="fx-paper sk-reveal">
        <h2 className="sk-reveal-word">{word}</h2>
        {nobody && <span className="fx-stamp sk-stamp sk-reveal-stamp">Nobody</span>}
      </div>
      <Paper strokes={strokes} small />
      {!shared && (
        <ul className="sk-result">
          {got.map((uid, i) => {
            const p = players.find((x) => x.uid === uid);
            return (
              <li key={uid}>
                <span className="sk-result-pos">{i + 1}.</span>
                <span className="sk-result-who">
                  {p?.emoji} {p?.name ?? '?'}
                </span>
                {i === 0 && <span className="sk-result-first">first</span>}
              </li>
            );
          })}
          {others
            .filter((p) => !got.includes(p.uid))
            .map((p) => (
              <li key={p.uid} className="sk-result-miss">
                <span className="sk-result-pos">x</span>
                <span className="sk-result-who">
                  {p.emoji} {p.name}
                </span>
                {!nobody && <span className="sk-result-drink">drinks 1</span>}
              </li>
            ))}
        </ul>
      )}
      <p className="sk-line sk-verdict-line">
        {nobody
          ? `${artist?.name ?? 'The artist'} drinks ${drinks[0]?.sips ?? 2}.`
          : shared
            ? 'Nobody drinks.'
            : drinks.length === 0
              ? 'Everyone got it. Nobody drinks.'
              : `${drinks.length} missed it.`}
      </p>
    </div>
  );
}
