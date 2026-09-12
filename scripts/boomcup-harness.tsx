/**
 * Throwaway visual harness for Boom Cup — mounts the game's View in six
 * phone-sized frames with mocked rooms, so the screens can be eyeballed (or
 * screenshotted) without Firebase. Delete after use:
 *
 *   npm run dev
 *   http://localhost:5173/Slot-O-Clock/scripts/boomcup-harness.html
 */
import './boomcup-harness-shim';
import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { View } from '../src/games/BoomCup/View';
import {
  definition,
  SHOT_COOLDOWN_MS,
  type BcInput,
  type BcState,
} from '../src/games/BoomCup/definition';
import { IDEAL_SWIPE } from '../src/games/BoomCup/physics';
import { mulberry32 } from '../src/engine/rng';
import type { GameContext, GameViewProps, PlayerInfo, RoomMode } from '../src/engine/types';

const players: PlayerInfo[] = [0, 1, 2, 3, 4].map((i) => ({
  uid: `p${i}`,
  name: ['Alex', 'Bo', 'Cass', 'Dev', 'Eve'][i],
  emoji: ['🍺', '🦄', '🐸', '🦊', '🐼'][i],
  isHost: i === 0,
  connected: true,
  local: false,
  drinkCount: i,
  score: 0,
  joinedAt: i,
}));

let now = 1_000_000;

const ctx = (mode: RoomMode = 'party'): GameContext => ({
  players,
  actorUid: 'p0',
  turnOrder: players.map((p) => p.uid),
  settings: { mode, pointsMode: false, sipMultiplier: 1, enabledGames: ['boom-cup'] },
  rng: mulberry32(7),
  now,
});

const IN: BcInput['shot'] = { dx: 0, dy: IDEAL_SWIPE, ms: 200 };
const SHORT: BcInput['shot'] = { dx: 0, dy: IDEAL_SWIPE * 0.6, ms: 200 };

function play(mode: RoomMode, steps: ((s: BcState) => BcInput | null)[]): BcState {
  let s = definition.createInitialState(ctx(mode));
  for (const step of steps) {
    const input = step(s);
    if (!input) break;
    now += SHOT_COOLDOWN_MS + 50;
    const uid = s.give?.uid ?? (s.hold[s.turn] ?? 'p0');
    s = definition.reduce(s, { type: 'INPUT', uid, input }, ctx(mode)).state;
  }
  return s;
}

const nextOf = (s: BcState, uid: string): string => {
  const ring = s.ring ?? [];
  const i = ring.indexOf(uid);
  return i < 0 ? (ring[0] ?? '') : (ring[(i + 1) % ring.length] ?? '');
};

/* ---------- the six screens ---------- */
const fresh = definition.createInitialState(ctx());
const missed = play('party', [() => ({ shot: SHORT }), () => ({ shot: SHORT }), () => ({ shot: SHORT })]);
const choosing = play('party', [() => ({ shot: IN })]);
const caught = play('party', [() => ({ shot: IN }), (s) => ({ give: s.hold[1] })]);
const late = play('party', [
  () => ({ shot: IN }),
  (s) => ({ give: s.hold[1] }),
  () => ({ shot: IN }),
  (s) => ({ give: nextOf(s, 'p2') }),
  () => ({ shot: IN }),
  (s) => ({ give: nextOf(s, 'p2') }),
  () => ({ shot: IN }),
  (s) => ({ give: nextOf(s, 'p3') }),
]);
const sharedState = play('shared', [() => ({ shot: SHORT }), () => ({ shot: SHORT })]);

const screens: { title: string; state: BcState; me: string; variant: RoomMode; drag?: boolean }[] = [
  { title: 'party · your cup, first try', state: fresh, me: 'p0', variant: 'party' },
  { title: 'party · mid-drag aim guide', state: fresh, me: 'p0', variant: 'party', drag: true },
  { title: 'party · 3 misses (aim assist)', state: missed, me: 'p0', variant: 'party' },
  { title: 'party · first try → who gets it', state: choosing, me: 'p0', variant: 'party' },
  { title: 'party · caught, both cups', state: caught, me: 'p2', variant: 'party' },
  { title: 'party · the chase is on', state: late, me: 'p0', variant: 'party' },
  { title: 'party · no cup (watching)', state: late, me: 'p4', variant: 'party' },
  { title: 'shared phone · the other ball', state: sharedState, me: 'p2', variant: 'shared' },
];

