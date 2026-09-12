/**
 * Throwaway visual harness for Boom Cup — mounts the game's View in
 * phone-sized frames with mocked rooms so the screens can be measured in a real
 * browser without Firebase. Deleted after use.
 */
import './boomcup-harness-env';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { View } from '../src/games/BoomCup/View';
import { definition, SHOT_COOLDOWN_MS, type BcInput, type BcState } from '../src/games/BoomCup/definition';
import { BALL_Y, CUP_Y, IDEAL_SWIPE, MOUTH_R } from '../src/games/BoomCup/physics';
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
const SHORT: BcInput['shot'] = { dx: 0, dy: IDEAL_SWIPE * 0.5, ms: 200 };

function play(mode: RoomMode, steps: ((s: BcState) => BcInput | null)[]): BcState {
  let s = definition.createInitialState(ctx(mode));
  for (const step of steps) {
    const input = step(s);
    if (!input) break;
    now += SHOT_COOLDOWN_MS + 50;
    const uid = s.give?.uid ?? s.hold[s.turn] ?? 'p0';
    s = definition.reduce(s, { type: 'INPUT', uid, input }, ctx(mode)).state;
  }
  return s;
}

const fresh = definition.createInitialState(ctx());
const missed = play('party', [() => ({ shot: SHORT }), () => ({ shot: SHORT })]);
const caught = play('party', [() => ({ shot: IN }), (s) => ({ give: s.hold[1] })]);
const freshCaught: BcState = { ...caught, lastCatch: { ...caught.lastCatch!, at: Date.now() } };

const screens: { title: string; state: BcState; me: string; variant: RoomMode }[] = [
  { title: 'holder · fresh cup', state: fresh, me: 'p0', variant: 'party' },
  { title: 'holder · two misses', state: missed, me: 'p0', variant: 'party' },
  { title: 'caught · the flash', state: freshCaught, me: 'p2', variant: 'party' },
  { title: 'no cup · watching', state: caught, me: 'p4', variant: 'party' },
];

function Phone({ title, state, me, variant }: (typeof screens)[number]) {
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
      <div className="phone-screen">
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

function Probe() {
  useEffect(() => {
    const measure = (): string => {
      const lines: string[] = [];
      let fails = 0;
      const say = (ok: boolean, msg: string) => {
        if (!ok) fails++;
        lines.push(`${ok ? 'ok  ' : 'FAIL'}: ${msg}`);
      };
      const r = (el: Element | null) => (el ? el.getBoundingClientRect() : null);

      document.querySelectorAll('.phone').forEach((phone) => {
        const tag = phone.querySelector('.phone-tag')?.textContent ?? '?';
        const q = (sel: string) => phone.querySelector(sel);
        const screenEl = phone.querySelector<HTMLElement>('.screen');
        const gv = q('.gv');
        say(
          !!screenEl && screenEl.scrollHeight <= screenEl.clientHeight + 2,
          `${tag} → fits ${screenEl?.clientHeight}px of phone (content ${screenEl?.scrollHeight}px)`,
        );
        say(!!gv && gv.scrollWidth <= gv.clientWidth + 2, `${tag} → nothing overflows sideways`);
        const text = (gv?.textContent ?? '').toLowerCase();
        say(
          !/power|on target|aim assist|off line|on the rim|accuracy/.test(text),
          `${tag} → the screen tells you nothing about the shot`,
        );

        const table = q('.bc-table');
        if (!table) {
          say(!!q('.bc-watch'), `${tag} → no cup, no table, they watch instead`);
          return;
        }
        const tr = r(table)!;
        const cupX = tr.left + tr.width / 2;
        const cupY = tr.top + tr.height * CUP_Y;
        const mouth = r(q('.bc-mouth-art'));
        const svg = r(q('.bc-cup-art'));
        const ball = r(q('.bc-ball'));
        const mouthR = tr.height * MOUTH_R;

        say(
          !!mouth && Math.abs((mouth.left + mouth.right) / 2 - cupX) < 1.5,
          `${tag} → the cup is centred (${mouth ? Math.round((mouth.left + mouth.right) / 2 - cupX) : '?'}px off)`,
        );
        say(
          !!mouth && Math.abs((mouth.top + mouth.bottom) / 2 - cupY) < 1.5,
          `${tag} → and sits where the shot is judged (${mouth ? Math.round((mouth.top + mouth.bottom) / 2 - cupY) : '?'}px off)`,
        );
        say(
          !!mouth && Math.abs(mouth.width / 2 - mouthR) < 2.5,
          `${tag} → the drawn mouth IS the judged mouth (${mouth ? (mouth.width / 2).toFixed(1) : '?'} vs ${mouthR.toFixed(1)}px)`,
        );
        say(!!svg && svg.top >= tr.top - 1 && svg.bottom <= tr.bottom + 1, `${tag} → the whole cup fits on the table`);
        say(!!svg && !!ball && svg.bottom < ball.top + 1, `${tag} → the cup stands clear of the resting ball`);
        say(
          !!ball && Math.abs((ball.top + ball.bottom) / 2 - (tr.top + tr.height * BALL_Y)) < 1.5,
          `${tag} → the ball rests under the thumb`,
        );
        say(!!ball && ball.width >= 16 && ball.width <= 30, `${tag} → the ball is ${ball ? ball.width.toFixed(0) : '?'}px`);

        if (tag.includes('two misses')) {
          const mercy = r(q('.bc-mercy'));
          say(!!mercy, `${tag} → the mouth has quietly grown`);
          say(!!mercy && mercy.width > mouthR * 2, `${tag} → and it is drawn bigger than the plain mouth`);
        }
      });

      lines.push(fails === 0 ? 'LAYOUT OK' : `LAYOUT ${fails} FAILED`);
      return lines.join('\n');
    };
    (window as unknown as { __probe?: () => string }).__probe = measure;
    const id = window.setTimeout(() => {
      const pre = document.createElement('pre');
      pre.id = 'report';
      pre.textContent = measure();
      document.body.prepend(pre);
    }, 400);
    return () => window.clearTimeout(id);
  }, []);
  return null;
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
