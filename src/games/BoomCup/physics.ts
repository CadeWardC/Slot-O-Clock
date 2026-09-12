/**
 * ============================================================
 *  BOOM CUP — the shot itself
 * ============================================================
 * One flick = one shot, and the verdict is pure maths. The host reducer
 * decides (host-authoritative, nobody can fake a make) and every phone draws
 * the same ball, from the same numbers, with no round trip — so the ball you
 * watch land where your thumb flicked is the ball the host judged.
 *
 * The feel is GamePigeon cup pong: flick up, let go, and the ball is gone on
 * the next frame. Nothing on screen tells you whether it is going in.
 *
 * A flick is measured in play-area HEIGHTS: `dx`/`dy` are how far it went, in
 * table heights, `dy` positive = upwards. Power comes from how FAR you
 * flicked and how HARD:
 *
 *   distance = dy / IDEAL_SWIPE               1 = the ideal flick
 *   pace     = how fast that flick was        a lazy drag sags, a snap carries
 *   power    = distance × pace
 *   ex       = tan(flick angle) × SIDE_GAIN   sideways drift, in mouth radii
 *   ey       = (power − 1) / POWER_TOL        short/long, in mouth depths
 *
 * The ball lands at (ex, ey) — (0,0) is dead centre — and drops in when it
 * lands inside the mouth. Every consecutive miss widens the mouth for that cup
 * by MERCY_PER_MISS (`mercy`), so a player having a bad night still gets
 * there: the game is a race, not a wall.
 */

export interface BcGesture {
  /** flick to the right, in play-area heights */
  dx: number;
  /** flick upwards, in play-area heights */
  dy: number;
  /** how long the flick took, in ms */
  ms: number;
}

export interface BcShot {
  /** a real flick, not a stray tap */
  ok: boolean;
  made: boolean;
  /** lateral landing error, in mouth radii */
  ex: number;
  /** depth landing error, in mouth depths */
  ey: number;
  /** the power the flick earned (1 = perfect) */
  power: number;
  /** distance from the middle of the mouth, in mouths (≤ 1 + mercy = in) */
  r: number;
  /** the widening this shot was judged with (from the cup's miss streak) */
  mercy: number;
}

/** flick this fraction of the table's height and the distance is perfect */
export const IDEAL_SWIPE = 0.4;
/** how far off perfect power still lands on the cup (±) */
export const POWER_TOL = 0.22;
/** table-heights per ms of a flick that carries exactly as far as it should */
export const FLICK_SPEED = 0.0019;
/** a lazy drag loses this much of its power… */
export const SPEED_SAG = 0.85;
/** …a snap flick gains this much */
export const SPEED_BOOST = 1.18;
/** sideways drift per unit of tan(flick angle), in mouth radii */
export const SIDE_GAIN = 2.6;
/** anything shorter than this isn't a shot at all */
export const MIN_SWIPE = 0.06;
/** a shot this far out still clips the rim (and looks like it) */
export const RIM = 1.25;
/** the mouth grows this much per consecutive miss… */
export const MERCY_PER_MISS = 0.22;
/** …up to here */
export const MERCY_MAX = 0.62;

/** cup mouth: radii as fractions of the table's height (View draws with these) */
export const MOUTH_R = 0.135;
export const MOUTH_D = 0.095;
/** where the cup's mouth sits, and where the ball rests (fractions of height) */
export const CUP_Y = 0.3;
export const BALL_Y = 0.9;
/** the ball's own size, as a fraction of the table's height */
export const BALL_D = 0.062;

/** the aim assist a cup currently enjoys */
export function mercyFor(misses: number): number {
  return Math.min(MERCY_MAX, Math.max(0, misses) * MERCY_PER_MISS);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Judge one flick. Everything here is deterministic, so the shooting phone can
 * draw the flight before the host has even seen the input.
 */
export function resolveShot(gesture: BcGesture | null | undefined, misses: number): BcShot {
  const dx = Number(gesture?.dx ?? 0) || 0;
  const dy = Number(gesture?.dy ?? 0) || 0;
  const ms = Math.max(1, Number(gesture?.ms ?? 0) || 0);
  const mercy = mercyFor(misses);

  // far enough up to be a flick at all?
  if (!(dy >= MIN_SWIPE)) {
    return { ok: false, made: false, ex: 0, ey: -1, power: 0, r: 2, mercy };
  }

  const distance = dy / IDEAL_SWIPE;
  // pace ramps linearly from the sag to the boost between a standstill and a
  // hard flick, then holds — so the shot is about the flick, not about luck
  const ratio = (dy / ms) / FLICK_SPEED;
  const pace =
    ratio <= 1
      ? SPEED_SAG + (1 - SPEED_SAG) * ratio
      : 1 + (SPEED_BOOST - 1) * Math.min(1, ratio - 1);
  const power = clamp(distance * pace, 0, 1.7);

  const angle = Math.atan2(dx, Math.max(dy, 0.06));
  const ex = clamp(Math.tan(angle) * SIDE_GAIN, -2.6, 2.6);
  const ey = clamp((power - 1) / POWER_TOL, -1.9, 1.4);
  const r = Math.hypot(ex, ey);

  return { ok: true, made: r <= 1 + mercy, ex, ey, power, r, mercy };
}
