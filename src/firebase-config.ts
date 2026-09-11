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
  apiKey: 'AIzaSyAkHGxsxle6pLyzBpxVqk-2ouTOeEuczJ0',
  authDomain: 'drunkenclam-248e6.firebaseapp.com',
  databaseURL: 'https://drunkenclam-248e6-default-rtdb.firebaseio.com',
  projectId: 'drunkenclam-248e6',
  storageBucket: 'drunkenclam-248e6.firebasestorage.app',
  messagingSenderId: '759380357175',
  appId: '1:759380357175:web:f3282959c5ec80d4f5cfb2',
  measurementId: 'G-2N0H4VGW7J',
};

export const isFirebaseConfigured =
  !firebaseConfig.apiKey.startsWith('PASTE') && !firebaseConfig.databaseURL.startsWith('PASTE');
