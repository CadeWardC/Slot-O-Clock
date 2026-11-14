import { memo, useEffect, useMemo, useState } from 'react';
import { Button, TimerBar } from '../../components/ui';
import { Confetti } from '../../components/fx';
import { serverNow } from '../../state/serverTime';
import type { GameViewProps } from '../../engine/types';
import {
  BET_MS,
  GATE_MS,
  GIFT_MS,
  LAP_MS,
  MAX_STAKE,
  PHOTO_FINISH_MS,
  RACE_MS,
  leadChanges,
  raceProgress,
  stakeOf,
  type HrHorse,
  type HrInput,
  type HrState,
} from './definition';

/**
 * Smoothly interpolates the race against the engine's server-synced
 * deadline, so every phone draws the same positions at the same moment.
 */
function useRaceElapsed(deadline: number | null | undefined, totalMs: number): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (deadline == null) {
      setElapsed(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setElapsed(Math.max(0, Math.min(totalMs, totalMs - (deadline - serverNow()))));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [deadline, totalMs]);
  return elapsed;
}

/* ---------- the oval, seen from above ----------
 * A stadium: two straights joined by two half-circles. The field starts ON the
 * finish line, late in the bottom straight, runs right, sweeps up the right-hand
 * turn, back along the far straight, round the left-hand turn and home — so
 * the last ~18% of the lap is one long run to the line. */
const VB_W = 400;
const VB_H = 236;
const CY = 118;
const R = 80;
const XL = 114;
const XR = 286;
const STRAIGHT = XR - XL;
const HALF_BAND = 30;
const PERIMETER = 2 * STRAIGHT + 2 * Math.PI * R;
/** how far along the bottom straight the line sits */
const LINE_AT = 0.82;
const LINE_X = XL + LINE_AT * STRAIGHT;
/** lap fraction at which the field straightens up for home */
const HOME_STRAIGHT = 1 - (LINE_AT * STRAIGHT) / PERIMETER;
/** One horse length, as a fraction of the lap — only for the caller's margins. */
const LENGTH = 0.008;

