# 🎰 Slot-O-Clock

A multiplayer **drinking-minigame party game** for phones. One player creates a room, friends join with a 4-letter code, and everyone plays together in real time — every phone shows the identical game, synced over Firebase Realtime Database (a persistent WebSocket per client).

- **Turn order is claimed, not assigned — once**: when the game starts, every phone shows **"I'LL START"** — first tap takes spot 1. Then the remaining phones get **"I'M NEXT"** and each tap fills the next spot. Once everyone has a spot the order is locked for the **whole session**, and every round cycles through it automatically (the host can also lock the order early).
- **Every round waits for Ready**: the rules splash and the outcome screen both park until **every** player taps Ready — nothing rolls into the next game on its own, and nobody starts playing a game they haven't read the rules for. (The host can switch to host-paced rounds in the lobby, or push a stuck round through.)
- **Two ways to play** (pick a button when creating the room):
  - 📱 **Party mode** — everyone joins on their own phone.
  - 🤝 **Shared phone** — one phone, players added by name, passed around with "pass the phone to…" gates.
- **A dark screen is not a departure.** Lock your phone, walk into a tunnel, let the screen time out — your seat, your drinks and your turn are all still there, and the round doesn't wait on you while you're gone. Closing the site (or tapping *leave room*) is a departure: the room drops your seat right away, and if you open the site again you walk back in and play from the next game.
- **You can join mid-match.** New phones can walk in halfway through a round: they're in the room immediately, and instead of being dropped into a game already in progress they play the next minigame (and get a slot in the turn order).
- **Games are plugins.** Adding a new minigame = creating one folder. See [Adding a new game](#adding-a-new-game).

## Games included

| Game | Emoji | How it works |
|---|---|---|
| Slot Machine | 🎰 | Everyone pulls their own lever and gets their own reels. Three skulls and you finish your drink, a pair costs 2, no match costs 1. Any other triple is safe, and 🎰 is wild. The reels hold for 10 seconds so the table can read them. Shared phone: only the actor spins. A safe triple hands out 2, three 🎰 hands out 4. |
| Reaction Duel | ⚡ | Wait for green, then tap. Every phone times its own finger, so lag costs nobody anything. Tap before green and you are disqualified and drink 3. If nobody jumps, the slowest finger drinks 2, and so does anyone who never tapped. The fastest finger hands out 2. |
| Trivia | 🧠 | Five questions, everyone answers on their own phone, scores after each. Most right hands out the drinks and fewest right takes them, one sip for every question between you, up to 5. Ties share. A dead heat drinks nothing. |
| Never Have I Ever | 🙈 | A prompt comes up and everyone answers honestly: have or never. A sticker says which side drinks this time (the guilty, the innocent, or whoever is outnumbered), and it changes every round. The reveal shows who said what. |
| Categories | 🗂️ | Name 4 things in the category, out loud. You get 3 seconds to think with the +1 drink button locked. Then it goes round the table and stacks drinks on you, with a 2.5 second recharge between taps. Say done and drink the stack, or give up and drink the stack plus 2. Finish before anything stacks and you hand out 2. |
| Poisoning the Drinks | ☠️ | One player drinks. Everyone else secretly poisons one cup in a ring that has one more cup than players. The drinker's hand shows on every phone, they get one sniff (how many doses are in that cup and its two neighbours), and the poisoners can pull faces at them. A poisoned cup costs the drinker 2, plus 1 for each extra poisoner in it. A clean cup costs every poisoner 1. One cup is a hidden antidote that sends the poison back at whoever poured it. Party mode pours all at once; a shared phone goes poisoner to poisoner. |
| Fake It Till You Make It | 🕵️ | One player never gets the prompt, only the move: fingers, a point or a raised hand. Everyone else reads the prompt, then the phones count down 5 seconds and the whole table makes the move at zero. The prompt goes public and the table argues. Then the vote, with no timer: pick a suspect and lock in. If everyone but the accused names the same player (players minus one), that player is convicted. Convict the faker and they are caught on the spot, drink 3, and the game ends. Otherwise the faker got away with that round and the game goes on, up to 3 rounds, with everyone else owing a drink per getaway at the end. |
| Horse Race | 🏇 | Back a horse and say how many drinks you're putting on it, 1 to 10. The field runs one lap of the oval, about 20 seconds, identical on every phone, with the lead changing hands at least four times and the winner only getting up in the home straight. Pick the winner and you hand out your stake, split between anyone you like. Pick anything else and you drink your stake, plus 1 more if yours was the worst pick at the table. |
| Wavelength | 🎚️ | One player sees a hidden number on a scale and gives a clue out loud. Everyone else guesses where it sits. Furthest guess drinks 2, unless the whole table is miles off, in which case the clue-giver drinks 2. No timer. Closest guess hands out 1, or 2 if dead on. |
| Anonymous Confessions | 🤫 | Everyone answers the same prompt with no name on it. One answer goes on trial and the table votes on who wrote it. A caught author drinks 2; a wrong table drinks 1 each. After two prompts every card gets its name back, and whoever drank least hands out a drink. |
| Boom Cup | 💥 | Two cups go round the table, starting as far apart as the seating allows. Every phone shows the table from above with who sits where, where the yellow and pink cups are, who is one sink from being caught, and the beers left in the middle. Flick up to shoot. There is no power meter or aim guide, and the cup's mouth widens a little with every miss. Sink it and the cup moves to the next player. Sink it first try and you give it to anyone. If a cup lands on someone still holding the other one, they are caught and drink a beer from the middle, and the cup carries on past them. The middle holds one beer per player (3 to 6), and whoever takes the last one drinks 2 more. In party mode both shooters play at once. On a shared phone they take turns. |
| Chicken | 🐔 | Everyone holds a thumb on the button while a drink counter climbs from 0 to 10. Let go and you bank what it says, to hand out to anyone you like. It busts at a random moment, and whoever is still holding drinks the counter. If you are the last thumb left, you win the counter plus 2. Shared phone: the turn player plays alone. |
| Sketchy | ✏️ | One player picks one of three words and draws it with a finger. Everyone else types guesses, and the wrong ones show up for the whole table to see. Miss it and you drink 1. If nobody gets it, the artist drinks 2. On a shared phone the table shouts its guesses and the artist says whether anyone got it. First to get it hands out 1. |
| Most Likely To | 👉 | Three prompts like "most likely to text their ex before the night is over". Everyone secretly names a player, yourself included, and the votes turn over together. Whoever gets the most drinks one per vote, up to 4, and a tie drinks together. |
| Know Me | 🫵 | One player sits in the hot seat for four this-or-that questions about themselves. They answer for real while everyone else guesses what they will say, then the answer is shown and the table gets to ask why. Know them least and you drink; know them best and you hand out 2. If nobody sees an answer coming, the hot seat drinks. |

## Between the games

- **The line on the drinks screen.** Every game ends with one dry sentence about what just happened ("Sam put 6 on Pony Danza. Pony Danza did not share the confidence."). Games report their own moments as `highlights` on the `END` effect; [`engine/roast.ts`](./src/engine/roast.ts) owns the wording and falls back to streaks and the shape of the round.
- **Wild cards.** Every third game a card is turned before the rules: double or nothing, happy hour, a drinking buddy, Robin Hood, a night off for the tab leader, a round on the house, or a table rule the players police themselves (wrong hand, no names).
- **On the spot.** When one player is clearly behind on the tab, they pick the next game and drink double in it.
- **Winners hand out.** When a game names who did best (fastest finger, a safe triple, the closest guess, the best friend in Know Me), the engine adds a short hand-out stage before the drinks screen: they tap names to deal their drinks. A game opts in with `givers` on its `END` effect; [`engine/gifts.ts`](./src/engine/gifts.ts) runs the stage.
- **Throwing things.** On the drinks screen, tap a player and throw a tomato, an egg, a slow clap or a rose. It lands on their phone.
- **Last orders.** "End the night" in the scores sheet sends every phone to the awards (the sponge, designated driver, worst single game, nemesis, and so on), worked out from the stats the engine keeps as the games go by. The host can go again from there or close the room.

Throwing and the game pick are the only things players write outside the engine, under `rooms/{code}/social`. **Re-publish [`database.rules.json`](./database.rules.json) after pulling this**, or those two features fail quietly (everything else keeps working).

## Setup (one-time, ~5 minutes)

The app is static (GitHub Pages) but syncs through Firebase RTDB:

1. **Create the project** — [console.firebase.google.com](https://console.firebase.google.com) → *Add project* (any name, Analytics optional).
2. **Realtime Database** — Build → Realtime Database → *Create database* → **Start in locked mode**. Copy its URL (`https://<project>-default-rtdb.firebaseio.com`).
3. **Paste the rules** — In RTDB → **Rules** tab, replace everything with the contents of [`database.rules.json`](./database.rules.json) → **Publish**.
4. **Anonymous auth** — Build → Authentication → *Get started* → Sign-in method → enable **Anonymous**.
5. **Authorize your domain** — Authentication → Settings → **Authorized domains** → *Add domain* → `<your-user>.github.io` (and keep `localhost` for dev).
6. **Paste your config** — Project settings → Your apps → **`</>`** (web app) → copy the `firebaseConfig` values into [`src/firebase-config.ts`](./src/firebase-config.ts).

> The web config is **public by design** — it identifies the project, it doesn't grant access. Access is enforced by the rules + anonymous auth above.

For App Check setup, permission tests, and remaining abuse risks, follow
[`FIREBASE_SECURITY.md`](./FIREBASE_SECURITY.md). Anonymous sign-in and short
room codes do not make rooms private against someone who guesses a code.

## Run locally

```bash
npm install
npm run dev
```

Open the shown URL in two browser tabs (or two devices on your LAN with `npm run dev -- --host`) to test multiplayer. To develop without a live Firebase project: `npx firebase emulators:start --only database,auth` then `VITE_USE_EMULATOR=1 npm run dev`.

```bash
npm test        # deterministic engine + protocol tests (no network, no emulator)
npm run typecheck
npm run build
```

> The test suite runs the source directly on Node's own TypeScript support, so
> it needs **Node 22.18+ / 24** — no build step, no test framework, no
> devDependency. CI runs it before every deploy.

### Look at a screen without a room

Two dev-only pages run under `npm run dev` with no Firebase behind them (they are not part of the production build):

- **`/Slot-O-Clock/dev/preview.html?game=slots&n=4`** — runs one game's real reducer in memory and renders its real View once per player, side by side. `mode=shared`, `me=<index>` and `seed=<n>` are also understood; `window.pv` (`input(uid, input)`, `timeUp()`, `state()`, `restart()`) drives the round from the console or a script.
- **`/Slot-O-Clock/dev/shell.html?screen=home|lobby|claim|intro|outcome`** — the screens around the games, against a mocked room (`host=0` for a guest's phone).

Each game keeps its stylesheet next to its View (`src/games/<Name>/styles.css`, loaded automatically); `src/styles.css` holds the shell and the shared "fun kit" (`.fx-title`, `.fx-panel`, `.fx-count`, `.fx-stamp`, the one-shot animations, plus `Confetti` / `BigCount` in `components/fx.tsx`).

## Deploy to GitHub Pages

1. Push this repo to GitHub as **`Slot-O-Clock`** (the Vite `base` in `vite.config.ts` matches the repo name — change both if you rename).
2. Repo → Settings → Pages → Source: **GitHub Actions**.
3. Push to `main` — the [workflow](./.github/workflows/deploy.yml) builds and deploys. Your game is live at `https://<your-user>.github.io/Slot-O-Clock/`.

> **Publish the rules first.** `database.rules.json` is part of the protocol, not
> just a perimeter: it enforces the stage stamp on submissions, the gate stamp
> on Ready, the host lease, and the fact that v1's paths (`meta/phase`,
> `game/*`, `events/*`, `turnClaim/*`) are read-only. Deploy the rules, then
> play a fresh test room before switching a real session over.

## How it works

```
phones ⇄ WebSocket ⇄ Firebase RTDB (rooms/{CODE}) ⇄ WebSocket ⇄ phones
                    ▲
        the host's tab runs the authoritative engine (one serialized worker)
```

- **Host = the server.** GitHub Pages can't run one, so one browser tab owns the
  room. That ownership is a lease (`engine/lease`), not a flag: it names the uid
  **and** the tab (`instanceId`), carries an ownership `generation`, and is only
  granted to another player by an explicit takeover (👑). A second tab signed in
  as the host is a viewer.
- **One worker, one queue.** Everything authoritative happens in
  [`state/engine.ts`](./src/state/engine.ts): snapshots, ticks, visibility
  changes, player inputs and host commands all just *ping* one serialized queue.
  Nothing else writes progress, so two transitions can never run at once, and a
  reload can't leave one running (stopping the worker invalidates its
  generation, so in-flight work dies at its next `await`).
- **Everything a decision needs has an identity.**
  - `roundId` — unique per minigame instance,
  - `phaseId` — the input epoch: a new internal phase, or a `CLEAR_INPUTS`, opens a new one,
  - `stageKey` = `roundId:phaseId` — stamped on every submission and every timer,
  - `rev` — one more with each committed engine update,
  - `timer = { id, roundId, phaseId, startsAt, endsAt, durationMs }`.
  A timeout only fires for the exact timer that is still active; a tap only
  counts in the stage it was made for; a Ready flag names the gate it answers.
- **A transition is one commit.** The engine computes the reducer result and all
  of its effects first, then commits them together in a single transaction on
  `rooms/{code}/engine` — state, timer, phase, gate, awards and the input's
  acknowledgment. The transaction checks the revision, the lease, the timer id
  and the input id it was computed from, so a plan that no longer applies is
  refused and re-derived instead of being forced onto a newer room. Clients
  therefore never see a new phase paired with the previous phase's timer.
  That subtree is deliberately small and bounded (stage-scoped inputs, a 40-entry
  log) because a room-level transaction re-sends it on every commit: if a big
  table ever shows commit latency, that number — not a hunch — is what says
  whether the authoritative data should move into a still smaller subtree.
- **Data model** — `meta` (code, mode, settings, TTL, protocol stamp),
  `players/{uid}` (seat + one `connections/{instanceId}` per open tab),
  `engine/*` (everything the host owns: `phase`, `roundId`, `phaseId`, `rev`,
  `gate`, `ready`, `claims`, `game/{state,timer,inputs}`, `awards`, `recovery`,
  `fault`, `log`, plus the party layer: `wild`, `spot`, `next`, `stats`), and `social/*` (throws and the lightweight's game pick: written by players, never trusted).
- **Seats: who's in, who's around, who plays this round** — three different questions, three answers:
  - **In the room** (`activePlayers`) — everyone who hasn't *left*. A phone whose screen went dark keeps its seat; only closing the site (`pagehide` → `players/{uid}/left`, see `state/AppState.tsx`) or tapping *leave room* hands it back. A returning phone clears the flag on its first heartbeat.
  - **Around right now** (`livePlayers`) — presence is derived from the per-tab `connections` children, so a second tab closing (or a browser unloading one page to reclaim memory) can never mark a player who is still there as gone.
  - **Playing this round** (`roundPlayers`) — the roster the engine snapshotted into `engine.roundUids` when it launched the round. It stays fixed for the whole round, so a phone that dies mid-round is still in the game its friends are playing, and somebody who joins mid-round plays from the *next* minigame instead of landing in one already under way.
- **Turn claiming** — the opening ceremony is a sequence of first-write-wins transactions on `engine/claims/{slot}`; the engine folds them into the turn order and opens round 1. No claiming between rounds.
- **Ready gate** — it guards two moments: the rules splash and the outcome screen. The gate is an engine object that **snapshots the players it needs when it opens**, so a disconnect can never quietly shrink the list. A required phone that drops shows as *reconnecting* and keeps holding the gate for a grace period (25 s); past that it stops counting, and the host always has the explicit *continue without them*. **A gate nobody is holding is never a green light** — an empty table cannot release itself. Acknowledging writes `engine/ready/{uid} = gateId`, so a `true` from a previous gate can never release the next one.
- **Inputs** — a submission is a node at `engine/game/inputs/{inputId}` (the id is
  the key, so a retry can only ever apply once) carrying `roundId`, `phaseId` and
  `stageKey`. The engine validates round, phase, roster membership and
  shared-phone impersonation before dispatching, refuses stale ones *visibly*
  (`rejected: 'stale-phase'`), and writes the acknowledgment in the same commit
  as the reducer result — which is also what makes recovery exact: after a reload
  or a takeover, "pending" simply means "in the room without an ack". Storage is
  stage-scoped instead of being wiped, so the phone can tell *sending* from
  *accepted*, and the database rules reject a submission whose `stageKey` is not
  the room's current one.
- **Fair timers** — clients track `.info/serverTimeOffset`, so countdowns line up across phones. A deadline that came due while the host was away for more than 10 s does **not** roll quietly into the next phase: the room pauses with a visible recovery record and the host's Resume re-times that activity from scratch. A viewer never draws a deadline that belongs to another stage (`activeTimer`). Reaction Duel still measures the tap on the device itself.
- **Round recap** — a game's `END` effect can carry an optional `recap`: colour-coded groups of uids that the outcome screen renders above the drink list. Its drink assignments land in the ledger in the same commit as the outcome.
- **Scores and drinks** — `engine/awards` is the authoritative ledger, written only inside revision-checked transactions as *absolute* totals, so a retried commit can never double-award anything. `players/{uid}/drinkCount|score` are legacy mirrors; the UI reads the ledger.
- **Failures are visible** — a failed commit stops authoritative processing (in the room as `engine/fault`, and on the host's own screen if the room couldn't even be told) until the host reconciles. Engine `log` keeps the last 40 entries: transition kinds, revisions, timer ids, ownership changes, refused stale events — never anybody's private answer.
- **Protocol version** — rooms carry `meta.protocol`. A client that doesn't understand it refuses to drive the room and shows *Different version*; the rules make v1's progress paths unwritable, so an old client cannot corrupt or advance a new room. Rooms are not upgraded in place: start a fresh one (fresh test rooms first).


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

**You write only the game.** The engine gives every game: turn claiming (I'll Start / I'm Next), the rules splash with its ready gate, input routing (`submitInput` → your reducer), server-fair timers, drink assignment + outcome screens (including the optional colour-coded `recap`), scoreboard, the engine log, and shared-phone pass-around gating.

`GameViewProps` (what your `View` receives): `state`, `me`, `players`, `actorUid`/`isActor`, `isAuthority`, `myInput` (already submitted?), `answeredUids`, `timerEndsAt`, `submitInput`, `variant` (`'party' | 'shared'`).

Three rules of the road that the engine relies on, worth knowing before you
write a reducer:

1. **Your phase lives in `state.phase`.** When it changes (or when you emit
   `CLEAR_INPUTS`), the engine opens a new *stage*: the old stage's submissions,
   timeouts and acknowledgments stop applying. That is what makes it safe to
   keep `state.phase` as your only notion of "where we are".
2. **`TIMER` arms the new stage's clock; no `TIMER` means no clock** for a stage
   change, and leaves the running countdown alone for a change that stays inside
   the same phase (a bet, a vote, a read card).
3. **Randomness and the clock are `ctx.rng` and `ctx.now`,** and they are read
   before your result is committed — never inside the commit. `ctx.roundId`,
   `ctx.phaseId` and `ctx.revision` identify exactly what your reducer is
   deciding about, and `TIME_UP` hands you `timerId`/`phaseId`/`roundId` if you
   want to check them yourself.

`definition.ts` can also declare `sharedHolderUid(state)` when the game has a turn order of its own: it names the player the shared phone is handed to next, instead of the engine's default "next player in join order" ([Poison](./src/games/Poison/definition.ts) passes it pourer to pourer, then to the victim).

Study [`src/games/_template/`](./src/games/_template/definition.ts) (a complete coin-flip game, ~60 lines) or the real games for patterns: actor-driven ([Slots](./src/games/Slots/definition.ts)), timing-critical ([Reaction](./src/games/Reaction/definition.ts)), everyone-answers ([Trivia](./src/games/Trivia/definition.ts)), voting ([Prompts](./src/games/Prompts/definition.ts)), precomputed-plus-animation ([HorseRace](./src/games/HorseRace/definition.ts)), hidden-target ([Wavelength](./src/games/Wavelength/definition.ts)), free-text anonymity ([Confessions](./src/games/Confessions/definition.ts)), and gesture-skill with shared deterministic physics ([Boom Cup](./src/games/BoomCup/definition.ts) — the swipe is judged by maths both the host and the shooting phone run, see its [`physics.ts`](./src/games/BoomCup/physics.ts)).

## Tests

```bash
npm test
```

The suite is deterministic and offline: no emulator, no network, no timers. It
runs the **real** engine and the **real** game definitions under Node's own
TypeScript support ([`tests-loader.mjs`](./tests-loader.mjs) supplies the
extensionless imports and stubs the React `View`s, which this layer never
renders), against an in-memory Realtime Database that keeps the two semantics
the engine depends on: a commit callback re-runs against current data instead of
clobbering it, and a multi-path write is atomic
([`tests/fakeStore.ts`](./tests/fakeStore.ts)).

| Scenario | What the suite pins down |
|---|---|
| Final answer at the deadline | exactly one transition; the next phase keeps its full timer |
| State commit delayed | no stored snapshot pairs a stage with another stage's timer |
| Host reload, before/after a deadline | the timer is processed exactly once either way |
| Host stops after an input | the outstanding submission is recovered exactly once |
| Host stops during scoring | a complete result, no duplicated awards |
| Two host tabs / a takeover | one authority; the old one cannot commit |
| Old Ready / input after a reconnect | refused for the new gate and the new phase |
| Skip while input work is queued | no writes survive from the skipped round |
| A brief disconnect at a gate | the gate holds, visibly, through the grace period |
| 30-second interruption | a visible recovery pause, never an invisible cascade |

Every one of those runs across Fake It, Horse Race, Slots and Boom Cup
([`tests/games.test.ts`](./tests/games.test.ts)), alongside the pure seat and
gate rules ([`tests/seats.test.ts`](./tests/seats.test.ts)) and the full
scenario table ([`tests/scenarios.test.ts`](./tests/scenarios.test.ts)).

What a suite like this deliberately does **not** cover: real WebSocket latency,
iOS background throttling, and the deployed database rules. Those need a
throwaway room on real phones — with screen locking, app switching and a
throttled connection — before a real session moves onto a new build.


### Content packs

Trivia questions and prompts are plain JSON in [`src/content/`](./src/content/) — extend or replace them freely. [`spectrums.json`](./src/content/spectrums.json) feeds Wavelength and [`confessions.json`](./src/content/confessions.json) feeds Anonymous Confessions.

## House rules & notes

- 🧊 **Sober mode** in lobby settings counts *points* instead of sips.
- ⏸ **Ready checks**: the rules splash and every outcome screen park until every phone the gate asked for taps Ready, or the host continues without them.
- ⚖️ **Drink intensity**: light (×0.5) / normal / wild (×2).
- The owner or current host can end a room. Rooms expire 24 hours after their last host refresh. Cleanup checks known room codes; complete abandoned-room cleanup needs a scheduled backend (see `FIREBASE_SECURITY.md`).
- 📴 **Screen off ≠ leaving.** A phone that sleeps keeps its seat, score and turn and rejoins the next round it's awake for; a phone that *closes the site* hands its seat back (and walks back in on the next game if it reopens). The host can clear seats that are gone for good from the lobby.
- 🍻 Know your limits — this is for fun with friends. Play responsibly.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Firebase not configured" screen | Paste your config into `src/firebase-config.ts` ([Setup](#setup-one-time-5-minutes)). |
| Sign-in fails on the Pages URL | Add `<your-user>.github.io` to Authentication → Authorized domains. |
| `permission_denied` in console | Publish the rules from `database.rules.json` (step 3). If it happens **when a tap lands**, that tap raced a phase change — the rules refused a submission stamped with a stage the room had already left, which is the intended behaviour. |
| Blank page on Pages, fine locally | Repo name ≠ `Slot-O-Clock` → fix `base` in `vite.config.ts`. |
| "Different version" screen | The room was started by another build of this app. Rooms are not upgraded in place — start a fresh one. |
| "The round paused" screen | The host's deadline came due while it was away for over 10s. The host taps **Resume** and that activity restarts with a fresh countdown. |
| "The game engine stopped" | A write to the room failed (usually rules or network). Nothing moves until the host taps **reconcile & resume**. |
| "⚠️ that tap didn't count" | The submission arrived after the phase it was meant for. Nothing is wrong — the engine refused it instead of replaying it into the next phase. |
| Host phone locked / game frozen | Hosts should keep the screen on; any player can take over hosting with the 👑 button in the game header (or from the lobby). A long absence now pauses the room visibly instead of skipping ahead. |
| A player shows as "left the room" when their phone only locked | Their browser unloaded the page (phones do that to reclaim memory). Reopening the site puts them straight back in, playing from the next game. |
