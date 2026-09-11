import { onValue, ref } from 'firebase/database';
import { db } from '../firebase';

let offset = 0;

/** Keeps a live estimate of the server clock so timers are fair across phones. */
export function initServerTime() {
  if (!db) return;
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    offset = typeof snap.val() === 'number' ? snap.val() : 0;
  });
}

/** Best-effort current server time in ms. */
export function serverNow(): number {
  return Date.now() + offset;
}
