# Firebase security

Publish `database.rules.json` to **Realtime Database → Rules**. These are
Realtime Database rules, not Firestore rules. Local edits do not change the
live database. Deploy the matching app build as well.

The rules reject unauthenticated access, global room/index listing, changing
another user's seat, self-awarded scores, forged input identities, non-member
inputs, owner changes, arbitrary index entries, and overwriting expired rooms.
The owner and current host can end a room; other users can only delete it after
expiry. Host takeover requires membership and an expired lease or disconnected
host. Creation validates the owner and initial engine in the same atomic write.
Parent write grants cannot bypass the score or lease identity restrictions.
Player profiles, settings, and submitted input fields have schema validation.

## Enable App Check

The app includes optional reCAPTCHA Enterprise App Check support. It remains
inactive until a site key is configured; adding the code alone does not enforce
App Check on the database.

1. Follow [Firebase's web App Check setup](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
   to register a score-based reCAPTCHA Enterprise key for the deployed domain
   and register the web app in Firebase App Check.
2. For GitHub Pages, add the repository **Actions variable**
   `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` with that public site key. For a local
   production build, put the same variable in `.env.local`.
3. Deploy the updated app. Verify successful App Check requests in Firebase.
   Then enable **Realtime Database enforcement** in the App Check console.
   Test fresh room creation, joining, and gameplay on actual phones.

Never put service-account private keys, admin credentials, or App Check debug
tokens in frontend code or the repository. Firebase web config/API keys identify
the project and are public by design; security depends on rules and enforcement.
See the [Firebase security checklist](https://firebase.google.com/support/guides/security-checklist).

## Remaining trust and abuse limits

- Anyone can obtain anonymous authentication. A signed-in person who knows or
  guesses a four-character room code can read that room and join it. Codes are
  invitations, not strong secrets; do not store sensitive information in rooms.
  Room data, including game state, is readable by these clients even if the UI
  hides part of it.
- The browser holding the host lease is trusted to run the game and write its
  state. App Check reduces unauthorized-client abuse but does not guarantee
  protection against cheating, automated sign-ups, repeated valid writes, or
  denial of service. Stronger protection requires a trusted backend with
  membership/invite enforcement, request rate limits, and server-run gameplay.
- Room/index enumeration is disabled. Cleanup checks only a remembered room or
  a code encountered while creating/joining. Expired rooms nobody revisits remain
  stored; use a scheduled trusted backend for complete cleanup. Player and engine
  writes are rejected after expiry; the owner/host may update settings or renew
  the expiry.
- Configure usage/billing alerts and review project IAM access, Authentication
  settings, and rules for any other Firebase services you enable. Budget alerts
  notify you; they do not impose a spending cap. Those console settings have
  not been audited or changed by this code update.

## Verify rules locally

With Java and Node installed, start a disposable local emulator:

```sh
npx firebase-tools emulators:start --only database --project demo-slot-o-clock-rules
```

In another terminal:

```sh
npm run test:rules
```

The test script compiles the real rules, resets only the local
`demo-slot-o-clock-rules` namespace on `127.0.0.1:9000`, and exercises allowed
game flows and denied attacks using separate authenticated clients. It never
uses production credentials. Also run `npm test` and `npm run build`.

When adding a game with new input fields, extend the input schema in the rules
and add emulator checks for those fields before publishing the game.
