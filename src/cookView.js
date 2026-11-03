// Der Kochmodus: all recipes as one line of steps. A step with a timer starts it with the tap that moves on, so hands
// stay free. Timers keep their end time, so a locked phone never makes them wrong; the server rings when it is locked.
import { getPlan, getStock, saveStock, savePlan, scheduleReminders, updateBlocks } from './actions.js';
import { askClaude } from './ai.js';
import { boxLabels, recipeOf } from './planner.js';
import { enablePush, setAlarms } from './push.js';
import { read, write } from './store.js';
import { errorText, esc, rerender } from './ui.js';

let audio = null;
let lock = null;
let ticker = null;
const helper = { open: false, busy: false, question: '', answer: '', error: null };

const session = () => read('cook', null);
const saveSession = (value) => write('cook', value);
export const cooking = () => !!session();

function unlockSound() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume();
  } catch {
    // No sound, the time on the screen still counts.
  }
}
function ring() {
  if (!audio) return;
  [0, 0.25, 0.5].forEach((delay) => {
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = 880;
    gain.gain.value = 0.25;
    tone.connect(gain).connect(audio.destination);
    tone.start(audio.currentTime + delay);
    tone.stop(audio.currentTime + delay + 0.18);
  });
}

async function keepAwake() {
  try {
    lock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    // Not offered or refused; the phone then sleeps as usual and the timers still end on time.
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cooking()) keepAwake();
});

const clock = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

function tick() {
  const current = session();
  if (!current) return;
  let changed = false;
  for (const timer of current.timers) {
    const left = timer.endAt - Date.now();
    const cell = document.querySelector(`[data-timer="${timer.id}"]`);
    if (cell) cell.textContent = left > 0 ? clock(left) : 'Fertig';
    if (left <= 0 && !timer.rang) {
      timer.rang = true;
      changed = true;
      ring();
      cell?.classList.add('over');
    }
  }
  if (changed) saveSession(current);
}

export function startTicking() {
  clearInterval(ticker);
  ticker = setInterval(tick, 1000);
  tick();
}

const timersBlock = (timers) =>
  timers.length
    ? `<div class="list timers" id="timers">${timers
        .map(
          (timer) => `
          <button type="button" class="row" data-action="dropTimer" data-id="${timer.id}" aria-label="Timer ${esc(timer.name)} entfernen">
            <span>${esc(timer.name)}</span>
            <span class="time${timer.endAt <= Date.now() ? ' over' : ''}" data-timer="${timer.id}">${timer.endAt <= Date.now() ? 'Fertig' : clock(timer.endAt - Date.now())}</span>
          </button>`
        )
        .join('')}</div>`
    : '';

const helperBlock = () =>
  helper.open
    ? `<form id="cookHelper" class="helper" novalidate>
        <label class="field">Was ist los?
          <input name="question" type="text" maxlength="200" placeholder="Zum Beispiel: Ich habe keinen Koriander" value="${esc(helper.question)}">
        </label>
        <button type="submit" class="secondary"${helper.busy ? ' disabled' : ''}>${helper.busy ? 'Claude antwortet …' : 'Fragen'}</button>
        ${helper.answer ? `<p class="answer" role="status">${esc(helper.answer)}</p>` : ''}
        ${helper.error ? `<p class="error" role="alert">${esc(errorText(helper.error))}</p>` : ''}
      </form>`
    : '';

function labelsView(plan, current) {
  const labels = boxLabels(plan, current.date);
  return `
    <main class="page cook">
      <h1>Boxen beschriften</h1>
      <p class="sub">Datum auf jeden Deckel. Vor dem Einfrieren abkühlen lassen.</p>
      <div class="list" id="labels">
        ${labels
          .map(
            (label) => `
            <div class="row stacked">
              <span>${label.count} × ${esc(label.name)}</span>
              <span class="muted">${label.storage === 'freezer' ? 'Tiefkühler' : 'Kühlschrank'}, für ${esc(label.days.join(', '))}</span>
            </div>`
          )
          .join('')}
      </div>
      ${timersBlock(current.timers)}
      <button type="button" class="primary" data-action="finishCook">Fertig</button>
    </main>`;
}

export function cookView() {
  const current = session();
  const plan = getPlan();
  const day = plan?.cookDays.find((entry) => entry.date === current?.date);
  if (!day) {
    saveSession(null);
    return '';
  }
  if (current.step >= day.steps.length) return labelsView(plan, current);
  const step = day.steps[current.step];
  const recipe = recipeOf(plan, step.recipeId);
  const label = step.timerMinutes ? `Timer starten, ${step.timerMinutes} Min.` : 'Weiter';
  return `
    <main class="page cook">
      <div class="cook-top">
        <button type="button" class="icon" data-action="leaveCook" aria-label="Kochmodus verlassen">×</button>
        <span class="muted" id="stepCount">Schritt ${current.step + 1} von ${day.steps.length}</span>
        <button type="button" class="icon" data-action="prevStep" aria-label="Einen Schritt zurück"${current.step ? '' : ' disabled'}>‹</button>
      </div>
      <div class="bar wide"><span style="width:${Math.round(((current.step + 1) / day.steps.length) * 100)}%"></span></div>
      <section class="step">
        <span class="eyebrow">${esc(recipe?.name ?? 'Vorbereitung')}</span>
        <h1 id="stepTitle">${esc(step.title)}</h1>
        <p>${esc(step.detail)}</p>
        ${
          recipe
            ? `<details><summary>Zutaten</summary><ul>${recipe.ingredients
                .map((item) => `<li>${esc(item.grams ? `${item.grams} g ` : '')}${esc(item.name)}</li>`)
                .join('')}</ul></details>`
            : ''
        }
      </section>
      ${helperBlock()}
      ${timersBlock(current.timers)}
      <div class="cook-actions">
        <button type="button" class="secondary" data-action="toggleHelper">Frage</button>
        <button type="button" class="primary" data-action="nextStep" id="nextStep">${esc(label)}</button>
      </div>
    </main>`;
}

