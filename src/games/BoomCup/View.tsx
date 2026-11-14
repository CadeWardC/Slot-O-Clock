import { useEffect, useReducer, useRef, useState } from 'react';
import { TimerBar, useCountdown } from '../../components/ui';
import { BigCount, Confetti } from '../../components/fx';
import { serverNow } from '../../state/serverTime';
import type { GameViewProps, PlayerInfo } from '../../engine/types';
import {
  activeCupFor,
  nextHolder,
  readState,
  seatsBetween,
  BOOM_SIPS,
  CATCH_SIPS,
  HANDOFF_MS,
  START_MS,
  type BcFeed,
  type BcInput,
  type BcShotLog,
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
 *  1. The table, from above: everyone in their seat, the two cups sitting in
 *     front of whoever holds them, the way they travel, who is one sink from
 *     being caught, and the beers left in the middle.
 *  2. The lane: your cup and your ball. Flick up and the ball is gone on the
 *     next frame — no meter, no aim guide, nothing that says whether it is
 *     going in. The arc, the rim, the splash and the call-out ARE the
 *     feedback. Players without a cup watch both lanes live instead.
 *  3. The commentary: the last few things that happened, in words.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** how long the ball is in the air, and how long it spends bouncing/dropping after */
const FLIGHT_MS = 460;
const AFTER_MS = 560;
/** how long a catch stays shouted across the table */
const FLASH_MS = 6000;
/** how long "the cup just landed on you" stays up */
const FRESH_MS = 4500;

const CUP_NAME = ['yellow', 'pink'] as const;
const flipCup = (c: CupIndex): CupIndex => (c === 0 ? 1 : 0);

/**
 * True for `ms` after a server timestamp — decided during render (so a phone
 * that joins mid-flash still sees it) and cleared by one timeout.
 */
function useRecent(at: number | null | undefined, ms: number): boolean {
  const on = at != null && serverNow() < at + ms;
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!on || at == null) return;
    const id = window.setTimeout(bump, Math.max(50, at + ms - serverNow()));
    return () => window.clearTimeout(id);
  }, [on, at, ms]);
  return on;
}

const nameOf = (players: PlayerInfo[], uid: string | null | undefined) =>
  players.find((p) => p.uid === uid)?.name ?? '?';
const emojiOf = (players: PlayerInfo[], uid: string | null | undefined) =>
  players.find((p) => p.uid === uid)?.emoji ?? '👤';
const seats = (k: number) => `${k} seat${k === 1 ? '' : 's'}`;

