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
import { Awards } from '../src/screens/Awards';
import { Reactions } from '../src/components/Reactions';
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
const phase =
  screen === 'lobby' || screen === 'home'
    ? 'lobby'
    : screen === 'awards'
      ? 'ended'
      : (screen as 'claim' | 'intro' | 'outcome');
/** &party=1 turns on the between-games extras: wild card, the spot, a throw */
const party = q.get('party') === '1' || screen === 'awards';
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
            roast: 'Sam put 3 on Pony Danza. Pony Danza did not share the confidence.',
            wild: party ? { title: 'Double or nothing', did: 'Everything doubled.' } : null,
            spotUid: party ? 'p2' : null,
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
    wild:
      party && phase === 'intro'
        ? { id: 'robin', title: 'Robin Hood', effect: 'robin', uid: 'p2', toUid: 'p3', text: "Sam has drunk the most, Jordan the least. This game, Sam's drinks go to Jordan." }
        : null,
    spot: party && phase === 'intro' ? { uid: 'p3', picked: true } : null,
    next: party && phase === 'outcome' ? { pickerUid: isHost ? 'p0' : 'p3' } : null,
    stats: {
      rounds: 9,
      lastSpotRound: 0,
      lastWild: null,
      players: {
        p0: { rounds: 9, drankRounds: 5, drinkRun: 0, bestDrinkRun: 2, safeRun: 2, bestSafeRun: 3, biggest: 3, biggestGame: 'Slot Machine', given: 9 },
        p1: { rounds: 9, drankRounds: 2, drinkRun: 0, bestDrinkRun: 1, safeRun: 4, bestSafeRun: 5, biggest: 2, biggestGame: 'Trivia', given: 1 },
        p2: { rounds: 9, drankRounds: 7, drinkRun: 4, bestDrinkRun: 4, safeRun: 0, bestSafeRun: 1, biggest: 6, biggestGame: 'Horse Race', given: 2 },
        p3: { rounds: 9, drankRounds: 0, drinkRun: 0, bestDrinkRun: 0, safeRun: 9, bestSafeRun: 9, biggest: 0, biggestGame: '', given: 0 },
        p4: { rounds: 9, drankRounds: 3, drinkRun: 1, bestDrinkRun: 2, safeRun: 0, bestSafeRun: 3, biggest: 3, biggestGame: 'Chicken', given: 0 },
      },
      pairs: { p0: { p2: 7, p4: 2 }, p2: { p0: 2 }, p1: { p2: 1 } },
    },
  },
  social: null,
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
  throwAt: noop,
  pickNextGame: noop,
  finishNight: () => {},
  reopenRoom: () => {},
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
      ) : screen === 'awards' ? (
        <Awards />
      ) : (
        <GameScreen />
      )}
      <Reactions />
    </AppStateContext.Provider>
  </StrictMode>,
);
