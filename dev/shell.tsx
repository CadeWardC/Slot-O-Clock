/**
 * Dev-only shell preview — the screens around the games, with a mocked room.
 *
 *   /Slot-O-Clock/dev/shell.html?screen=home|lobby|claim|intro|outcome|intro-anim
 *   &host=0 to see a guest's phone, &mode=shared for the one-phone room.
 *
 * Nothing here talks to Firebase: the app context is a stub whose actions do
 * nothing. Not part of the production build.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { AppStateContext, type AppStateValue } from '../src/state/AppState';
import { Home } from '../src/screens/Home';
import { Lobby } from '../src/screens/Lobby';
import { GameScreen } from '../src/screens/GameScreen';
import { SlotIntro } from '../src/components/SlotIntro';
import { allGames } from '../src/games';
import type { PlayerInfo, RoomMode } from '../src/engine/types';
import type { RoomData } from '../src/types';

import.meta.glob('../src/games/*/styles.css', { eager: true });

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'home';
const mode = (q.get('mode') === 'shared' ? 'shared' : 'party') as RoomMode;
const isHost = q.get('host') !== '0';
const now = Date.now();

const NAMES = ['Cade', 'Riley', 'Sam', 'Jordan', 'Alex'];
const EMOJI = ['🦊', '🐸', '🦄', '🐙', '🦖'];
const players: Record<string, PlayerInfo> = Object.fromEntries(
  NAMES.map((name, i) => [
    `p${i}`,
    {
      uid: `p${i}`,
      name,
      emoji: EMOJI[i],
      isHost: i === 0,
      connected: true,
      connections: { tab: { at: now } },
      local: mode === 'shared',
      drinkCount: [7, 3, 11, 0, 5][i],
      score: 0,
      joinedAt: i,
    },
  ]),
);
const uids = Object.keys(players);
const meUid = isHost ? 'p0' : 'p1';
const phase = screen === 'lobby' || screen === 'home' ? 'lobby' : (screen as 'claim' | 'intro' | 'outcome');
const game = allGames.find((g) => g.id === (q.get('game') ?? 'horse-race')) ?? allGames[0];

const room: RoomData = {
  meta: {
    code: 'BREW',
    createdAt: now,
    ownerUid: 'p0',
    mode,
    protocol: 2,
    settings: {
      mode,
      pointsMode: false,
      sipMultiplier: 1,
      enabledGames: allGames.map((g) => g.id).filter((_, i) => i !== 2),
      roundPacing: 'ready',
    },
  },
  players,
  engine: {
    protov: 2,
    lease: { uid: 'p0', instanceId: 'tab', generation: 1, renewedAt: now },
    rev: 1,
    phase,
    round: 3,
    roundId: 'r3',
    phaseId: 'ph',
    stageKey: 'r3:ph',
    rotation: [game.id],
    gameIndex: 0,
    turnOrder: screen === 'claim' ? ['p2', 'p0'] : uids,
    actorUid: 'p0',
    roundUids: uids,
    forceNext: false,
    outcome:
      phase === 'outcome'
        ? {
            gameId: game.id,
            gameName: game.name,
            gameEmoji: game.emoji,
            assignments: [
              { uid: 'p2', sips: 3, reason: 'backed the last horse home' },
              { uid: 'p4', sips: 1, reason: 'second worst pick' },
              { uid: 'p1', sips: 1, reason: 'a gift from Cade' },
            ],
            note: 'Thunderbolt won by a nose',
            recap: {
              title: 'Who backed what',
              groups: [
                { label: '🏆 Backed the winner', tone: 'good', uids: ['p0'] },
                { label: '💀 Backed the loser', tone: 'bad', uids: ['p2', 'p4'] },
              ],
            },
          }
        : null,
    gate:
      phase === 'intro' || phase === 'outcome'
        ? { id: 'g1', kind: phase, uids, openedAt: now }
        : null,
    ready: { p2: 'g1', p3: 'g1' },
    claims: {},
    game: null,
    awards: {
      scores: {},
      drinks: Object.fromEntries(uids.map((u) => [u, players[u].drinkCount])),
    },
    recovery: null,
    fault: null,
    log: [],
  },
};

const noop = async () => {};
const value: AppStateValue = {
  uid: meUid,
  authReady: true,
  room: screen === 'home' ? null : room,
  roomLoaded: true,
  session: screen === 'home' ? null : { code: 'BREW', uid: meUid },
  profile: { name: 'Cade', emoji: '🦊' },
  notice: null,
  notify: () => {},
  isAuthority: isHost,
  me: players[meUid],
  inputStatus: () => 'idle' as never,
  createRoom: noop,
  joinRoom: noop,
  addLocalPlayer: noop,
  removePlayer: noop,
  leaveRoom: noop,
  renameMe: noop,
  claimTurn: noop,
  submitInput: noop,
  setReady: noop,
  updateSettings: noop,
  startGame: noop,
  hostSkipRound: noop,
  engineCommand: () => {},
  endGame: noop,
  resetDrinks: noop,
  takeOverHost: noop,
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStateContext.Provider value={value}>
      {screen === 'intro-anim' ? (
        <SlotIntro onDone={() => {}} />
      ) : screen === 'home' ? (
        <Home />
      ) : screen === 'lobby' ? (
        <Lobby />
      ) : (
        <GameScreen />
      )}
    </AppStateContext.Provider>
  </StrictMode>,
);
