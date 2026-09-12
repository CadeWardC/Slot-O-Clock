import { useEffect, useReducer, useRef, useState } from 'react';
import { TimerBar, useCountdown } from '../../components/ui';
import { serverNow } from '../../state/serverTime';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import {
  activeCupFor,
  holdersOf,
  readState,
  HANDOFF_MS,
  type BcInput,
  type BcState,
  type CupIndex,
} from './definition';
import {
  BALL_D,
  BALL_Y,
  CUP_Y,
  MOUTH_D,
  MOUTH_R,
  RIM,
  mercyFor,
  resolveShot,
  type BcGesture,
} from './physics';

/* ============================================================
 *  Boom Cup — what every phone draws
 * ============================================================
 * Where the two cups are (the ring), how many beers are left in the middle,
 * and your own cup and ball. Flick up off the table and the ball is gone on
 * the next frame — GamePigeon rules: no meter, no aim guide, nothing on
 * screen telling you whether it is going in. The flight, the rim, the splash
 * and the catch banner are the feedback.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** how long the ball is in the air */
const FLIGHT_MS = 380;
/** how long a catch stays shouted across the table */
const FLASH_MS = 6000;

/**
 * True while a catch is worth shouting about — decided during render (so a
 * phone that joins mid-flash still sees it) and cleared by one timeout.
 */
function useFlash(until: number | null | undefined): boolean {
  const on = until != null && serverNow() < until + FLASH_MS;
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!on || until == null) return;
    const id = window.setTimeout(bump, Math.max(50, until + FLASH_MS - serverNow()));
    return () => window.clearTimeout(id);
  }, [on, until]);
  return on;
}

const nameOf = (players: PlayerInfo[], uid: string | null | undefined) =>
  players.find((p) => p.uid === uid)?.name ?? '?';
const emojiOf = (players: PlayerInfo[], uid: string | null | undefined) =>
  players.find((p) => p.uid === uid)?.emoji ?? '🥤';

export function View({ state, me, players, variant, timerEndsAt, submitInput }: GameViewProps<BcState, BcInput>) {
  const s = readState(state);
  const shared = variant === 'shared';
  const cup = activeCupFor(s, me.uid, shared);
  const [left, right] = holdersOf(s);
  const otherCup: CupIndex = cup === 0 ? 1 : 0;
  const otherUid = cup != null ? s.hold[otherCup] : '';
  const give = s.give;
  const iChoose = s.phase === 'handoff' && !!give && give.uid === me.uid;
  const caughtFlash = useFlash(s.lastCatch?.at) ? s.lastCatch : null;

  return (
    <div className="gv bc">
      <Ring s={s} players={players} meUid={me.uid} />

      <div className="bc-bar">
        <span className="bc-middle" title="beers left in the middle">
          {Array.from({ length: Math.max(1, s.middleMax) }).map((_, i) => (
            <i key={i} className={`bc-beer ${i < s.middle ? 'bc-beer-on' : ''}`}>
              🍺
            </i>
          ))}
        </span>
        <span className="bc-middlenum">{s.middle} in the middle</span>
      </div>

      {caughtFlash && (
        <div className={`bc-flash ${caughtFlash.boom ? 'bc-flash-boom' : ''}`} key={caughtFlash.at}>
          <span className="bc-flash-bang">💥</span>
          <span className="bc-flash-text">
            <b>{nameOf(players, caughtFlash.uid)}</b> caught
            {caughtFlash.byUid ? ` by ${nameOf(players, caughtFlash.byUid)}` : ''} — drink
            {caughtFlash.boom ? ' the BOOM!' : '!'}
          </span>
        </div>
      )}

      {iChoose && give ? (
        <GivePicker
          s={s}
          players={players}
          meUid={me.uid}
          cup={give.cup}
          nextUid={give.nextUid}
          onPick={(uid) => submitInput({ give: uid })}
        />
      ) : s.phase === 'handoff' && give ? (
        <Waiting chooser={nameOf(players, give.uid)} />
      ) : cup != null ? (
        <Table
          cup={cup}
          misses={s.miss[cup] ?? 0}
          readyAt={s.nextAt[cup] || null}
          nextName={nameOf(players, nextOf(s, me.uid))}
          otherName={otherUid ? nameOf(players, otherUid) : ''}
          otherMisses={otherUid ? (s.miss[otherCup] ?? 0) : 0}
          onShot={(g) => submitInput({ shot: g })}
        />
      ) : (
        <Watching s={s} players={players} left={left} right={right} />
      )}

      {s.phase === 'handoff' && <TimerBar deadline={timerEndsAt} totalMs={HANDOFF_MS} />}

      <LastShot s={s} players={players} meUid={me.uid} />
    </div>
  );
}

