import { useEffect, useRef, useState } from 'react';
import { TimerBar, useCountdown } from '../../components/ui';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import {
  activeCupFor,
  cupsHeld,
  holdersOf,
  readState,
  HANDOFF_MS,
  type BcInput,
  type BcState,
  type CupIndex,
} from './definition';
import {
  BALL_Y,
  CUP_Y,
  MOUTH_D,
  MOUTH_R,
  POWER_TOL,
  RIM,
  mercyFor,
  resolveShot,
  type BcGesture,
} from './physics';

/* ============================================================
 *  Boom Cup — what every phone draws
 * ============================================================
 * The whole game on screen is: where the two cups are (the ring), how many
 * beers are left in the middle, and your own ball. Swipe up on the table to
 * shoot; the guide shows exactly where the ball will land, because the
 * verdict is the same maths the host runs (physics.ts).
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const nameOf = (players: PlayerInfo[], uid: string | null | undefined) =>
  players.find((p) => p.uid === uid)?.name ?? '?';
const emojiOf = (players: PlayerInfo[], uid: string | null | undefined) =>
  players.find((p) => p.uid === uid)?.emoji ?? '🥤';

export function View({ state, me, players, variant, timerEndsAt, submitInput }: GameViewProps<BcState, BcInput>) {
  const s = readState(state);
  const shared = variant === 'shared';
  const cup = activeCupFor(s, me.uid, shared);
  const myCups = cupsHeld(s, me.uid);
  const [left, right] = holdersOf(s);
  const otherCup: CupIndex = cup === 0 ? 1 : 0;
  const otherUid = cup != null ? s.hold[otherCup] : '';
  const give = s.give;
  const iChoose = s.phase === 'handoff' && !!give && give.uid === me.uid;
  const caughtFlash = s.lastCatch && s.lastCatch.at > 0 ? s.lastCatch : null;

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
        <span className="bc-middlenum">{s.middle} left in the middle</span>
      </div>

      {caughtFlash && (
        <div className={`bc-flash ${caughtFlash.boom ? 'bc-flash-boom' : ''}`}>
          💥 <b>{nameOf(players, caughtFlash.uid)}</b> got caught
          {caughtFlash.byUid ? ` by ${nameOf(players, caughtFlash.byUid)}` : ''} — drinks
          {caughtFlash.boom ? ' the BOOM!' : '!'}
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
          doubleDecker={myCups.length > 1}
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
        const mine = uid === meUid;
        const held = ([0, 1] as CupIndex[]).filter((c) => s.hold[c] === uid);
        return (
          <div
            key={uid}
            className={`bc-seat ${mine ? 'bc-seat-me' : ''} ${held.length ? 'bc-seat-holding' : ''} ${
              uid === nextSeat ? 'bc-seat-next' : ''
            }`}
          >
            <span className="bc-seat-n">{i + 1}</span>
            <span className="bc-seat-emoji">{p?.emoji ?? '👤'}</span>
            <span className="bc-seat-name">{p?.name ?? '?'}</span>
            <span className="bc-seat-cups">
              {held.map((c) => (
                <i key={c} className={`bc-dot bc-dot-${c}`} title={`cup ${c + 1}`} />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- your table: swipe, aim guide, ball ---------- */

interface Flight {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  made: boolean;
  rim: boolean;
  start: number;
  dur: number;
}

