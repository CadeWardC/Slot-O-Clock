import { shortId } from './protocol';

/**
 * One id per browser *tab*, kept for the life of that tab (sessionStorage
 * survives a reload, but two tabs never share it).
 *
 * It is what makes "one authority" true: a host lease is scoped to
 * `(uid, instanceId)`, so a second tab signed in as the same player is a
 * viewer, while a reloaded host tab walks back into its own lease.
 */
const KEY = 'soc.instance';

let memoryId: string | null = null;

export function tabInstanceId(): string {
  if (memoryId) return memoryId;
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) {
      memoryId = existing;
      return existing;
    }
    const id = shortId();
    sessionStorage.setItem(KEY, id);
    memoryId = id;
    return id;
  } catch {
    // private mode / storage disabled: still one id per page load
    memoryId = shortId();
    return memoryId;
  }
}
