# 🎰 Slot-O-Clock

A multiplayer **drinking-minigame party game** for phones. One player creates a room, friends join with a 4-letter code, and everyone plays together in real time — every phone shows the identical game, synced over Firebase Realtime Database (a persistent WebSocket per client).

- **Turn order is claimed, not assigned — once**: when the game starts, every phone shows **"I'LL START"** — first tap takes spot 1. Then the remaining phones get **"I'M NEXT"** and each tap fills the next spot. Once everyone has a spot the order is locked for the **whole session**, and every round cycles through it automatically (the host can also lock the order early).
- **Every round waits for Ready**: the rules splash and the outcome screen both park until **every** player taps Ready — nothing rolls into the next game on its own, and nobody starts playing a game they haven't read the rules for. (The host can switch to host-paced rounds in the lobby, or push a stuck round through.)
- **Two ways to play** (pick a button when creating the room):
  - 📱 **Party mode** — everyone joins on their own phone.
  - 🤝 **Shared phone** — one phone, players added by name, passed around with "pass the phone to…" gates.
- **Games are plugins.** Adding a new minigame = creating one folder. See [Adding a new game](#adding-a-new-game).

## Games included

| Game | Emoji | How it works |
|---|---|---|
| Slot Machine | 🎰 | Everyone spins their own machine at the same time. 💀💀💀 and you finish your drink, a pair costs 2, no match costs 1 — any other triple keeps you safe (🎰 wild). Shared phone: only the actor spins. The reels then hold still for 10 seconds so everyone can actually read what they got before the round closes. |
| Reaction Duel | ⚡ | Wait for green, tap fast. **Every phone times its own finger**: the host publishes the instant green lights up, each device starts its own stopwatch on the frame green appears, and only the measured milliseconds are sent — lag and slow Wi-Fi can't cost anyone time. Early taps drink 2, slowest finger drinks 2. |
| Trivia | 🧠 | Everyone answers on their phone. Wrong answers drink, fastest correct scores. Question packs organized by topic. |
| Never Have I Ever | 🙈 | A prompt appears, everyone votes — guilty side, innocent side, or the brave minority drinks (rule rotates). The reveal and the drinks screen both show a **colour-coded breakdown of who picked guilty and who picked not me**, so the table can see it before anyone moves on. |
| Categories | 🗂️ | Name 4 things in the category while the group stacks drinks: a +1 drink button jumps player to player. Done = drink what stacked, give up = stacked +2. |
| Poisoning the Drinks | ☠️ | One player is picked at random to drink. Everyone else secretly poisons ONE of the cups — there's one more cup than there are players, poisoners **can** pile onto the same cup, and nobody sees anyone else's pick. The phone goes round the table one pourer at a time, everyone locks in, and the drinker picks last: poisoned cup → the drinker drinks 2; clean cup → every poisoner who poured drinks 1 instead. |
| Fake It Till You Make It | 🕵️ | One player **never gets the prompt** — their card just says BLEND IN and tells them the move: fingers 🖐, a point 👉 or a raised hand ✋. Everyone else reads the prompt privately, then the phones show a 10-second countdown and *nothing else*: the whole table makes the move with their body at zero and nothing is tapped in the app. The prompt goes public right after (faker included) and the table argues it out. Then the ballot: votes are **public and live**, switchable until the last one lands, and an accusation needs every clean vote on the same player — one doubter and the faker walks (the faker's own ballot is a decoy that never counts). The group sees the ballots but never the verdict, because unanimity would give the faker away: all three rounds (3 sips for the faker on every round you nail, 1 each for you on every round you don't) settle on the final unmask. |
| Horse Race | 🏇 | Everyone bets on a horse from the field, then a server-synced ~8 second race plays out identically on every phone. Back the winner and you hand out a drink to anyone you like; back the worst-placed horse anyone picked and you drink 3, the next-worst costs 1. If nobody backed the winner, everyone drinks 1. |
| Wavelength | 🎚️ | The turn actor sees a hidden target on a 0-100 spectrum and gives a clue out loud; everyone else dials where they think it lands. Nothing is on a clock: the clue-giver takes as long as they like and taps ready, and the dials lock in whenever each player is set. Furthest guess drinks 2, closest scores — and if the group's average is miles off, the clue-giver drinks 2 instead. |
| Anonymous Confessions | 🤫 | Everyone answers a juicy prompt anonymously, the confessions appear with no names on them, and one card goes on trial: who wrote it? A caught author drinks 2; fool the whole group and everyone else drinks 1. Two prompts per game. |

## Setup (one-time, ~5 minutes)

The app is static (GitHub Pages) but syncs through Firebase RTDB:

1. **Create the project** — [console.firebase.google.com](https://console.firebase.google.com) → *Add project* (any name, Analytics optional).
2. **Realtime Database** — Build → Realtime Database → *Create database* → **Start in locked mode**. Copy its URL (`https://<project>-default-rtdb.firebaseio.com`).
3. **Paste the rules** — In RTDB → **Rules** tab, replace everything with the contents of [`database.rules.json`](./database.rules.json) → **Publish**.
4. **Anonymous auth** — Build → Authentication → *Get started* → Sign-in method → enable **Anonymous**.
5. **Authorize your domain** — Authentication → Settings → **Authorized domains** → *Add domain* → `<your-user>.github.io` (and keep `localhost` for dev).
6. **Paste your config** — Project settings → Your apps → **`</>`** (web app) → copy the `firebaseConfig` values into [`src/firebase-config.ts`](./src/firebase-config.ts).

> The web config is **public by design** — it identifies the project, it doesn't grant access. Access is enforced by the rules + anonymous auth above.

## Run locally

```bash
npm install
npm run dev
```

Open the shown URL in two browser tabs (or two devices on your LAN with `npm run dev -- --host`) to test multiplayer. To develop without a live Firebase project: `npx firebase emulators:start --only database,auth` then `VITE_USE_EMULATOR=1 npm run dev`.

## Deploy to GitHub Pages

1. Push this repo to GitHub as **`Slot-O-Clock`** (the Vite `base` in `vite.config.ts` matches the repo name — change both if you rename).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Push to `main` — the [workflow](./.github/workflows/deploy.yml) builds and deploys. Your game is live at `https://<your-user>.github.io/Slot-O-Clock/`.

## How it works

```
phones ⇄ WebSocket ⇄ Firebase RTDB (rooms/{CODE}) ⇄ WebSocket ⇄ phones
                    ▲
        the host phone runs the authoritative game loop
```

- **Host = the server.** GitHub Pages can't run one, so the room owner's client owns all phase transitions and runs every game's `reduce()` — players only write their own inputs, enforced by database rules.
- **Data model** — `rooms/{CODE}/meta` (phase machine), `players/{uid}` (plus the between-round `ready` flag), `turnClaim/{round}` (first-write-wins claim), `game/{state, timerEndsAt, inputs}`, `events` (the drink feed).
- **Turn claiming** — the opening ceremony is a sequence of first-write-wins RTDB transactions: the first "I'LL START"/"I'M NEXT" write per slot wins, everyone else's is aborted by the rules. The resulting `turnOrder` drives every round's actor (`turnOrder[(round - 1) % length]`) with no further claiming.
- **Ready gate** — it guards two moments: the rules splash (the host loop won't even `createInitialState` until the table is ready) and the outcome screen. Entering either one clears every player's `ready` flag in the *same* write that flips the phase, so a stale flag can never skip the wait. Play starts on the last Ready tap (`settings.roundPacing: 'ready'`, the default) or on the host's Continue (`'manual'`). Disconnected players never block it.
- **Fair timers** — clients track `.info/serverTimeOffset`, so countdowns line up across phones. Reaction Duel goes one step further: the host publishes the server-time *instant* green lights up (`goAt`, a moment in the future), each device waits for that instant locally and starts its own `performance.now()` stopwatch on the frame green renders, then sends only the measured `reactionMs`. The score is a device-local measurement, so neither the delay in learning about green nor the delay in sending the tap touches anybody's time.
- **Round recap** — a game's `END` effect can carry an optional `recap`: colour-coded groups of uids (e.g. Never Have I Ever's guilty vs not-me split) that the outcome screen renders above the drink list, which is where the table decides when to move on.
- **Resilience** — presence via `onDisconnect`; a reloaded or backgrounded host self-heals (timers and phases are checked against server-time deadlines); another player can take over hosting if the owner leaves.

## Adding a new game

> `npm run new-game -- "Beer Pong Roulette"` scaffolds everything below as a working template.

A game is **one folder** in `src/games/` — auto-discovered at build time, no registration, no engine changes:

```
src/games/MyGame/
  definition.ts   ← metadata + host logic (createInitialState + reduce)
  View.tsx        ← what every phone renders
```

`definition.ts` implements the [`GameDefinition`](./src/engine/types.ts) contract:

```ts
export const definition: GameDefinition<MyState, MyInput> = {
  id: 'my-game',              // unique, kebab-case
  name: 'My Game',
  emoji: '🏓',
  rules: 'Shown on the intro splash.',
  minPlayers: 2,

  createInitialState(ctx) {          // runs on the host only
    return { phase: 'ready' };
  },

  reduce(state, event, ctx) {        // pure — runs on the host only
    if (event.type === 'INPUT') {
      return {
        state: { ...state, phase: 'done' },
        effects: [
          { type: 'TIMER', ms: 3000 },                              // ask for a TIME_UP
          { type: 'DRINKS', assignments: [{ uid: event.uid, sips: 1, reason: 'Lost 🏓' }] },
          { type: 'SCORE', uid: ctx.actorUid!, delta: 1 },
          { type: 'END', assignments: [...], note: 'GG!' },         // finish the round
          // ...or hand the outcome screen a colour-coded breakdown:
          // { type: 'END', recap: { title: 'who picked what', groups: [
          //   { label: '🙋 Guilty — drinks', tone: 'bad', uids: [...] } ] } }
        ],
      };
    }
    if (event.type === 'TIME_UP' || event.type === 'BEGIN') { /* ... */ }
    return { state };
  },

  View,                              // rendered identically on every phone
};
export default definition;
```

**You write only the game.** The engine gives every game: turn claiming (I'll Start / I'm Next), the rules splash with its ready gate, input routing (`submitInput` → your reducer), server-fair timers, drink assignment + outcome screens (including the optional colour-coded `recap`), scoreboard, event feed, and shared-phone pass-around gating.

`GameViewProps` (what your `View` receives): `state`, `me`, `players`, `actorUid`/`isActor`, `isAuthority`, `myInput` (already submitted?), `answeredUids`, `timerEndsAt`, `submitInput`, `variant` (`'party' | 'shared'`).

`definition.ts` can also declare `sharedHolderUid(state)` when the game has a turn order of its own: it names the player the shared phone is handed to next, instead of the engine's default "next player in join order" ([Poison](./src/games/Poison/definition.ts) passes it pourer to pourer, then to the victim).

Study [`src/games/_template/`](./src/games/_template/definition.ts) (a complete coin-flip game, ~60 lines) or the real games for patterns: actor-driven ([Slots](./src/games/Slots/definition.ts)), timing-critical ([Reaction](./src/games/Reaction/definition.ts)), everyone-answers ([Trivia](./src/games/Trivia/definition.ts)), voting ([Prompts](./src/games/Prompts/definition.ts)), precomputed-plus-animation ([HorseRace](./src/games/HorseRace/definition.ts)), hidden-target ([Wavelength](./src/games/Wavelength/definition.ts)), and free-text anonymity ([Confessions](./src/games/Confessions/definition.ts)).

### Content packs

Trivia questions and prompts are plain JSON in [`src/content/`](./src/content/) — extend or replace them freely. [`spectrums.json`](./src/content/spectrums.json) feeds Wavelength and [`confessions.json`](./src/content/confessions.json) feeds Anonymous Confessions.

## House rules & notes

- 🧊 **Sober mode** in lobby settings counts *points* instead of sips.
- ⏸ **Ready checks**: the rules splash and every outcome screen park until *all* players tap Ready, or the host switches to *host* mode and taps Continue themselves.
- ⚖️ **Drink intensity**: light (×0.5) / normal / wild (×2).
- The room dies with its host ("end game"), and rooms auto-expire after ~12h via rules.
- 🍻 Know your limits — this is for fun with friends. Play responsibly.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Firebase not configured" screen | Paste your config into `src/firebase-config.ts` ([Setup](#setup-one-time-5-minutes)). |
| Sign-in fails on the Pages URL | Add `<your-user>.github.io` to Authentication → Authorized domains. |
| `permission_denied` in console | Publish the rules from `database.rules.json` (step 3). |
| Blank page on Pages, fine locally | Repo name ≠ `Slot-O-Clock` → fix `base` in `vite.config.ts`. |
| Host phone locked / game frozen | Hosts should keep the screen on; any player can also take over hosting from the lobby. |