export async function askHelper(question) {
  const current = session();
  const plan = getPlan();
  const day = plan?.cookDays.find((entry) => entry.date === current?.date);
  const step = day?.steps[current?.step];
  if (!step || !question.trim()) return;
  Object.assign(helper, { busy: true, question, answer: '', error: null });
  rerender();
  try {
    const recipe = recipeOf(plan, step.recipeId);
    helper.answer = await askClaude({
      system:
        'Du hilfst jemandem gerade beim Kochen, die Hände sind beschäftigt. Antworte auf Deutsch in höchstens drei kurzen Sätzen, direkt umsetzbar. Bei Fragen zur Lebensmittelsicherheit sei vorsichtig: im Zweifel nicht essen.',
      messages: [
        {
          role: 'user',
          content: `Gerade dran: ${step.title}. ${step.detail}\nRezept: ${recipe?.name ?? 'keins'}. Zutaten: ${recipe?.ingredients.map((item) => item.name).join(', ') ?? ''}\nFrage: ${question}`,
        },
      ],
      maxTokens: 2000,
    });
  } catch (err) {
    helper.error = err;
  }
  helper.busy = false;
  rerender();
}

// What goes into the freezer today is in the freezer list from now on, for this plan and any later one.
function freezeToday(plan, date) {
  const stock = getStock();
  for (const label of boxLabels(plan, date)) {
    if (label.storage !== 'freezer') continue;
    const recipe = recipeOf(plan, label.recipeId);
    const found = stock.find((item) => item.recipeId === label.recipeId && item.frozenAt === date);
    if (found) found.portions += label.count;
    else
      stock.push({
        id: `s-${date}-${label.recipeId}`,
        recipeId: label.recipeId,
        name: label.name,
        portions: label.count,
        frozenAt: date,
        nutrition: recipe.nutrition,
      });
  }
  saveStock(stock);
}

export const cookActions = {
  // One tap: this is also the moment a phone lets the app ask for reminders, and the sound may start.
  startCook: (el) => {
    unlockSound();
    keepAwake();
    enablePush().then((on) => {
      if (on) {
        scheduleReminders(getPlan());
        updateBlocks();
      }
    });
    const running = session();
    saveSession(running?.date === el.dataset.date ? running : { date: el.dataset.date, step: 0, timers: [] });
    Object.assign(helper, { open: false, answer: '', question: '', error: null });
    rerender();
  },
  nextStep: () => {
    unlockSound();
    const current = session();
    const day = getPlan()?.cookDays.find((entry) => entry.date === current.date);
    const step = day?.steps[current.step];
    if (step?.timerMinutes) {
      const timer = {
        id: `t${Date.now()}`,
        name: step.timerName || step.title,
        endAt: Date.now() + step.timerMinutes * 60000,
      };
      current.timers.push(timer);
      setAlarms([
        {
          id: `timer-${timer.id}`,
          at: timer.endAt,
          title: `${timer.name} ist fertig`,
          body: 'Timer abgelaufen',
        },
      ]);
    }
    current.step += 1;
    saveSession(current);
    Object.assign(helper, { open: false, answer: '', question: '', error: null });
    rerender();
  },
  prevStep: () => {
    const current = session();
    current.step = Math.max(0, current.step - 1);
    saveSession(current);
    rerender();
  },
  toggleHelper: () => {
    helper.open = !helper.open;
    rerender();
  },
  dropTimer: (el) => {
    const current = session();
    current.timers = current.timers.filter((timer) => timer.id !== el.dataset.id);
    saveSession(current);
    setAlarms([], [`timer-${el.dataset.id}`]);
    rerender();
  },
  leaveCook: () => {
    lock?.release?.();
    lock = null;
    clearInterval(ticker);
    const current = session();
    setAlarms([], current?.timers.map((timer) => `timer-${timer.id}`) ?? []);
    saveSession(null);
    rerender();
  },
  finishCook: () => {
    const current = session();
    const plan = getPlan();
    const day = plan.cookDays.find((entry) => entry.date === current.date);
    day.done = true;
    freezeToday(plan, current.date);
    savePlan(plan);
    scheduleReminders(plan);
    setAlarms([], [`cook-${current.date}`, ...current.timers.map((timer) => `timer-${timer.id}`)]);
    lock?.release?.();
    lock = null;
    clearInterval(ticker);
    saveSession(null);
    rerender();
  },
};
