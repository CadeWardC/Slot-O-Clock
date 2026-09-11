import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  connectDatabaseEmulator,
  type Database,
} from 'firebase/database';
import { getAuth, connectAuthEmulator, signInAnonymously, type Auth } from 'firebase/auth';
import { firebaseConfig, isFirebaseConfigured } from './firebase-config';

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const db: Database | null = app ? getDatabase(app) : null;
export const auth: Auth | null = app ? getAuth(app) : null;

// Local development against the Firebase Emulator Suite:
//   VITE_USE_EMULATOR=1 npm run dev
// (requires: npx firebase emulators:start --only database,auth)
if (import.meta.env?.VITE_USE_EMULATOR === '1' && db && auth) {
  try {
    connectDatabaseEmulator(db, 'localhost', 9000);
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    console.info('[firebase] using local emulator suite');
  } catch {
    // already connected — hot reload guard
  }
}

/** Resolves once signed in anonymously; returns the auth uid. */
export async function ensureAuth(): Promise<string> {
  if (!auth) throw new Error('Firebase not configured');
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await signInAnonymously(auth);
  return cred.user.uid;
}
