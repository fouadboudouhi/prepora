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
  for (const day of plan?.cookDays ?? [])
    if (!day.done)
      alarms.push({
        id: `cook-${day.date}`,
        at: atHour(day.date, 10),
        title: 'Heute ist Kochtag',
        body: `Etwa ${day.minutes} Minuten, die Einkaufsliste ist bereit`,
      });
  return alarms.filter((alarm) => alarm.at > now);
}