export function View({ state, me, players, variant, timerEndsAt, submitInput }: GameViewProps<BcState, BcInput>) {
  const s = readState(state);
  const shared = variant === 'shared';
  const cup = activeCupFor(s, me.uid, shared);
  const give = s.give;
  const iChoose = s.phase === 'handoff' && !!give && give.uid === me.uid;
  const flash = useRecent(s.lastCatch?.at, FLASH_MS) ? s.lastCatch : null;
  const feed = s.feed ?? [];
  const lastEvent = feed[feed.length - 1] ?? null;
  // the cup that just landed in my hands, and who sent it
  const arrival =
    [...feed].reverse().find((e) => (e.kind === 'pass' || e.kind === 'give') && e.to === me.uid && e.uid !== me.uid && e.cup === cup) ??
    null;
  const fresh = useRecent(arrival?.at, FRESH_MS) && cup != null ? arrival : null;

  // The ball you just flicked finishes its flight on YOUR lane even if the
  // host has already moved the cup on (a sink changes the screen under you).
  const [linger, setLinger] = useState<{ cup: CupIndex; misses: number } | null>(null);
  useEffect(() => {
    if (!linger) return;
    const id = window.setTimeout(() => setLinger(null), FLIGHT_MS + AFTER_MS + 80);
    return () => window.clearTimeout(id);
  }, [linger]);
  const holding = cup != null && s.phase !== 'handoff';
  const laneCup = holding ? cup : (linger?.cup ?? null);
  // the count-in: nothing has been flicked yet and the first ball is not live
  const startLeft = useCountdown(s.seq === 0 && s.startAt > 0 ? s.startAt : null) ?? 0;
  const countIn = startLeft > 0 ? Math.min(Math.ceil(START_MS / 1000), Math.ceil(startLeft / 1000)) : 0;

  return (
    <div className="gv bc">
      {countIn > 0 ? (
        <div className="bc-head bc-countin">
          <div className="bc-countin-text">
            <p className="fx-kicker">{cup != null ? `you start with the ${CUP_NAME[cup]} cup` : 'you start without a cup'}</p>
            <h2 className="fx-title bc-head-title fx-title-gold">Get ready</h2>
            <p className="bc-head-sub">
              {cup != null ? 'Flick the ball up into your cup when the count ends.' : 'Watch the cups. One is coming your way.'}
            </p>
          </div>
          <BigCount n={countIn} />
        </div>
      ) : (
        <Headline s={s} players={players} meUid={me.uid} cup={cup} iChoose={iChoose} />
      )}

      <TableMap s={s} players={players} meUid={me.uid} />

      {flash && (
        <div className={`bc-flash fx-paper ${flash.uid === me.uid ? 'bc-flash-me' : ''}`} key={flash.at}>
          {flash.uid === me.uid ? (
            <>
              <span className="fx-stamp bc-flash-stamp">{flash.boom ? 'BOOM' : 'CAUGHT'}</span>
              <span className="bc-flash-text">
                {flash.byUid ? `${nameOf(players, flash.byUid)} caught you. ` : ''}
                <b>Drink {flash.boom ? CATCH_SIPS + BOOM_SIPS : CATCH_SIPS}.</b> You keep your cup.
              </span>
            </>
          ) : (
            <>
              <span className="fx-tag fx-tag-red">{flash.boom ? 'boom' : 'caught'}</span>
              <span className="bc-flash-text">
                <b>{nameOf(players, flash.uid)}</b>
                {flash.byUid ? ` by ${flash.byUid === me.uid ? 'you' : nameOf(players, flash.byUid)}` : ''}.{' '}
                {flash.boom ? `Drinks ${CATCH_SIPS + BOOM_SIPS}.` : `Drinks ${CATCH_SIPS}.`}
              </span>
            </>
          )}
        </div>
      )}
      {flash && flash.byUid === me.uid && <Confetti key={`cf${flash.at}`} count={18} />}

      {laneCup != null ? (
        <div className="bc-tablewrap">
          {fresh && holding && flash?.uid !== me.uid && (
            <p className="bc-arrival fx-pop" key={fresh.id}>
              {nameOf(players, fresh.uid)} {fresh.kind === 'give' ? 'picked you for' : 'passed you'} the {CUP_NAME[laneCup]} cup
            </p>
          )}
          <Lane
            key={laneCup}
            cup={laneCup}
            misses={holding ? (s.miss[laneCup] ?? 0) : (linger?.misses ?? 0)}
            readyAt={s.nextAt[laneCup] || null}
            locked={!holding}
            onShot={(g) => {
              setLinger({ cup: laneCup, misses: s.miss[laneCup] ?? 0 });
              submitInput({ shot: g });
            }}
          />
        </div>
      ) : iChoose && give ? (
        <GivePicker
          s={s}
          players={players}
          meUid={me.uid}
          cup={give.cup}
          nextUid={give.nextUid}
          onPick={(uid) => submitInput({ give: uid })}
        />
      ) : (
        <Watching s={s} players={players} meUid={me.uid} />
      )}

      {s.phase === 'handoff' && <TimerBar deadline={timerEndsAt} totalMs={HANDOFF_MS} />}

      {feed.length === 0 ? (
        <HowTo />
      ) : (
        <Feed feed={feed} players={players} meUid={me.uid} newestId={lastEvent?.id ?? 0} />
      )}
    </div>
  );
}

/* ---------- the whole game in three lines, until something happens ---------- */

function HowTo() {
  return (
    <ol className="bc-howto">
      <li>
        <b>Two cups go round the table</b>, clockwise. The map shows who has them.
      </li>
      <li>
        <b>Got a cup? Flick the ball in.</b> When it drops, the cup moves to the next player.
      </li>
      <li>
        <b>Don't get caught.</b> If a cup reaches you while you still have the other one, you drink.
      </li>
    </ol>
  );
}

/* ---------- one line that says what this means for YOU ---------- */

