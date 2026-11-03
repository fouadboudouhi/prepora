// A copy of the app's data on the server, in a place of its own, so a second device or a new install starts complete.
// The newest change wins. The running cook day stays on the device it runs on.
import { SessionError, call, getSession } from './session.js';
import { onChange, read, write } from './store.js';

const PATH = '/v1/apps/prepora/snapshot';
const STATE = 'sync';
const SYNCED = ['profile', 'taste', 'plan', 'history', 'stock', 'shop', 'fridge'];
const DELAY = 5000;

let timer = null;
let started = false;
let afterRestore = () => {};

const state = () => read(STATE, {});
const pack = () => ({
  app: 'Prepora',
  changedAt: state().changedAt ?? new Date().toISOString(),
  data: Object.fromEntries(SYNCED.map((name) => [name, read(name, null)])),
});
function restore(version, snapshot) {
  SYNCED.forEach((name) => write(name, snapshot?.data?.[name] ?? null, { quiet: true }));
  write(STATE, { version, changedAt: snapshot?.changedAt, dirty: false }, { quiet: true });
  afterRestore();
}

async function pull() {
  const response = await call(PATH);
  if (response.status === 404) return null;
  const version = (response.headers.get('etag') ?? '').replaceAll('"', '');
  return { version, snapshot: await response.json() };
}

async function push(version) {
  const response = await call(PATH, {
    method: 'PUT',
    body: JSON.stringify(pack()),
    headers: version ? { 'if-match': `"${version}"` } : {},
  });
  const answer = await response.json();
  write(STATE, { ...state(), version: answer.version, dirty: false }, { quiet: true });
}

export async function syncNow() {
  if (!getSession()) return;
  clearTimeout(timer);
  timer = null;
  const local = state();
  try {
    if (!local.dirty) {
      const found = await pull();
      if (found && found.version !== local.version) restore(found.version, found.snapshot);
      else if (!found && SYNCED.some((name) => read(name, null) !== null)) await push('');
      return;
    }
    await push(local.version);
  } catch (err) {
    if (!(err instanceof SessionError) || err.code !== 'newer') return;
    // Another device was faster. Whoever changed something last stays.
    const found = await pull().catch(() => null);
    if (!found) return;
    if (Date.parse(found.snapshot?.changedAt ?? 0) > Date.parse(local.changedAt ?? 0))
      restore(found.version, found.snapshot);
    else await push(found.version).catch(() => {});
  }
}

// After a sign-out the next person must not find this person's food on the device. What has not reached the server
// yet stays until it has.
export async function clearAfterSignOut() {
  if (state().dirty) return;
  [...SYNCED, STATE, 'cook'].forEach((name) => write(name, null, { quiet: true }));
}

export function startSync(onRestore) {
  afterRestore = onRestore;
  if (started) return syncNow();
  started = true;
  onChange((name) => {
    if (!SYNCED.includes(name)) return;
    write(STATE, { ...state(), dirty: true, changedAt: new Date().toISOString() }, { quiet: true });
    clearTimeout(timer);
    timer = setTimeout(syncNow, DELAY);
  });
  addEventListener('online', syncNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' || state().dirty) syncNow();
  });
  syncNow();
}
