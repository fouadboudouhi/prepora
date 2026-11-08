// Where the cook day stands: the open step, what is done, the running timers and the talk with Claude. The screen and
// the assistant change it through the same few functions, so both always see the same kitchen.
import { getPlan, savePlan } from './actions.js';
import { readyDay, readySession } from './cookDay.js';
import { setAlarms } from './push.js';
import { read, write } from './store.js';

export const getSession = () => read('cook', null);
export const saveSession = (value) => write('cook', value);

// The day being cooked, with ids on every step; a plan from before gets them once and keeps them.
export function getDay(date = getSession()?.date) {
  const plan = getPlan();
  const index = plan?.cookDays.findIndex((entry) => entry.date === date) ?? -1;
  if (index < 0) return null;
  const day = plan.cookDays[index];
  if (day.steps.some((step) => !step.id) || !day.equipment) {
    plan.cookDays[index] = readyDay(day);
    savePlan(plan);
  }
  return plan.cookDays[index];
}

export function saveDay(day) {
  const plan = getPlan();
  plan.cookDays = plan.cookDays.map((entry) => (entry.date === day.date ? day : entry));
  savePlan(plan);
}

// The session as it is now, from a plan of any age.
export function current() {
  const session = getSession();
  if (!session) return null;
  const day = getDay(session.date);
  if (!day) return null;
  const ready = readySession(session, day);
  if (ready !== session) saveSession(ready);
  return ready;
}

export function startTimer(session, { name, minutes, then = '', stepId = '' }) {
  const timer = {
    id: `t${Date.now()}${Math.floor(Math.random() * 1000)}`,
    stepId,
    name: name || 'Timer',
    then,
    endAt: Date.now() + Math.max(minutes, 0.1) * 60000,
  };
  session.timers.push(timer);
  setAlarms([
    {
      id: `timer-${timer.id}`,
      at: timer.endAt,
      title: `${timer.name} ist fertig`,
      body: then || 'Timer abgelaufen',
    },
  ]);
  return timer;
}

export function stopTimer(session, id) {
  session.timers = session.timers.filter((timer) => timer.id !== id);
  setAlarms([], [`timer-${id}`]);
}