function Headline({
  s,
  players,
  meUid,
  cup,
  iChoose,
}: {
  s: BcState;
  players: PlayerInfo[];
  meUid: string;
  cup: CupIndex | null;
  iChoose: boolean;
}) {
  let kicker = 'boom cup';
  let title = '';
  let tone = '';
  let sub = '';

  if (iChoose) {
    kicker = 'first try';
    title = 'Pick someone';
    tone = 'fx-title-green';
    sub = 'Sunk in one. The cup goes to anyone you like.';
  } else if (s.phase === 'handoff' && s.give) {
    kicker = 'first try';
    title = `${nameOf(players, s.give.uid)} is picking`;
    sub = 'The cup could land on anyone.';
  } else if (cup != null) {
    const other = flipCup(cup);
    const otherUid = s.hold[other] ?? '';
    const behind = otherUid && otherUid !== meUid ? seatsBetween(s, otherUid, meUid) : 0;
    const ahead = otherUid && otherUid !== meUid ? seatsBetween(s, meUid, otherUid) : 0;
    kicker = `you have the ${CUP_NAME[cup]} cup`;
    if (behind === 1) {
      title = 'Sink it or drink';
      tone = 'fx-title-red';
      sub = `${nameOf(players, otherUid)} is right behind you. If their cup reaches you before you sink yours, you drink.`;
    } else if (ahead === 1) {
      title = 'Go for the catch';
      tone = 'fx-title-green';
      sub = `${nameOf(players, otherUid)} is next to you and still has a cup. Sink yours and they drink.`;
    } else {
      title = 'Flick it in';
      tone = 'fx-title-gold';
      sub = otherUid
        ? `Flick the ball into the cup to pass it on. ${nameOf(players, otherUid)}'s cup is chasing you, ${seats(behind)} back.`
        : 'Flick the ball into the cup. First try and you pick who gets it.';
    }
  } else {
    // no cup: which one reaches me first?
    const dists = ([0, 1] as CupIndex[])
      .map((c) => ({ c, uid: s.hold[c] ?? '', d: s.hold[c] ? seatsBetween(s, s.hold[c], meUid) : 99 }))
      .sort((a, b) => a.d - b.d);
    const near = dists[0];
    kicker = 'no cup';
    if (near && near.d === 1) {
      title = "You're next";
      tone = 'fx-title-gold';
      sub = `${nameOf(players, near.uid)} is shooting. The moment it goes in, that cup is yours.`;
    } else {
      title = 'Watch the table';
      sub =
        near && near.d < 99
          ? `Nothing to do yet. The nearest cup is ${seats(near.d)} away from you.`
          : 'Nothing to do yet. The next cup that reaches you is yours.';
    }
  }

  return (
    <div className="bc-head">
      <p className="fx-kicker">{kicker}</p>
      <h2 className={`fx-title bc-head-title ${tone}`} key={title}>
        {title}
      </h2>
      <p className="bc-head-sub">{sub}</p>
    </div>
  );
}

/* ---------- the table from above: seats, cups, beers ---------- */

