// Reminders from the server, so they also arrive with a locked phone: finished timers, thawing, the next cook day.
import { call } from './session.js';
import { read, write } from './store.js';

const STATE = 'push';

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushOn = () => pushSupported() && Notification.permission === 'granted' && !!read(STATE, null);

const bytes = (text) => {
  const raw = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// Must run inside a tap: phones only show the question then. No answer or no support is fine, the app works without.
export async function enablePush() {
  if (!pushSupported()) return false;
  try {
    if ((await Notification.requestPermission()) !== 'granted') return false;
    const { key } = await (await call('/v1/push/key')).json();
    const worker = await navigator.serviceWorker.ready;
    const subscription =
      (await worker.pushManager.getSubscription()) ??
      (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) }));
    await call('/v1/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
    write(STATE, { at: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
}

export async function setAlarms(set = [], cancel = []) {
  if (!pushOn() || (!set.length && !cancel.length)) return;
  await call('/v1/push/alarms', { method: 'POST', body: JSON.stringify({ set, cancel }) }).catch(() => {});
}

const atHour = (date, hour) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).getTime();

// All reminders of a week. The ids stay the same for the same day, so a new plan replaces the old ones.
export function planAlarms(plan, nameOf, now = Date.now()) {
  const alarms = [];
  for (const meal of plan?.meals ?? [])
    if (meal.thawOn && !meal.eaten)
      alarms.push({
        id: `thaw-${meal.id}`,
        at: atHour(meal.thawOn, 19),
        title: 'Heute Abend auftauen',
        body: `${nameOf(meal)} aus dem Tiefkühler in den Kühlschrank legen`,
      });
  return alarms.filter((alarm) => alarm.at > now);
}

const BLOCK_DAYS = 56;
const CANCEL_DAYS = 60;
const DAY = 86400000;
const dateAhead = (now, days) => {
  const at = new Date(now + days * DAY);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
};
const timeOf = (date, time) => new Date(`${date}T${time}:00`).getTime();

// The fixed times of the week, for the next weeks. They stand whether a plan exists or not, and the same day keeps the
// same id, so changing a time replaces the reminder instead of adding one.
export function blockAlarms(profile, now = Date.now()) {
  const alarms = [];
  const minutes = profile.cookMinutes ?? 90;
  for (let days = 0; days < BLOCK_DAYS; days += 1) {
    const date = dateAhead(now, days);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    if (weekday === (profile.cookWeekday ?? 0))
      alarms.push({
        id: `cook-${date}`,
        at: timeOf(date, profile.cookTime ?? '10:00'),
        title: 'Zeit zum Kochen',
        body: `Dein Kochtag, etwa ${minutes} Minuten`,
      });
    else if ((profile.cookDays ?? 1) === 2 && weekday === (profile.cookWeekday2 ?? 3))
      alarms.push({
        id: `cook-${date}`,
        at: timeOf(date, profile.cookTime2 ?? '18:00'),
        title: 'Zeit zum Kochen',
        body: `Dein zweiter Kochtag, etwa ${minutes} Minuten`,
      });
    if (weekday === (profile.shopWeekday ?? 6))
      alarms.push({
        id: `shop-${date}`,
        at: timeOf(date, profile.shopTime ?? '17:00'),
        title: 'Zeit zum Einkaufen',
        body: 'Deine Liste für die ganze Woche ist bereit',
      });
  }
  return alarms.filter((alarm) => alarm.at > now);
}

export function syncBlocks(profile) {
  const alarms = blockAlarms(profile);
  const keep = new Set(alarms.map((alarm) => alarm.id));
  const stale = [];
  for (let days = 0; days < CANCEL_DAYS; days += 1)
    for (const kind of ['cook', 'shop']) {
      const id = `${kind}-${dateAhead(Date.now(), days)}`;
      if (!keep.has(id)) stale.push(id);
    }
  return setAlarms(alarms, stale);
}