function Table({
  cup,
  misses,
  readyAt,
  nextName,
  otherName,
  otherMisses,
  doubleDecker,
  onShot,
}: {
  cup: CupIndex;
  misses: number;
  readyAt: number | null;
  nextName: string;
  otherName: string;
  otherMisses: number;
  doubleDecker: boolean;
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

  /* the table's real size in px — every ball position is derived from it */
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ball flight, drawn from the same maths the host judges with */
  useEffect(() => {
    if (!flight) return;
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (performance.now() - flight.start) / flight.dur);
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
    }, 900);
    return () => window.clearTimeout(id);
  }, [landed]);

  const h = size.h || 1;
  const mouthR = MOUTH_R * h;
  const mouthD = MOUTH_D * h;
  const cupX = size.w / 2;
  const cupY = CUP_Y * h;
  const ballX = size.w / 2;
  const ballY = BALL_Y * h;
  const canShoot = waitLeft <= 0 && !flight;

  const local = (e: React.PointerEvent) => {
    const r = areaRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  /* the shot the current drag is aiming at — before you let go */
  const aimed = from && to
    ? resolveShot(
        { dx: (to.x - from.x) / h, dy: (from.y - to.y) / h, ms: 0 },
        misses,
      )
    : null;
  const ghost = aimed?.ok
    ? {
        x: clamp(cupX + aimed.ex * mouthR, 8, size.w - 8),
        y: Math.max(8, cupY + aimed.ey * mouthD),
      }
    : null;

  const onDown = (e: React.PointerEvent) => {
    if (!canShoot) return;
    // capture keeps the drag alive past the edge of the table; a browser
    // that refuses (or a synthetic event) just falls through to normal moves
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no capture — the drag still tracks while the pointer is inside */
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
    const shot = resolveShot(g, misses);
    setFrom(null);
    setTo(null);
    if (!shot.ok || !canShoot) return;
    onShot(g);
    setLanded(false);
    setFt(0);
    setFlight({
      x0: ballX,
      y0: ballY,
      x1: clamp(cupX + shot.ex * mouthR, 8, Math.max(8, size.w - 8)),
      y1: Math.max(8, cupY + shot.ey * mouthD),
      made: shot.made,
      rim: !shot.made && shot.r < RIM,
      start: performance.now(),
      dur: 460,
    });
  };

  const fx = flight ? lerp(flight.x0, flight.x1, ft) : ballX;
  const fy = flight ? lerp(flight.y0, flight.y1, ft) - Math.sin(Math.PI * ft) * h * 0.18 : ballY;
  const ballScale = flight ? 1 + 0.32 * ft : 1;
  const mercy = mercyFor(misses);

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
        {/* the cup in front of you */}
        <div className="bc-cup" style={{ left: cupX, top: cupY }}>
          {mercy > 0 && (
            <span
              className="bc-mercy"
              style={{ width: 2 * mouthR * (1 + mercy), height: 2 * mouthD * (1 + mercy) }}
            />
          )}
          <span className="bc-mouth" style={{ width: 2 * mouthR, height: 2 * mouthD }} />
          <span className="bc-cup-body" style={{ width: mouthR * 1.7, height: h * 0.3 }} />
        </div>

        {/* where this drag would land */}
        {ghost && (
          <>
            <svg className="bc-guide" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none">
              <line x1={ballX} y1={ballY} x2={ghost.x} y2={ghost.y} />
            </svg>
            <span
              className={`bc-ghost ${aimed?.made ? 'bc-ghost-in' : ''}`}
              style={{ left: ghost.x, top: ghost.y }}
            />
          </>
        )}

        {/* the ball */}
        <span
          className={`bc-ball ${flight && landed ? (flight.made ? 'bc-ball-in' : 'bc-ball-out') : ''}`}
          style={{ left: fx, top: fy, transform: `translate(-50%,-50%) scale(${ballScale})` }}
        />

        <span className="bc-table-hint">
          {canShoot ? 'swipe up ⬆' : waitLeft > 0 ? 'ball coming back…' : '…'}
        </span>
      </div>

      <div className="bc-hud">
        <span className="bc-power">
          <span className="bc-power-sweet" style={{ left: `${((1 - POWER_TOL) / 1.6) * 100}%`, width: `${((POWER_TOL * 2) / 1.6) * 100}%` }} />
          <span
            className="bc-power-fill"
            style={{ width: `${clamp(((aimed?.power ?? 0) / 1.6) * 100, 0, 100)}%` }}
          />
        </span>
        <span className="bc-hud-text">
          {aimed?.ok
            ? `power ${Math.round((aimed.power ?? 0) * 100)}% · ${
                aimed.made ? 'on target 🎯' : aimed.r < RIM ? 'on the rim 😬' : 'off line'
              }`
            : `cup ${cup + 1} · miss ${misses}`}
        </span>
      </div>

      <p className="bc-hint">
        {doubleDecker
          ? `both cups are yours — clearing cup ${cup + 1} first`
          : otherName
            ? `other ball: ${otherName} (${otherMisses} ${otherMisses === 1 ? 'miss' : 'misses'}) · next: ${nextName}`
            : `next: ${nextName}`}
        {mercy > 0 && <span className="bc-mercy-tag"> · aim assist {Math.round(mercy * 100)}%</span>}
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
      <p className="bc-give-title">🎯 FIRST TRY!</p>
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
      <p className="muted small">
        hand it to whoever holds the other ball to catch them right now — or drop it in front of them
        and let the chase do it
      </p>
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
      <p className="muted small">the next cup that reaches you is yours to shoot</p>
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
      {mine ? 'you' : `${emojiOf(players, last.uid)} ${nameOf(players, last.uid)}`}:{' '}
      {last.made ? '🎯 in!' : '❌ out'}
      {!last.made && ` (${last.misses + 1})`}
    </p>
  );
}