function TableMap({ s, players, meUid }: { s: BcState; players: PlayerInfo[]; meUid: string }) {
  const ring = s.ring;
  const n = Math.max(1, ring.length);
  const meIdx = Math.max(0, ring.indexOf(meUid));
  // you sit at the bottom; the order runs clockwise from there
  const angleOf = (uid: string) => {
    const i = Math.max(0, ring.indexOf(uid));
    return Math.PI / 2 + ((i - meIdx) * 2 * Math.PI) / n;
  };
  const at = (uid: string, rx: number, ry: number) => {
    const a = angleOf(uid);
    return { left: `${50 + rx * Math.cos(a)}%`, top: `${50 + ry * Math.sin(a)}%` };
  };
  const both = s.hold[0] !== '' && s.hold[0] === s.hold[1];
  // one sink from being caught: the other cup sits in the seat right behind
  const hunted = ([0, 1] as CupIndex[])
    .filter((c) => s.hold[c] && s.hold[flipCup(c)] && s.hold[c] !== s.hold[flipCup(c)])
    .filter((c) => nextHolder(s, s.hold[flipCup(c)]) === s.hold[c])
    .map((c) => s.hold[c]);
  const nextSeats = ([0, 1] as CupIndex[]).map((c) => (s.hold[c] ? nextHolder(s, s.hold[c]) : ''));

  return (
    <div className={`bc-map ${s.middle <= 1 ? 'bc-map-last' : ''}`}>
      <div className="bc-map-top" aria-hidden>
        <svg className="bc-map-flow" viewBox="0 0 100 100" preserveAspectRatio="none">
          <ellipse cx="50" cy="50" rx="46" ry="44" />
        </svg>
      </div>

      <div className="bc-map-mid" title="beers left in the middle">
        <span className="bc-middle">
          {Array.from({ length: Math.max(1, s.middleMax) }).map((_, i) => (
            <i key={i} className={`bc-beer ${i < s.middle ? 'bc-beer-on' : ''}`}>
              🍺
            </i>
          ))}
        </span>
        <span className="bc-middlenum">
          {s.middle} {s.middle === 1 ? 'beer' : 'beers'} left
        </span>
        {s.middle === 1 ? (
          <span className="bc-lastbeer">last beer: BOOM +{BOOM_SIPS}</span>
        ) : (
          <span className="bc-map-dir">cups go clockwise ↻</span>
        )}
      </div>

      {ring.map((uid) => {
        const p = players.find((x) => x.uid === uid);
        const held = ([0, 1] as CupIndex[]).filter((c) => s.hold[c] === uid);
        const caught = s.caught[uid] ?? 0;
        return (
          <div
            key={uid}
            className={`bc-seat ${uid === meUid ? 'bc-seat-me' : ''} ${held.map((c) => `bc-seat-h${c}`).join(' ')} ${
              hunted.includes(uid) ? 'bc-seat-hunted' : ''
            } ${nextSeats.includes(uid) && held.length === 0 ? 'bc-seat-next' : ''} ${
              Math.sin(angleOf(uid)) < -0.3 ? 'bc-seat-top' : ''
            }`}
            style={at(uid, 43, 37)}
          >
            <span className="bc-seat-emoji">{p?.emoji ?? '👤'}</span>
            <span className="bc-seat-name">{uid === meUid ? 'YOU' : (p?.name ?? '?')}</span>
            {caught > 0 && <span className="bc-seat-caught">{caught}</span>}
            {hunted.includes(uid) && <span className="bc-seat-warn">!</span>}
          </div>
        );
      })}

      {([0, 1] as CupIndex[]).map((c) => {
        const uid = s.hold[c];
        if (!uid) return null;
        const choosing = s.phase === 'handoff' && s.give?.cup === c;
        const pos = at(uid, 29.5, 21);
        const nudge = both && !choosing ? (c === 0 ? -11 : 11) : 0;
        const misses = s.miss[c] ?? 0;
        return (
          <div
            key={c}
            className={`bc-tok bc-tok-${c} ${choosing ? 'bc-tok-choosing' : ''}`}
            style={{ ...pos, marginLeft: nudge }}
            title={`${CUP_NAME[c]} cup: ${nameOf(players, uid)}`}
          >
            <i className="bc-tok-cup" />
            {choosing ? (
              <b className="bc-tok-badge">?</b>
            ) : misses > 0 ? (
              <b className="bc-tok-badge bc-tok-miss">x{misses}</b>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- the cup: a real solo cup, in SVG ---------- */

const CUP_TINT = [
  { fill: '#f6b92b', side: '#c98f12' },
  { fill: '#ff7fa8', side: '#d9557f' },
] as const;
const INK = '#0a1410';

/**
 * A party cup, drawn like a sticker: flat fill, ink outline. The mouth's
 * centre lands on the element's own origin, with the mouth's radii exactly
 * the ones the shot is judged against (w/d): what you see is the target.
 */
function CupArt({ w, d, cup }: { w: number; d: number; cup: CupIndex }) {
  const bw = w * 2.16;
  const bodyH = w * 2.1;
  const cx = bw / 2;
  const t = CUP_TINT[cup];
  const sw = Math.max(2, w * 0.075);
  return (
    <svg
      className="bc-cup-art"
      width={bw}
      height={d + bodyH}
      viewBox={`0 0 ${bw} ${d + bodyH}`}
      style={{ transform: `translate(-50%, ${-d}px)` }}
    >
      {/* hard shadow thrown to the right */}
      <path
        d={`M ${cx - w + sw * 1.6} ${d + sw * 1.6}
            L ${cx + w + sw * 1.6} ${d + sw * 1.6}
            L ${cx + w * 0.78 + sw * 1.6} ${d + bodyH + sw * 1.2}
            Q ${cx + sw * 1.6} ${d + bodyH * 1.07 + sw * 1.2} ${cx - w * 0.78 + sw * 1.6} ${d + bodyH + sw * 1.2}
            Z`}
        fill={INK}
        opacity="0.45"
      />
      {/* tapered body */}
      <path
        d={`M ${cx - w} ${d}
            L ${cx + w} ${d}
            L ${cx + w * 0.78} ${d + bodyH}
            Q ${cx} ${d + bodyH * 1.07} ${cx - w * 0.78} ${d + bodyH}
            Z`}
        fill={t.fill}
        stroke={INK}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
      {/* the shaded side */}
      <path
        d={`M ${cx + w * 0.45} ${d + d * 0.9}
            L ${cx + w - sw * 0.5} ${d + d * 0.4}
            L ${cx + w * 0.78 - sw * 0.5} ${d + bodyH - sw * 0.3}
            L ${cx + w * 0.38} ${d + bodyH + sw * 0.2}
            Z`}
        fill={t.side}
      />
      {/* two ribs, like the real thing */}
      <g stroke={INK} strokeWidth={sw * 0.5} opacity="0.55" fill="none">
        <path d={`M ${cx - w * 0.9} ${d + bodyH * 0.42} Q ${cx} ${d + bodyH * 0.52} ${cx + w * 0.9} ${d + bodyH * 0.42}`} />
        <path d={`M ${cx - w * 0.85} ${d + bodyH * 0.66} Q ${cx} ${d + bodyH * 0.76} ${cx + w * 0.85} ${d + bodyH * 0.66}`} />
      </g>
      {/* the opening, the beer in it, and the white lip */}
      <ellipse className="bc-mouth-art" cx={cx} cy={d} rx={w} ry={d} fill="#2a1d10" stroke={INK} strokeWidth={sw} />
      <ellipse cx={cx} cy={d + d * 0.38} rx={w * 0.76} ry={d * 0.5} fill="#d9951a" />
      <ellipse cx={cx} cy={d} rx={Math.max(0, w - sw * 0.9)} ry={Math.max(0, d - sw * 0.9)} fill="none" stroke="#f7efdc" strokeWidth={sw * 0.7} />
    </svg>
  );
}

/* ---------- the lane: flick, and the ball is gone ---------- */

type Verdict = 'in' | 'rim' | 'short' | 'long' | 'wide';

interface Flight {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  verdict: Verdict;
  /** which way a bounce leaves the cup */
  dir: number;
  start: number;
  key: number;
}

const CALL: Record<Verdict, string> = {
  in: 'IN',
  rim: 'RIM',
  short: 'SHORT',
  long: 'LONG',
  wide: 'WIDE',
};

interface Dims {
  w: number;
  h: number;
}

/** where a judged shot comes down, in px — the same on every phone */
function flightFor(
  shot: { ex: number; ey: number; power: number; made: boolean },
  { w, h }: Dims,
  key: number,
): Flight {
  const mouthR = MOUTH_R * h;
  const mouthD = MOUTH_D * h;
  const cupX = w / 2;
  const cupY = CUP_Y * h;
  const ballY = BALL_Y * h;
  const r = Math.hypot(shot.ex, shot.ey);
  let y: number;
  if (shot.ey >= -1) {
    // at the cup, or past it (further up the table)
    y = cupY - shot.ey * mouthD;
  } else {
    // short: the weaker the flick, the nearer your own end it dies
    const f = clamp((0.78 - shot.power) / 0.78, 0, 1);
    y = cupY + mouthD + f * (ballY - cupY - mouthD * 2.2);
  }
  // a short ball has not drifted as far sideways as one that reached the cup
  const reach = clamp((ballY - y) / (ballY - cupY), 0.15, 1.2);
  const x = clamp(cupX + shot.ex * mouthR * reach, 10, Math.max(10, w - 10));
  const verdict: Verdict = shot.made
    ? 'in'
    : r < RIM
      ? 'rim'
      : shot.ey < -1 && Math.abs(shot.ex) <= Math.abs(shot.ey)
        ? 'short'
        : shot.ey > 1 && Math.abs(shot.ex) <= Math.abs(shot.ey)
          ? 'long'
          : 'wide';
  return {
    x0: w / 2,
    y0: ballY,
    x1: x,
    y1: Math.max(8, y),
    verdict,
    dir: shot.ex === 0 ? (key % 2 ? 1 : -1) : Math.sign(shot.ex),
    start: performance.now(),
    key,
  };
}

function Lane({
  cup,
  misses,
  readyAt = null,
  onShot,
  replay = null,
  label,
  locked = false,
}: {
  cup: CupIndex;
  misses: number;
  readyAt?: number | null;
  /** given → this lane is yours to flick on; omitted → you're only watching it */
  onShot?: (g: BcGesture) => void;
  /** watching: the last shot the host judged on this cup */
  replay?: BcShotLog | null;
  label?: React.ReactNode;
  /** your last ball is still finishing, but the cup is no longer yours */
  locked?: boolean;
}) {
  const interactive = !!onShot;
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Dims>({ w: 0, h: 0 });
  // the stroke being drawn: where it started, and when it really got going
  const stroke = useRef<{ x: number; y: number; t: number; moved: boolean; lastT: number } | null>(null);
  const [aimTo, setAimTo] = useState<{ x: number; y: number } | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  /** 0..1 = in the air, 1..2 = what it does after it comes down */
  const [prog, setProg] = useState(0);
  const waitLeft = useCountdown(readyAt) ?? 0;
  const shotNo = useRef(0);

  /* the lane's real size in px — every position is derived from it */
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
      const el = performance.now() - flight.start;
      const p = el <= FLIGHT_MS ? el / FLIGHT_MS : 1 + Math.min(1, (el - FLIGHT_MS) / AFTER_MS);
      setProg(p);
      if (p < 2) raf = requestAnimationFrame(step);
      else setFlight(null);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [flight]);

  /* watching: replay the shot the host just judged (never one from the past) */
  const replaySeq = replay?.seq ?? 0;
  useEffect(() => {
    if (interactive || !replay || replay.cup !== cup || size.h <= 0) return;
    if (serverNow() - replay.at > 2500) return;
    setProg(0);
    setFlight(flightFor(replay, size, replay.seq));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaySeq, interactive, size.h > 0]);

  const h = size.h || 1;
  const mouthR = MOUTH_R * h;
  const mouthD = MOUTH_D * h;
  const cupX = size.w / 2;
  const cupY = CUP_Y * h;
  const ballX = size.w / 2;
  const ballY = BALL_Y * h;
  /* the ball is back as soon as the host's cooldown says so — a fresh flick
     simply replaces whatever the last ball is still doing */
  const canShoot = interactive && !locked && waitLeft <= 0;
  const mercy = mercyFor(misses);

  const local = (e: React.PointerEvent) => {
    const r = areaRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

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
    const now = performance.now();
    stroke.current = { x: p.x, y: p.y, t: now, moved: false, lastT: now };
    setAimTo(p);
  };

  /* The flick is timed from the moment the thumb actually moves, and a thumb
     that stops and starts again begins a new stroke — resting a finger on the
     ball before flicking must not read as a lazy drag. */
  const onMove = (e: React.PointerEvent) => {
    const st = stroke.current;
    if (!st) return;
    const p = local(e);
    const now = performance.now();
    if (!st.moved) {
      if (Math.hypot(p.x - st.x, p.y - st.y) > 5) {
        st.moved = true;
        st.t = now - 16;
      }
    } else if (now - st.lastT > 130) {
      st.x = p.x;
      st.y = p.y;
      st.t = now - 16;
    }
    st.lastT = now;
    setAimTo(p);
  };

  const finish = (e: React.PointerEvent) => {
    const st = stroke.current;
    stroke.current = null;
    setAimTo(null);
    if (!st || !onShot) return;
    const p = local(e);
    const g: BcGesture = {
      dx: (p.x - st.x) / h,
      dy: (st.y - p.y) / h,
      ms: Math.max(1, performance.now() - st.t),
    };
    const judged = resolveShot(g, misses);
    if (!judged.ok || !canShoot) return;
    onShot(g);
    shotNo.current += 1;
    setProg(0);
    setFlight(flightFor(judged, size, shotNo.current));
  };

  /* ---- where the ball is this frame ---- */
  const t = flight ? Math.min(1, prog) : 0;
  const u = flight ? clamp(prog - 1, 0, 1) : 0;
  const v = flight?.verdict;
  const arc = h * 0.2;
  let bx = ballX;
  let by = ballY;
  let gx = ballX; // its shadow on the table
  let gy = ballY;
  let lift = 0;
  let scale = 1;
  let alpha = 1;
  if (flight) {
    gx = lerp(flight.x0, flight.x1, t);
    gy = lerp(flight.y0, flight.y1, t);
    lift = Math.sin(Math.PI * t) * arc;
    scale = lerp(1, 0.66, t);
    bx = gx;
    by = gy - lift;
    if (u > 0) {
      if (v === 'in') {
        // drops through the mouth and is gone
        by = flight.y1 + u * mouthD * 1.5;
        scale = lerp(0.66, 0.45, u);
        alpha = 1 - clamp((u - 0.25) / 0.45, 0, 1);
      } else if (v === 'rim') {
        // kicks up off the lip and away
        const hop = Math.sin(Math.PI * Math.min(1, u * 1.15)) * h * 0.13;
        gx = flight.x1 + flight.dir * u * h * 0.2;
        gy = flight.y1 + u * h * 0.1;
        bx = gx;
        by = gy - hop;
        lift = hop;
        alpha = 1 - clamp((u - 0.7) / 0.3, 0, 1);
      } else if (v === 'long') {
        gy = flight.y1 - u * h * 0.07;
        by = gy;
        scale = lerp(0.66, 0.5, u);
        alpha = 1 - u;
      } else {
        // two little hops on the table, dying away
        const hop = Math.abs(Math.sin(Math.PI * 2 * u)) * h * 0.06 * (1 - u);
        gx = flight.x1 + (flight.x1 - flight.x0) * 0.25 * u + flight.dir * u * h * 0.03;
        gy = flight.y1 - u * h * 0.05;
        bx = gx;
        by = gy - hop;
        lift = hop;
        alpha = 1 - clamp((u - 0.75) / 0.25, 0, 1);
      }
    }
  }
  const landed = !!flight && prog >= 1;
  const ballD = Math.round(clamp(h * BALL_D, 12, 30));
  const aim =
    stroke.current && aimTo && Math.hypot(aimTo.x - stroke.current.x, stroke.current.y - aimTo.y) > 12
      ? Math.atan2(aimTo.x - stroke.current.x, stroke.current.y - aimTo.y)
      : null;

  return (
    <div
      ref={areaRef}
      className={`bc-table bc-table-${cup} ${interactive ? '' : 'bc-table-watch'} ${aimTo ? 'bc-table-aiming' : ''} ${
        interactive && !canShoot ? 'bc-table-wait' : ''
      }`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={finish}
      onPointerCancel={() => {
        stroke.current = null;
        setAimTo(null);
      }}
    >
      <span className="bc-felt" aria-hidden />
      <span className="bc-felt-line" aria-hidden />
      {label && <span className="bc-table-label">{label}</span>}

      {/* the cup: mouth centred on (cupX, cupY), body hanging below */}
      <div
        className={`bc-cup ${landed && v === 'in' ? 'bc-cup-hit' : ''} ${landed && v === 'rim' ? 'bc-cup-rimmed' : ''}`}
        key={landed ? `l${flight?.key}` : 'idle'}
        style={{ left: cupX, top: cupY }}
      >
        {mercy > 0 && (
          <span
            className="bc-mercy"
            style={{ width: 2 * mouthR * (1 + mercy), height: 2 * mouthD * (1 + mercy) }}
          />
        )}
        <CupArt w={mouthR} d={mouthD} cup={cup} />
      </div>

      {/* splash when it drops in */}
      {flight && landed && v === 'in' && (
        <span className="bc-splash" key={`s${flight.key}`} style={{ left: flight.x1, top: flight.y1 }}>
          <i />
          <i />
          {[-58, -24, 8, 40, 66].map((deg) => (
            <b key={deg} style={{ ['--bc-a' as string]: `${deg}deg` }} />
          ))}
        </span>
      )}

      {/* a puff where a miss touches down */}
      {flight && landed && (v === 'short' || v === 'wide') && (
        <span className="bc-puff" key={`p${flight.key}`} style={{ left: flight.x1, top: flight.y1 }} />
      )}

      {/* the ball, its trail, and its shadow on the table */}
      {flight && (
        <>
          <span
            className="bc-shadow"
            style={{
              left: gx,
              top: gy + ballD * 0.35 * scale,
              width: ballD * 1.1,
              height: ballD * 0.4,
              transform: `translate(-50%,-50%) scale(${scale * (1 - 0.35 * (lift / arc))})`,
              opacity: alpha * 0.4 * (1 - 0.5 * (lift / arc)),
            }}
          />
          {prog < 1 &&
            [0.07, 0.14, 0.21].map((back, i) => {
              const tt = Math.max(0, t - back);
              return (
                <span
                  key={back}
                  className="bc-trail"
                  style={{
                    left: lerp(flight.x0, flight.x1, tt),
                    top: lerp(flight.y0, flight.y1, tt) - Math.sin(Math.PI * tt) * arc,
                    width: ballD,
                    height: ballD,
                    transform: `translate(-50%,-50%) scale(${lerp(1, 0.66, tt) * (1 - 0.18 * (i + 1))})`,
                    opacity: 0.34 - i * 0.09,
                  }}
                />
              );
            })}
        </>
      )}
      {((interactive && !locked) || flight) && (
        <span
          className="bc-ball"
          style={{
            left: bx,
            top: by,
            width: ballD,
            height: ballD,
            opacity: flight ? alpha : canShoot ? 1 : 0.35,
            transform: `translate(-50%,-50%) scale(${scale})`,
          }}
        />
      )}

      {/* the call: what the shot did, once it has done it */}
      {flight && landed && v && (
        <span className={`bc-call fx-stamp bc-call-${v}`} key={`c${flight.key}`}>
          {CALL[v]}
        </span>
      )}

      {/* direction tick only — nothing that says how good the flick is */}
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

      {canShoot && !flight && <span className="bc-table-hint">flick up</span>}
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
  const otherUid = s.hold[flipCup(cup)] ?? '';
  // the catch first, then the seating order from the player after you
  const order = players
    .filter((p) => p.uid !== meUid)
    .sort(
      (a, b) =>
        Number(b.uid === otherUid) - Number(a.uid === otherUid) ||
        seatsBetween(s, meUid, a.uid) - seatsBetween(s, meUid, b.uid),
    );
  return (
    <div className="bc-give fx-pop">
      <p className="pick-call">Who gets the {CUP_NAME[cup]} cup?</p>
      <div className="bc-give-list">
        {order.map((p) => (
          <button
            key={p.uid}
            className={`pick-person bc-give-btn ${p.uid === otherUid ? 'bc-give-snipe' : ''}`}
            onClick={() => onPick(p.uid)}
          >
            <span className="pick-person-emoji">{p.emoji}</span>
            <span className="bc-give-name">{p.name}</span>
            {p.uid === otherUid && <em className="fx-tag fx-tag-red bc-tag">drinks now</em>}
            {p.uid === nextUid && <em className="bc-tag-next">next seat</em>}
          </button>
        ))}
      </div>
      {otherUid && otherUid !== meUid && (
        <p className="muted small">{nameOf(players, otherUid)} has the other cup. Give them this one and they drink.</p>
      )}
    </div>
  );
}

/* ---------- no cup in hand: both lanes, live ---------- */

function Watching({ s, players, meUid }: { s: BcState; players: PlayerInfo[]; meUid: string }) {
  return (
    <div className="bc-watch">
      <div className="bc-watch-lanes">
        {([0, 1] as CupIndex[]).map((c) => {
          const uid = s.hold[c] ?? '';
          const misses = s.miss[c] ?? 0;
          const away = uid ? seatsBetween(s, uid, meUid) : 0;
          const choosing = s.phase === 'handoff' && s.give?.cup === c;
          return (
            <div key={c} className={`bc-watch-lane bc-watch-lane-${c}`}>
              <Lane
                cup={c}
                misses={misses}
                replay={s.last}
                label={
                  <>
                    <i className={`bc-dot bc-dot-${c}`} /> {emojiOf(players, uid)} {uid === meUid ? 'you' : nameOf(players, uid)}
                  </>
                }
              />
              <p className="bc-watch-note">
                {choosing ? 'sunk first try, picking' : misses > 0 ? `${misses} ${misses === 1 ? 'miss' : 'misses'}` : 'no misses yet'}
                {uid !== meUid && <b className="bc-watch-away"> · {away === 1 ? 'you are next' : `${seats(away)} away`}</b>}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- the commentary ---------- */

function Feed({
  feed,
  players,
  meUid,
  newestId,
}: {
  feed: BcFeed[];
  players: PlayerInfo[];
  meUid: string;
  newestId: number;
}) {
  const who = (uid: string | undefined) => (uid === meUid ? 'You' : nameOf(players, uid));
  const whom = (uid: string | undefined) => (uid === meUid ? 'you' : nameOf(players, uid));
  if (feed.length === 0) return null;
  const line = (e: BcFeed) => {
    const cupName = CUP_NAME[e.cup];
    switch (e.kind) {
      case 'first':
        return `${who(e.uid)} sank ${cupName} first try.`;
      case 'give':
        return `${who(e.uid)} gave ${cupName} to ${whom(e.to)}.`;
      case 'catch':
        return `${who(e.to)} got caught${e.uid ? ` by ${whom(e.uid)}` : ''}. Drinks ${CATCH_SIPS}.`;
      case 'boom':
        return `${who(e.to)} took the BOOM. Drinks ${CATCH_SIPS + BOOM_SIPS}.`;
      default:
        return `${who(e.uid)} sank ${cupName}. On to ${whom(e.to)}.`;
    }
  };
  return (
    <ul className="bc-feed">
      {[...feed]
        .reverse()
        .slice(0, 2)
        .map((e) => (
          <li
            key={e.id}
            className={`bc-feed-row bc-feed-${e.kind} ${e.id === newestId ? 'bc-feed-new' : ''} ${
              e.to === meUid || e.uid === meUid ? 'bc-feed-mine' : ''
            }`}
          >
            <i className={`bc-dot bc-dot-${e.cup}`} /> {line(e)}
          </li>
        ))}
    </ul>
  );
}