/** Drives a real drag on the table so the aim guide can be photographed. */
function Phone({ title, state, me, variant, drag }: (typeof screens)[number]) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!drag) return;
    const table = ref.current?.querySelector('.bc-table') as HTMLElement | null;
    if (!table) return;
    const r = table.getBoundingClientRect();
    const opts = { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true };
    const mid = { clientX: r.left + r.width / 2 + 6, clientY: r.top + r.height * 0.5 };
    table.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.82 }));
    table.dispatchEvent(new PointerEvent('pointermove', { ...opts, ...mid }));
  }, [drag]);

  const props: GameViewProps<BcState, BcInput> = {
    state,
    me: players.find((p) => p.uid === me)!,
    players,
    actorUid: 'p0',
    isActor: me === 'p0',
    isAuthority: false,
    myInput: null,
    answeredUids: [],
    timerEndsAt: now + 14_000,
    submitInput: (input: BcInput) => {
      const w = window as unknown as { __shots?: unknown[] };
      (w.__shots ??= []).push({ phone: title, me, input });
    },
    variant,
  };

  return (
    <div className="phone">
      <p className="phone-tag">{title}</p>
      <div className="phone-screen" ref={ref}>
        <div className="screen game-screen">
          <header className="game-head">
            <span className="round-chip">R2</span>
            <span className="game-title">Boom Cup</span>
            <button className="head-btn">📊</button>
          </header>
          <main className="game-body">
            <div className="playing-wrap">
              <View {...props} />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <>
      <Probe />
      <div className="grid">
        {screens.map((s) => (
          <Phone key={s.title} {...s} />
        ))}
      </div>
    </>
  </StrictMode>,
);

/**
 * Measures what the browser actually laid out and prints a verdict into the
 * page, so the harness can be read with `chrome --dump-dom` (no eyes needed):
 * the game has to fit a phone, the cup and ball have to sit inside the table,
 * and nothing may overflow sideways.
 */
function Probe() {
  useEffect(() => {
    const id = window.setTimeout(() => {
      const lines: string[] = [];
      let fails = 0;
      const say = (ok: boolean, msg: string) => {
        if (!ok) fails++;
        lines.push(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`);
      };
      const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
      const inside = (a: DOMRect | null, b: DOMRect | null, tol = 2) =>
        !!a && !!b && a.top >= b.top - tol && a.bottom <= b.bottom + tol && a.left >= b.left - tol && a.right <= b.right + tol;

      document.querySelectorAll('.phone').forEach((phone) => {
        const tag = phone.querySelector('.phone-tag')?.textContent ?? '?';
        const at = (sel: string) => phone.querySelector(sel);
        const size = (sel: string) => {
          const r = rect(at(sel));
          return r ? `${Math.round(r.width)}×${Math.round(r.height)}` : 'missing';
        };
        const screenEl = phone.querySelector<HTMLElement>('.screen');
        const gv = at('.gv');

        say(
          !!screenEl && screenEl.scrollHeight <= screenEl.clientHeight + 2,
          `${tag} → the whole view fits ${screenEl?.clientHeight}px of phone (content ${screenEl?.scrollHeight}px)`,
        );
        say(!!gv && gv.scrollWidth <= gv.clientWidth + 2, `${tag} → nothing overflows sideways`);

        const table = at('.bc-table');
        if (table) {
          const tr = rect(table);
          say(!!tr && tr.height >= 200 && tr.width >= 300, `${tag} → the table is playable: ${size('.bc-table')}`);
          say(inside(rect(at('.bc-mouth')), tr), `${tag} → the cup is on the table`);
          say(inside(rect(at('.bc-ball')), tr), `${tag} → the ball is on the table`);
          const mouth = rect(at('.bc-mouth'));
          const ball = rect(at('.bc-ball'));
          say(!!mouth && !!ball && mouth.top < ball.top, `${tag} → the cup is above the ball`);
          const hud = at('.bc-hud');
          say(
            !!hud && hud.scrollWidth <= hud.clientWidth + 2,
            `${tag} → the power readout fits (${size('.bc-hud')})`,
          );
          const ghost = at('.bc-ghost');
          if (tag.includes('drag')) {
            say(!!ghost, `${tag} → dragging shows the aim ghost`);
            say(inside(rect(ghost), tr), `${tag} → the aim ghost stays on the table`);
            const fill = at('.bc-power-fill');
            say(!!fill && rect(fill)!.width > 0, `${tag} → the power bar is reading`);
          }
          say(
            !!at('.bc-table-hint') && inside(rect(at('.bc-table-hint')), tr),
            `${tag} → the hint line is inside the table`,
          );
        }

        const picker = at('.bc-give');
        if (picker) {
          say(picker.scrollWidth <= picker.clientWidth + 2, `${tag} → the picker fits`);
          say(phone.querySelectorAll('.pick-person').length === players.length - 1, `${tag} → one button per other player`);
        }
        const mercy = at('.bc-mercy');
        if (tag.includes('3 misses')) say(!!mercy, `${tag} → the aim assist ring is drawn`);
        const watch = at('.bc-watch');
        if (watch) say(watch.scrollWidth <= watch.clientWidth + 2, `${tag} → the watch panel fits`);
      });

      lines.push(fails === 0 ? 'LAYOUT OK' : `LAYOUT ${fails} FAILED`);
      const pre = document.createElement('pre');
      pre.id = 'report';
      pre.textContent = lines.join('\n');
      document.body.prepend(pre);
    }, 400);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
