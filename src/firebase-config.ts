// ============================================================
//  Firebase web app config — paste yours here (README → Setup)
// ============================================================
// These values are PUBLIC by design: the web config identifies your
// project, it does not grant access. Access is controlled by
// database.rules.json + anonymous auth, exactly like Firebase docs
// recommend for client-only apps.
//
// 1. console.firebase.google.com → your project → Project settings
// 2. Your apps → the "</>" web app → copy the firebaseConfig object
// 3. Paste the values below (databaseURL comes from
//    Realtime Database → data view, e.g.
//    https://your-project-default-rtdb.firebaseio.com)
export const firebaseConfig = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  databaseURL: 'PASTE_YOUR_RTDB_URL',
  projectId: 'PASTE_PROJECT_ID',
  appId: 'PASTE_APP_ID',
};

export const isFirebaseConfigured =
  !firebaseConfig.apiKey.startsWith('PASTE') && !firebaseConfig.databaseURL.startsWith('PASTE');