/** The point `f` of a lap round the oval, `d` out from the middle of the track. */
function trackPoint(f: number, d: number): [number, number] {
  let dist = (((f % 1) + 1) % 1) * PERIMETER;
  const run0 = (1 - LINE_AT) * STRAIGHT;
  if (dist <= run0) return [LINE_X + dist, CY + R + d];
  dist -= run0;
  const turn = Math.PI * R;
  if (dist <= turn) {
    const th = dist / R;
    return [XR + (R + d) * Math.sin(th), CY + (R + d) * Math.cos(th)];
  }
  dist -= turn;
  if (dist <= STRAIGHT) return [XR - dist, CY - R - d];
  dist -= STRAIGHT;
  if (dist <= turn) {
    const th = dist / R;
    return [XL - (R + d) * Math.sin(th), CY - (R + d) * Math.cos(th)];
  }
  dist -= turn;
  return [XL + dist, CY + R + d];
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

/** How a margin is called from the stands. */
function margin(gap: number): string {
  const l = gap / LENGTH;
  if (l < 0.25) return 'a nose';
  if (l < 0.6) return 'a neck';
  if (l < 1.25) return 'a length';
  return `${Math.round(l)} lengths`;
}

/** The running order `t` ms after the gun: front first, finishers by the clock. */
function standings(horses: HrHorse[], t: number) {
  return horses
    .map((horse) => {
      const p = raceProgress(horse, t);
      return { horse, p: Math.min(1, p), home: t >= horse.timeMs };
    })
    .sort((a, b) =>
      a.home || b.home
        ? (a.home ? a.horse.timeMs : Infinity) - (b.home ? b.horse.timeMs : Infinity)
        : b.p - a.p || a.horse.n - b.horse.n,
    );
}

const LEAD_CALLS = [
  (n: string) => `${n} takes the lead`,
  (n: string) => `Lead change. ${n} in front`,
  (n: string) => `${n} goes to the front`,
  (n: string) => `Here comes ${n}`,
  (n: string) => `${n} goes by them`,
];

interface Call {
  atMs: number;
  text: string;
}

/**
 * Everything the caller will say, worked out from the race itself, so every
 * phone reads the same call at the same moment.
 */
function scriptFor(horses: HrHorse[]): Call[] {
  if (horses.length === 0) return [];
  const byId = new Map(horses.map((h) => [h.id, h]));
  const ranked = [...horses].sort((a, b) => a.timeMs - b.timeMs);
  const winner = ranked[0];
  const photo = ranked.length > 1 && ranked[1].timeMs - winner.timeMs < PHOTO_FINISH_MS;
  const calls: Call[] = [{ atMs: 0, text: "And they're off" }];
  const changes = leadChanges(horses);
  changes.forEach((c, i) => {
    const name = byId.get(c.horseId)?.name ?? '?';
    const last = i === changes.length - 1 && c.horseId === winner.id;
    calls.push({
      atMs: c.atMs,
      text: last ? `${name} gets up` : LEAD_CALLS[i % LEAD_CALLS.length](name),
    });
  });
  // the moment the leader straightens up for home
  for (let t = LAP_MS * 0.6; t < winner.timeMs; t += 50) {
    if (horses.some((h) => raceProgress(h, t) >= HOME_STRAIGHT)) {
      calls.push({ atMs: t, text: 'Into the home straight' });
      break;
    }
  }
  calls.push({
    atMs: winner.timeMs,
    text: photo ? `${winner.name} wins on the line` : `${winner.name} wins`,
  });
  return calls.sort((a, b) => a.atMs - b.atMs);
}

/** How long a call hangs in the air before the caller goes back to the margins. */
const CALL_HOLD_MS = 2400;

const HORSE_BODY =
  'M23.4,18 C26.8,15.7 31.6,14.9 36.4,15.3 C40.6,15.7 44.2,16.7 46.8,18.8 ' +
  'C48,13.6 50,9.8 53,7.4 L52.2,3.4 L54.6,6.6 L56.2,3 L57.6,7.6 ' +
  'C59.6,9.2 61.2,11.2 62.4,13.4 C63,14.4 63.4,15.4 62.6,16.2 ' +
  'C61.8,17 60.4,16.8 59,16.4 C57.6,16 56.4,15.4 55.2,14.8 ' +
  'C53.6,17.4 52,20 50.2,22.4 C49.2,23.6 48.4,25.4 48.2,27.2 ' +
  'C46.4,30.6 41.5,31.8 36.5,31.8 C31,31.8 25.8,30.6 23.6,27.6 ' +
  'C22.2,25.6 22,20.6 23.4,18 Z';
/** The pair that reaches for the line — swings from the shoulder. */
const HORSE_FORELEGS =
  'M45.4,26.4 C48.4,28.4 50.2,31.4 51.4,34.8 L52,41.4 ' +
  'M43.6,26.8 C44.6,29.6 45.2,32.6 45.2,35.4 L45,41.4';
/** The pair that drives from behind — swings from the hip, out of phase. */
const HORSE_HINDLEGS =
  'M27,26.2 C24,28.4 21.6,31.6 19.6,35 L17.4,41.2 ' +
  'M29.4,26.4 C27.4,29.2 26.2,32.4 26.2,35.6 L26.6,41.2';
const HORSE_TAIL = 'M23,18.4 C18.4,16.6 13.6,16 9.4,16.8 M23.4,20.4 C18.6,19.6 14,18.8 10.2,18.6';
const HORSE_MANE = 'M52.6,6.4 C49.4,9 47.2,12.8 46,17.4';

const HorseIcon = memo(function HorseIcon() {
  return (
    <svg className="hr-horse" viewBox="0 0 64 44" aria-hidden="true" focusable="false">
      <g className="hr-horse-hair">
        <path d={HORSE_TAIL} />
        <path d={HORSE_MANE} />
      </g>
      <path className="hr-horse-hind" d={HORSE_HINDLEGS} />
      <path className="hr-horse-fore" d={HORSE_FORELEGS} />
      <path className="hr-horse-body" d={HORSE_BODY} />
    </svg>
  );
});

/** Racing silks: the one thing that reliably tells runners apart on a track. */
function Silk({ horse, small }: { horse: HrHorse; small?: boolean }) {
  return (
    <span
      className={`hr-silk ${small ? 'hr-silk-sm' : ''}`}
      style={{ backgroundColor: horse.silk }}
    >
      {horse.n}
    </span>
  );
}


/** Who is on a horse, and how much each of them has riding on it. */
function Backers({
  backers,
  stakes,
}: {
  backers: GameViewProps<HrState, HrInput>['players'];
  stakes: Record<string, number> | undefined;
}) {
  return (
    <>
      {backers.map((p) => (
        <span key={p.uid} className="hr-bk">
          {p.emoji}
          <b>{stakeOf(stakes, p.uid)}</b>
        </span>
      ))}
    </>
  );
}

function Track({
  state,
  players,
  deadline,
  myBet,
  me,
}: {
  me: GameViewProps<HrState, HrInput>['me'];
  state: HrState;
  players: GameViewProps<HrState, HrInput>['players'];
  deadline: number | null;
  myBet: string | undefined;
}) {
  const elapsed = useRaceElapsed(deadline, RACE_MS);
  const horses = state.horses ?? [];
  const bets = state.bets ?? {};
  const script = useMemo(() => scriptFor(horses), [horses]);
  const t = elapsed - GATE_MS;
  const off = t >= 0;
  const n = horses.length;

  const order = standings(horses, Math.max(0, t));
  const rankOf = new Map(order.map((x, i) => [x.horse.id, i]));
  const leader = order[0];
  const second = order[1];
  const winnerHome = !!leader?.home;
  const allHome = n > 0 && order.every((x) => x.home);
  const finalStretch = off && !winnerHome && !!leader && leader.p >= HOME_STRAIGHT - 0.04;
  const frontGap = leader && second ? leader.p - second.p : 0;

  // the caller: the latest scripted line, else the margin at the front
  let line = 'One lap. First past the post.';
  let hot = false;
  let lineKey = 'm';
  if (off) {
    let at = -1;
    for (let i = 0; i < script.length; i++) if (script[i].atMs <= t) at = i;
    if (at >= 0 && (t - script[at].atMs < CALL_HOLD_MS || at === script.length - 1)) {
      line = script[at].text;
      hot = true;
      lineKey = `c${at}`;
    } else if (leader && second) {
      line = `${leader.horse.name} by ${margin(frontGap)}`;
    }
  }
  const tight = finalStretch && frontGap < LENGTH * 1.25;
  const gate = !off ? (elapsed < GATE_MS * 0.5 ? 'READY' : 'SET') : t < 650 ? 'GO' : null;
  const toGo = leader ? Math.max(0, Math.round(((1 - leader.p) * 1000) / 10) * 10) : 0;

  // my horse: where it is, and whether it is going forwards or backwards
  const mine = horses.find((h) => h.id === myBet);
  const myRank = mine ? (rankOf.get(mine.id) ?? 0) : 0;
  let move = 0;
  if (mine && t > 900 && !winnerHome) {
    const before = standings(horses, t - 900).findIndex((x) => x.horse.id === mine.id);
    move = before - myRank;
  }

  const laneGap = n > 1 ? Math.min(13, (2 * HALF_BAND - 14) / (n - 1)) : 0;
  const dotR = n > 5 ? 8 : 10;
  const ROW = 31;
  // draw back-markers first so the leaders sit on top
  const drawOrder = [...order].reverse();

  return (
    <div className="hr-race">
      {mine && (
        <div
          className={`hr-mine ${myRank === 0 && off ? 'hr-mine-lead' : ''} ${
            myRank === n - 1 && off ? 'hr-mine-last' : ''
          }`}
        >
          <Silk horse={mine} />
          <span className="hr-mine-text">
            <span className="fx-kicker">you have {stakeOf(state.stakes, me.uid)} on</span>
            <span className="hr-mine-name">{mine.name}</span>
          </span>
          <span
            className={`hr-mine-move ${move > 0 ? 'hr-mine-up' : move < 0 ? 'hr-mine-down' : ''}`}
          >
            {move > 0 ? '▲' : move < 0 ? '▼' : ''}
          </span>
          <span className="hr-mine-place">{off ? ordinal(myRank + 1) : '·'}</span>
        </div>
      )}

      <div
        className={`hr-oval ${finalStretch ? 'hr-oval-final' : ''} ${winnerHome ? 'hr-oval-done' : ''}`}
      >
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} aria-hidden="true" focusable="false">
          <rect className="hr-turf" x="0" y="0" width={VB_W} height={VB_H} />
          <rect
            className="hr-dirt"
            x={XL - R - HALF_BAND}
            y={CY - R - HALF_BAND}
            width={STRAIGHT + 2 * (R + HALF_BAND)}
            height={2 * (R + HALF_BAND)}
            rx={R + HALF_BAND}
          />
          <rect
            className="hr-dirt-grain"
            x={XL - R}
            y={CY - R}
            width={STRAIGHT + 2 * R}
            height={2 * R}
            rx={R}
          />
          <rect
            className="hr-infield"
            x={XL - R + HALF_BAND}
            y={CY - R + HALF_BAND}
            width={STRAIGHT + 2 * (R - HALF_BAND)}
            height={2 * (R - HALF_BAND)}
            rx={R - HALF_BAND}
          />
          {/* the line: start and finish */}
          <line className="hr-line-post" x1={LINE_X} x2={LINE_X} y1={CY + R - HALF_BAND} y2={CY + R + HALF_BAND} />
          <line className="hr-line-post2" x1={LINE_X} x2={LINE_X} y1={CY + R - HALF_BAND} y2={CY + R + HALF_BAND} />
          <text className="hr-line-label" x={LINE_X} y={CY + R - HALF_BAND - 6}>FINISH</text>

          {drawOrder.map(({ horse, home }) => {
            const raw = off ? raceProgress(horse, t) : 0;
            // a finisher eases up past the post instead of freezing on it
            const p = home ? 1 + 0.03 * (1 - Math.exp(-(t - horse.timeMs) / 500)) : Math.min(1, raw);
            const d = -HALF_BAND + 7 + (horse.n - 1) * laneGap + (n < 5 ? (4 - n) * 3 : 0);
            const [x, y] = trackPoint(p, d);
            const lead = off && leader?.horse.id === horse.id;
            const isMine = horse.id === myBet;
            const trail = off && !home
              ? Array.from({ length: 6 }, (_, i) => trackPoint(Math.max(0, p - 0.03 + i * 0.006), d))
                  .map(([tx, ty]) => `${tx.toFixed(1)},${ty.toFixed(1)}`)
                  .join(' ')
              : null;
            return (
              <g key={horse.id}>
                {trail && <polyline className="hr-trail" points={trail} stroke={horse.silk} />}
                {isMine && !finalStretch && <circle className="hr-dot-ring" cx={x} cy={y} r={dotR + 2} />}
                {lead && (
                  <path
                    className="hr-dot-flag"
                    d={`M${x},${y - dotR} v-11 l9,3.5 l-9,3.5`}
                  />
                )}
                <circle className="hr-dot" cx={x} cy={y} r={dotR} fill={horse.silk} />
                <text className="hr-dot-n" x={x} y={y}>{horse.n}</text>
              </g>
            );
          })}
        </svg>

        <div className="hr-caller">
          {gate ? (
            <span key={gate} className={`hr-caller-big ${gate === 'GO' ? 'hr-caller-go' : ''}`}>
              {gate}
            </span>
          ) : winnerHome ? (
            <span className="hr-caller-kick">{allHome ? 'all home' : 'the rest are coming in'}</span>
          ) : (
            <>
              <span className="hr-caller-big">{toGo}m</span>
              <span className="hr-caller-kick">to go</span>
            </>
          )}
        </div>
        {winnerHome && <span className="hr-flash" />}
        {winnerHome && second && second.horse.timeMs - leader.horse.timeMs < PHOTO_FINISH_MS && (
          <span className="hr-photo fx-tag">Photo finish</span>
        )}
      </div>

      <div className="hr-ticker" role="status">
        <span
          key={lineKey}
          className={`hr-ticker-line ${hot ? 'hr-ticker-hot' : ''} ${tight && !hot ? 'hr-ticker-tight' : ''}`}
        >
          {line}
        </span>
        {off && leader && second && !winnerHome && (
          <>
            <Silk horse={leader.horse} small />
            <Silk horse={second.horse} small />
          </>
        )}
      </div>

      <div className="hr-board" style={{ height: n * ROW + 5 }}>
        {horses.map((horse) => {
          const rank = off ? (rankOf.get(horse.id) ?? 0) : horse.n - 1;
          const entry = order[rankOf.get(horse.id) ?? 0];
          const backers = players.filter((x) => bets[x.uid] === horse.id);
          const lead = off && rank === 0;
          return (
            <div
              key={horse.id}
              className={`hr-brow ${lead ? 'hr-brow-lead' : ''} ${horse.id === myBet ? 'hr-brow-mine' : ''}`}
              style={{ transform: `translateY(${rank * ROW}px)` }}
            >
              <span className="hr-brow-place">{rank + 1}</span>
              <Silk horse={horse} small />
              <span className="hr-brow-name">{horse.name}</span>
              <span className="hr-brow-backers">
                <Backers backers={backers} stakes={state.stakes} />
              </span>
              <span className="hr-brow-gap">
                {!off
                  ? ''
                  : entry?.home
                    ? fmt(horse.timeMs)
                    : lead
                      ? 'LEADS'
                      : `+${(((leader?.p ?? 0) - (entry?.p ?? 0)) / LENGTH).toFixed(1)}L`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function View({
  state,
  me,
  players,
  variant,
  timerEndsAt,
  submitInput,
}: GameViewProps<HrState, HrInput>) {
  const horses = state.horses ?? [];
  const bets = state.bets ?? {};
  const gifts = state.gifts ?? {};
  const stakes = state.stakes;
  // what I'm about to put down, and how I'm about to split my winnings:
  // both live on this phone until the one tap that sends them
  const [stake, setStake] = useState(1);
  const [give, setGive] = useState<Record<string, number>>({});
  useEffect(() => {
    // a fresh card starts with nothing dealt
    if (state.phase === 'betting') setGive({});
  }, [state.phase]);
  const myBet = bets[me.uid];
  const backersOf = (horseId: string) => players.filter((p) => bets[p.uid] === horseId);
  const nameOf = (uid: string) => players.find((p) => p.uid === uid)?.name ?? '?';

  /* ---------- place your bet ---------- */
  if (state.phase === 'betting') {
    const betCount = Object.keys(bets).length;
    const myHorse = horses.find((h) => h.id === myBet);
    return (
      <div className="gv hr">
        <div className="hr-head">
          <span className="fx-kicker">one lap, first past the post</span>
          <h2 className="fx-title">Racecard</h2>
        </div>
        {!myBet && (
          <div className="hr-stakebox">
            <div className="hr-stakebox-label">
              <span className="fx-kicker">drinks on it</span>
              <div className="hr-chips">
                {[1, 3, 5, MAX_STAKE].map((v) => (
                  <button
                    key={v}
                    className={`hr-chip ${stake === v ? 'hr-chip-on' : ''}`}
                    onClick={() => setStake(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="hr-stepper">
              <button
                className="hr-step"
                aria-label="one less"
                disabled={stake <= 1}
                onClick={() => setStake(stake - 1)}
              >
                −
              </button>
              <span className="hr-stake-n">{stake}</span>
              <button
                className="hr-step"
                aria-label="one more"
                disabled={stake >= MAX_STAKE}
                onClick={() => setStake(stake + 1)}
              >
                +
              </button>
            </div>
          </div>
        )}
        <div className="hr-field">
          {horses.map((horse) => {
            const backers = backersOf(horse.id);
            const mine = myBet === horse.id;
            return (
              <button
                key={horse.id}
                className={`hr-card ${mine ? 'hr-card-mine' : ''} ${myBet && !mine ? 'hr-card-dim' : ''}`}
                disabled={!!myBet}
                onClick={() => submitInput({ action: 'bet', horseId: horse.id, stake })}
              >
                <Silk horse={horse} />
                <span className="hr-card-text">
                  <span className="hr-name">{horse.name}</span>
                  {horse.quirk && <span className="hr-quirk">{horse.quirk}</span>}
                </span>
                <span className="hr-backers">
                  <Backers backers={backers} stakes={stakes} />
                </span>
                {mine && <span className="hr-pick fx-tag fx-tag-ink">Yours</span>}
              </button>
            );
          })}
        </div>
        <div className="hr-stakes">
          <span className="hr-stake hr-stake-good"><b>WIN</b>hand out your stake</span>
          <span className="hr-stake hr-stake-bad"><b>LOSE</b>drink your stake</span>
          <span className="hr-stake hr-stake-bad"><b>WORST PICK</b>1 more on top</span>
        </div>
        <div className="hr-hint">
          <p className="muted small">
            {myBet
              ? `${stakeOf(stakes, me.uid)} on ${myHorse?.name}. ${betCount} of ${players.length} bets in.`
              : `Tap a horse to put ${stake} on it.`}
          </p>
          <span className="hr-progress">
            <span
              className="hr-progress-fill"
              style={{ width: `${players.length > 0 ? (betCount / players.length) * 100 : 0}%` }}
            />
          </span>
        </div>
        <TimerBar deadline={timerEndsAt} totalMs={BET_MS} />
      </div>
    );
  }

  /* ---------- the race ---------- */
  if (state.phase === 'racing') {
    return (
      <div className="gv hr">
        <Track state={state} players={players} deadline={timerEndsAt} myBet={myBet} me={me} />
      </div>
    );
  }

  /* ---------- the winners pay out ---------- */
  if (state.phase === 'gifting') {
    const winnerHorse = horses.find((h) => h.id === state.winnerHorseId);
    const gifters = winnerHorse ? backersOf(winnerHorse.id) : [];
    const iGift = gifters.some((p) => p.uid === me.uid);
    const myGift = gifts[me.uid];
    const handedOut = Object.keys(gifts).length;
    const myStake = stakeOf(stakes, me.uid);
    const given = Object.values(give).reduce((sum, v) => sum + v, 0);
    const left = Math.max(0, myStake - given);
    // drinks already coming someone's way from the winners who are done
    const incoming: Record<string, number> = {};
    for (const g of Object.values(gifts)) {
      for (const [uid, v] of Object.entries(g ?? {})) incoming[uid] = (incoming[uid] ?? 0) + v;
    }

    return (
      <div className="gv hr">
        {iGift && !myGift && <Confetti />}
        <div className="hr-head">
          <span className="fx-kicker">the winners pay out</span>
          <h2 className="fx-title">{iGift ? 'You backed it' : 'Paying out'}</h2>
        </div>
        {winnerHorse && (
          <div className="hr-winner">
            <span className="hr-gallop">
              <HorseIcon />
            </span>
            <Silk horse={winnerHorse} />
            <span className="hr-winner-text">
              <span className="hr-winner-name">{winnerHorse.name}</span>
              <span className="hr-winner-sub">
                backed by <Backers backers={gifters} stakes={stakes} />
              </span>
            </span>
          </div>
        )}
        {iGift ? (
          myGift ? (
            <p className="muted">
              You gave{' '}
              {Object.entries(myGift)
                .map(([uid, v]) => `${nameOf(uid)} ${v}`)
                .join(', ')}
              . {handedOut} of {gifters.length} winners done.
            </p>
          ) : (
            <>
              <p className="pick-call">
                <b className="hr-left">{left}</b> of {myStake} left to hand out. Tap a name to give
                one.
              </p>
              <div className="pick-people">
                {players
                  .filter((p) => p.uid !== me.uid)
                  .map((p) => (
                    <button
                      key={p.uid}
                      className={`pick-person ${give[p.uid] ? 'pick-person-got' : ''}`}
                      disabled={left <= 0}
                      onClick={() => setGive({ ...give, [p.uid]: (give[p.uid] ?? 0) + 1 })}
                    >
                      <span className="pick-person-emoji">{p.emoji}</span> {p.name}
                      {give[p.uid] ? <span className="hr-give-n">+{give[p.uid]}</span> : null}
                      {incoming[p.uid] ? (
                        <span className="pick-person-flag">has {incoming[p.uid]}</span>
                      ) : null}
                    </button>
                  ))}
              </div>
              <div className="hr-give-actions">
                <Button variant="ghost" size="md" disabled={given === 0} onClick={() => setGive({})}>
                  Undo
                </Button>
                <Button
                  variant="gold"
                  size="md"
                  full
                  disabled={given === 0}
                  onClick={() => submitInput({ action: 'gift', give })}
                >
                  {given === 0 ? 'HAND OUT' : `HAND OUT ${given}`}
                </Button>
              </div>
              {left > 0 && given > 0 && (
                <p className="muted small hr-note">The {left} you keep back go to nobody.</p>
              )}
            </>
          )
        ) : (
          <p className="muted">
            {gifters.map((p) => p.name).join(' and ')} {gifters.length > 1 ? 'are' : 'is'} picking
            who drinks.
          </p>
        )}
        {variant === 'shared' && !iGift && (
          <Button variant="ghost" size="lg" full onClick={() => submitInput({ action: 'wait' })}>
            PASS IT ON
          </Button>
        )}
        <TimerBar deadline={timerEndsAt} totalMs={GIFT_MS} />
      </div>
    );
  }

  /* ---------- the finish ---------- */
  const order = state.order ?? [];
  const assignments = state.assignments ?? [];
  const penalties = state.penalties ?? {};
  const autoBets = Object.keys(state.auto ?? {});
  const winnerHorse = horses.find((h) => h.id === state.winnerHorseId);
  const winnerMs = winnerHorse?.timeMs ?? 0;
  const iWon = !!myBet && myBet === state.winnerHorseId;
  const mySips = assignments.filter((a) => a.uid === me.uid).reduce((sum, a) => sum + a.sips, 0);

  return (
    <div className="gv hr">
      {iWon && <Confetti />}
      <div className="hr-slip">
        <span className="fx-kicker">result</span>
        <h2 className="hr-slip-title">{winnerHorse ? `${winnerHorse.name} wins` : 'Finish'}</h2>
        {myBet &&
          (iWon ? (
            <span className="fx-stamp fx-stamp-good">Paid</span>
          ) : mySips > 0 ? (
            <span className="fx-stamp">Drink {mySips}</span>
          ) : (
            <span className="fx-stamp fx-stamp-gold">Safe</span>
          ))}
        {state.note && <p className="hr-result-note">{state.note}</p>}
        <div className="hr-results">
          {order.map((horseId, i) => {
            const horse = horses.find((h) => h.id === horseId);
            if (!horse) return null;
            const backers = backersOf(horse.id);
            const penalty = penalties[horse.id];
            return (
              <div key={horse.id} className={`hr-row ${horse.id === myBet ? 'hr-row-mine' : ''}`}>
                <span className="hr-row-place">{ordinal(i + 1)}</span>
                <Silk horse={horse} small />
                <span className="hr-row-who">
                  <span className="hr-row-name">{horse.name}</span>
                  <span className="hr-row-backers">
                    <Backers backers={backers} stakes={stakes} />
                  </span>
                </span>
                {penalty && <span className="hr-row-sips">worst pick +{penalty}</span>}
                <span className="hr-row-time">
                  {i === 0 ? fmt(horse.timeMs) : `+${fmt(horse.timeMs - winnerMs)}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {assignments.length > 0 && (
        <div className="hr-drinks">
          {assignments.map((a, i) => (
            <p key={`${a.uid}-${i}`} className={`hr-drink ${a.uid === me.uid ? 'hr-drink-me' : ''}`}>
              <b>
                {nameOf(a.uid)} drinks {a.sips}.
              </b>{' '}
              <span className="muted">{a.reason}</span>
            </p>
          ))}
        </div>
      )}
      {autoBets.length > 0 && (
        <p className="muted small hr-note">The house bet 1 for {autoBets.map(nameOf).join(', ')}.</p>
      )}
    </div>
  );
}