const nextOf = (s: BcState, uid: string): string => {
  const ring = s.ring ?? [];
  const i = ring.indexOf(uid);
  return i < 0 ? (ring[0] ?? '') : (ring[(i + 1) % ring.length] ?? '');
};

/* ---------- the seating order, and where the two cups are ---------- */

function Ring({ s, players, meUid }: { s: BcState; players: PlayerInfo[]; meUid: string }) {
  const lead = s.hold[0] ?? '';
  const nextSeat = lead ? nextOf(s, lead) : '';
  return (
    <div className="bc-ring">
      {s.ring.map((uid, i) => {
        const p = players.find((x) => x.uid === uid);
        const held = ([0, 1] as CupIndex[]).filter((c) => s.hold[c] === uid);
        return (
          <div
            key={uid}
            className={`bc-seat ${uid === meUid ? 'bc-seat-me' : ''} ${
              held.length ? 'bc-seat-holding' : ''
            } ${uid === nextSeat ? 'bc-seat-next' : ''}`}
          >
            {i > 0 && <span className="bc-seat-link" aria-hidden />}
            <span className="bc-seat-emoji">{p?.emoji ?? '👤'}</span>
            <span className="bc-seat-name">{p?.name ?? '?'}</span>
            <span className="bc-seat-cups">
              {held.map((c) => (
                <i key={c} className={`bc-dot bc-dot-${c}`} />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- the cup: a real solo cup, in SVG ---------- */

/**
 * Drawn so the mouth's centre lands on the element's own origin, with the
 * mouth's radii exactly the ones the shot is judged against (w/d) — what you
 * see is literally the target. `tint` only keys the gradient ids.
 */
function CupArt({ w, d, tint }: { w: number; d: number; tint: string }) {
  const bw = w * 2.16;
  const bodyH = w * 2.1;
  const cx = bw / 2;
  const id = `bc-${tint}`;
  return (
    <svg
      className="bc-cup-art"
      width={bw}
      height={d + bodyH}
      viewBox={`0 0 ${bw} ${d + bodyH}`}
      style={{ transform: `translate(-50%, ${-d}px)` }}
    >
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ff9db0" />
          <stop offset="18%" stopColor="#ef2544" />
          <stop offset="52%" stopColor="#c01432" />
          <stop offset="80%" stopColor="#8b0c22" />
          <stop offset="100%" stopColor="#590615" />
        </linearGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff0f3" />
          <stop offset="100%" stopColor="#c98e9c" />
        </linearGradient>
        <radialGradient id={`${id}-hole`} cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#330c18" />
          <stop offset="70%" stopColor="#180409" />
          <stop offset="100%" stopColor="#080103" />
        </radialGradient>
        <radialGradient id={`${id}-floor`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.62)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>

      {/* contact shadow */}
      <ellipse cx={cx} cy={d + bodyH * 0.98} rx={w * 1.2} ry={d * 0.55} fill={`url(#${id}-floor)`} />

      {/* tapered body */}
      <path
        d={`M ${cx - w} ${d}
            L ${cx + w} ${d}
            L ${cx + w * 0.78} ${d + bodyH}
            Q ${cx} ${d + bodyH * 1.07} ${cx - w * 0.78} ${d + bodyH}
            Z`}
        fill={`url(#${id}-body)`}
      />
      {/* ribs */}
      <g stroke="#40040f" strokeWidth={Math.max(1, w * 0.035)} opacity="0.2">
        {[-0.5, -0.17, 0.17, 0.5].map((f) => (
          <line key={f} x1={cx + f * w} y1={d + bodyH * 0.04} x2={cx + f * w * 0.78} y2={d + bodyH * 0.96} />
        ))}
      </g>
      {/* sheen down the left */}
      <path
        d={`M ${cx - w * 0.72} ${d + bodyH * 0.04}
            L ${cx - w * 0.44} ${d + bodyH * 0.04}
            L ${cx - w * 0.52} ${d + bodyH * 0.94}
            L ${cx - w * 0.66} ${d + bodyH * 0.94}
            Z`}
        fill="rgba(255,255,255,0.26)"
      />

      {/* the opening, and its rolled rim */}
      <ellipse className="bc-mouth-art" cx={cx} cy={d} rx={w} ry={d} fill={`url(#${id}-hole)`} />
      <ellipse cx={cx} cy={d} rx={w} ry={d} fill="none" stroke={`url(#${id}-rim)`} strokeWidth={Math.max(2, w * 0.06)} />
      <ellipse cx={cx} cy={d + d * 0.42} rx={w * 0.78} ry={d * 0.5} fill="rgba(255,255,255,0.05)" />
    </svg>
  );
}

/* ---------- your table: flick, and the ball is gone ---------- */

interface Flight {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  made: boolean;
  rim: boolean;
  start: number;
}

function Table({
  cup,
  misses,
  readyAt,
  nextName,
  otherName,
  otherMisses,
  onShot,
}: {
  cup: CupIndex;
  misses: number;
  readyAt: number | null;
  nextName: string;
  otherName: string;
  otherMisses: number;
  onShot: (g: BcGesture) => void;
}) {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [from, setFrom] = useState<{ x: number; y: number; t: number } | null>(null);
  const [to, setTo] = useState<{ x: number; y: number } | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [ft, setFt] = useState(0);
  const [landed, setLanded] = useState(false);
  const waitLeft = useCountdown(readyAt) ?? 0;

  /* the table's real size in px — every position is derived from it */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* the flight, drawn from the same maths the host judges with */
  useEffect(() => {
    if (!flight) return;
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - flight.start) / FLIGHT_MS);
      setFt(t);
      if (t < 1) raf = requestAnimationFrame(step);
      else setLanded(true);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [flight]);

  /* clear the ball once it has finished doing its thing */
  useEffect(() => {
    if (!landed) return;
    const id = window.setTimeout(() => {
      setFlight(null);
      setLanded(false);
    }, 480);
    return () => window.clearTimeout(id);
  }, [landed]);

  const h = size.h || 1;
  const mouthR = MOUTH_R * h;
  const mouthD = MOUTH_D * h;
  const cupX = size.w / 2;
  const cupY = CUP_Y * h;
  const ballX = size.w / 2;
  const ballY = BALL_Y * h;
  /* the ball is back as soon as the host's cooldown says so — a fresh flick
     simply replaces whatever the last ball is still doing */
  const canShoot = waitLeft <= 0;
  const mercy = mercyFor(misses);

  const local = (e: React.PointerEvent) => {
    const r = areaRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  /* finger down: a direction tick, and nothing else — no power, no verdict */
  const aim =
    from && to && Math.hypot(to.x - from.x, from.y - to.y) > 12
      ? Math.atan2(to.x - from.x, from.y - to.y)
      : null;

  const onDown = (e: React.PointerEvent) => {
    if (!canShoot) return;
    // capture keeps the flick alive past the edge of the table; a browser that
    // refuses (or a synthetic event) just falls through to normal moves
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no capture — the flick still tracks while the pointer is inside */
    }
    const p = local(e);
    setFlight(null);
    setLanded(false);
    setFrom({ x: p.x, y: p.y, t: performance.now() });
    setTo(p);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!from) return;
    setTo(local(e));
  };

  const finish = (e: React.PointerEvent) => {
    if (!from) return;
    const p = local(e);
    const g: BcGesture = {
      dx: (p.x - from.x) / h,
      dy: (from.y - p.y) / h,
      ms: Math.max(1, performance.now() - from.t),
    };
    const judged = resolveShot(g, misses);
    setFrom(null);
    setTo(null);
    if (!judged.ok || !canShoot) return;
    onShot(g);
    setLanded(false);
    setFt(0);
    setFlight({
      x0: ballX,
      y0: ballY,
      x1: clamp(cupX + judged.ex * mouthR, 10, Math.max(10, size.w - 10)),
      // ey is measured in mouth depths: positive = past the cup (further up
      // the table), negative = short of it (bounced down on the felt)
      y1: Math.max(10, cupY - judged.ey * mouthD),
      made: judged.made,
      rim: !judged.made && judged.r < RIM,
      start: performance.now(),
    });
  };

  const fx = flight ? lerp(flight.x0, flight.x1, ft) : ballX;
  const fy = flight ? lerp(flight.y0, flight.y1, ft) - Math.sin(Math.PI * ft) * h * 0.17 : ballY;
  const lift = flight ? Math.sin(Math.PI * ft) : 0;
  const ballD = Math.round(clamp(h * BALL_D, 16, 30));

  return (
    <div className="bc-tablewrap">
      <div
        ref={areaRef}
        className={`bc-table ${from ? 'bc-table-aiming' : ''} ${canShoot ? '' : 'bc-table-wait'}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerCancel={() => {
          setFrom(null);
          setTo(null);
        }}
      >
        <span className="bc-felt" aria-hidden />

        {/* the cup: mouth centred on (cupX, cupY), body hanging below */}
        <div className="bc-cup" style={{ left: cupX, top: cupY }}>
          {mercy > 0 && (
            <span
              className="bc-mercy"
              style={{ width: 2 * mouthR * (1 + mercy), height: 2 * mouthD * (1 + mercy) }}
            />
          )}
          <span className="bc-cup-glow" style={{ width: mouthR * 4, height: mouthR * 4 }} />
          <CupArt w={mouthR} d={mouthD} tint={String(cup)} />
        </div>

        {/* splash rings when it drops in */}
        {flight && landed && flight.made && (
          <span className="bc-splash" style={{ left: flight.x1, top: flight.y1 }}>
            <i />
            <i />
          </span>
        )}

        {/* the ball, its trail, and a contact shadow on the felt */}
        {flight && (
          <>
            <span
              className="bc-shadow"
              style={{
                left: fx,
                top: ballY + h * 0.01,
                transform: `translate(-50%,-50%) scale(${1 - 0.4 * lift})`,
                opacity: 0.55 * (1 - 0.7 * lift),
              }}
            />
            {[0.09, 0.18].map((back) => {
              const tt = Math.max(0, ft - back);
              return (
                <span
                  key={back}
                  className={`bc-trail bc-trail-${back === 0.09 ? 'a' : 'b'}`}
                  style={{
                    left: lerp(flight.x0, flight.x1, tt),
                    top: lerp(flight.y0, flight.y1, tt) - Math.sin(Math.PI * tt) * h * 0.17,
                    transform: `translate(-50%,-50%) scale(${1 - 0.3 * tt})`,
                    opacity: 0.3 * (1 - ft),
                  }}
                />
              );
            })}
          </>
        )}
        <span
          className={`bc-ball ${flight && landed ? (flight.made ? 'bc-ball-in' : flight.rim ? 'bc-ball-rim' : 'bc-ball-out') : ''}`}
          style={{
            left: fx,
            top: fy,
            width: ballD,
            height: ballD,
            transform: `translate(-50%,-50%) scale(${1 - 0.22 * (flight ? ft : 0)})`,
          }}
        />

        {/* direction tick only — nothing that says how good the flick was */}
        {aim != null && (
          <span
            className="bc-aim"
            style={{
              left: ballX,
              top: ballY,
              width: h * 0.17,
              transform: `translate(0,-50%) rotate(${(aim * 180) / Math.PI - 90}deg)`,
            }}
          />
        )}

        {canShoot && misses === 0 && <span className="bc-table-hint">flick up ⬆</span>}
      </div>

      <p className="bc-hint">
        {otherName && (
          <>
            <i className={`bc-dot bc-dot-${cup === 0 ? 1 : 0}`} /> {otherName}
            {otherMisses > 0 ? ` · ${otherMisses} ${otherMisses === 1 ? 'miss' : 'misses'}` : ''}
            <span className="bc-hint-sep">›</span>
          </>
        )}
        next: {nextName}
      </p>
    </div>
  );
}

/* ---------- first try: hand it to anyone ---------- */

function GivePicker({
  s,
  players,
  meUid,
  cup,
  nextUid,
  onPick,
}: {
  s: BcState;
  players: PlayerInfo[];
  meUid: string;
  cup: CupIndex;
  nextUid: string;
  onPick: (uid: string) => void;
}) {
  const otherCup: CupIndex = cup === 0 ? 1 : 0;
  const otherUid = s.hold[otherCup] ?? '';
  return (
    <div className="bc-give">
      <p className="bc-give-title">FIRST TRY</p>
      <p className="pick-call">Who gets the cup?</p>
      <div className="pick-people">
        {players
          .filter((p) => p.uid !== meUid)
          .map((p) => (
            <button key={p.uid} className="pick-person" onClick={() => onPick(p.uid)}>
              <span className="pick-person-emoji">{p.emoji}</span> {p.name}
              {p.uid === otherUid && <em className="bc-tag bc-tag-snipe">CATCH them!</em>}
              {p.uid === nextUid && <em className="bc-tag">next in line</em>}
            </button>
          ))}
      </div>
      <p className="muted small">hand it to whoever holds the other ball to catch them now</p>
    </div>
  );
}

/* ---------- somebody else is spending a first-try choice ---------- */

function Waiting({ chooser }: { chooser: string }) {
  return (
    <div className="bc-watch">
      <p className="bc-watch-title">🎯 {chooser} sank it first try</p>
      <p className="muted small">they're picking who gets the cup — hold tight…</p>
    </div>
  );
}

/* ---------- no cup in hand: watch the chase ---------- */

function Watching({ s, players, left, right }: { s: BcState; players: PlayerInfo[]; left: string; right: string }) {
  const line = (uid: string, cup: CupIndex) => (
    <div key={cup} className="bc-watch-row">
      <i className={`bc-dot bc-dot-${cup}`} />
      <b>
        {emojiOf(players, uid)} {nameOf(players, uid)}
      </b>
      <span className="muted small">
        {(s.miss[cup] ?? 0) > 0 ? `${s.miss[cup]} ${s.miss[cup] === 1 ? 'miss' : 'misses'}` : 'first try'}
      </span>
    </div>
  );
  return (
    <div className="bc-watch">
      <p className="bc-watch-title">you're clear — watch the chase 👀</p>
      {line(left, 0)}
      {line(right, 1)}
      <p className="muted small">the next cup that reaches you is yours to flick</p>
    </div>
  );
}

/* ---------- what just happened ---------- */

function LastShot({ s, players, meUid }: { s: BcState; players: PlayerInfo[]; meUid: string }) {
  const last = s.last;
  if (!last) return null;
  const mine = last.uid === meUid;
  return (
    <p className={`bc-last ${last.made ? 'bc-last-in' : ''}`}>
      <i className={`bc-dot bc-dot-${last.cup}`} />
      {mine ? 'you' : `${emojiOf(players, last.uid)} ${nameOf(players, last.uid)}`} {last.made ? 'in' : 'out'}
    </p>
  );
}
