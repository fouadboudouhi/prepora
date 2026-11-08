// Der Kochmodus: first an overview of the day, then one step at a time, in any order. "Weiter" always works; a timer
// is its own button and runs once per step. Timers keep their end time, so a locked phone never makes them wrong; the
// server rings when it is locked. Claude sees the whole kitchen and can change steps and timers.
import {
  getPantry,
  getPlan,
  getStock,
  savePantry,
  saveStock,
  savePlan,
  scheduleReminders,
  settleShopping,
  updateBlocks,
} from './actions.js';
import { askClaudeJson } from './ai.js';
import { replyHtml } from './chatView.js';
import { askCook, talk } from './cookAssistant.js';
import {
  COOK_DAY_SYSTEM,
  cookDayRequest,
  dayDishes,
  finishCookDay,
  nextOpen,
  sortedTimers,
  stepUses,
} from './cookDay.js';
import { current, getDay, getSession, saveDay, saveSession, startTimer, stopTimer } from './cookState.js';
import { icon } from './icons.js';
import { COOK_DAY_SCHEMA, boxLabels, isPerishable, localDay, recipeOf } from './planner.js';
import { getProfile } from './profile.js';
import { enablePush, setAlarms } from './push.js';
import { errorText, esc, rerender } from './ui.js';

let audio = null;
let lock = null;
let ticker = null;
const refining = { busy: false, error: null };
let confirmRestart = false;

export const cooking = () => {
  const session = getSession();
  return !!session && !session.paused;
};
// A cook day that was paused goes on where it stopped.
export const cookButton = (date) => (getSession()?.date === date ? 'Weiterkochen' : 'Kochtag starten');

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
// What is typed for Claude survives a redraw, for example when a timer rings.
document.addEventListener('input', (event) => {
  if (event.target.name === 'question' && event.target.closest('#cookAsk')) talk.draft = event.target.value;
});

const clock = (ms) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

function tick() {
  const session = getSession();
  if (!session || session.paused) return;
  let rang = false;
  for (const timer of session.timers ?? []) {
    const left = timer.endAt - Date.now();
    const cell = document.querySelector(`[data-timer="${timer.id}"]`);
    if (cell) cell.textContent = left > 0 ? clock(left) : 'Fertig';
    if (left <= 0 && !timer.rang) {
      timer.rang = true;
      rang = true;
      ring();
    }
  }
  if (rang) {
    saveSession(session);
    if (!talk.busy) rerender();
  }
}

export function startTicking() {
  clearInterval(ticker);
  ticker = setInterval(tick, 1000);
  tick();
}

const over = (timer) => timer.endAt <= Date.now();

const timersBlock = (timers, steps = true) =>
  timers.length
    ? `<section class="timers" id="timers" aria-label="Timer">${sortedTimers(timers)
        .map(
          (timer) => `
          <div class="timer${over(timer) ? ' over' : ''}">
            ${
              steps && timer.stepId
                ? `<button type="button" class="timer-main" data-action="goStep" data-id="${esc(timer.stepId)}">`
                : '<div class="timer-main">'
            }
              <span class="timer-name">${esc(timer.name)}</span>
              ${over(timer) && timer.then ? `<span class="timer-then">${esc(timer.then)}</span>` : ''}
            ${steps && timer.stepId ? '</button>' : '</div>'}
            <span class="time" data-timer="${timer.id}">${over(timer) ? 'Fertig' : clock(timer.endAt - Date.now())}</span>
            <button type="button" class="mini" data-action="dropTimer" data-id="${timer.id}" aria-label="Timer ${esc(timer.name)} entfernen">${icon('close')}</button>
          </div>`
        )
        .join('')}</section>`
    : '';

const topBar = (middle, right = '<span class="icon-space"></span>') => `
  <div class="cook-top">
    <button type="button" class="icon" data-action="leaveCook" aria-label="Kochmodus pausieren">${icon('close')}</button>
    <span class="muted" id="stepCount">${middle}</span>
    ${right}
  </div>`;

const usesList = (uses, id = '') =>
  uses.length
    ? `<ul class="uses"${id ? ` id="${id}"` : ''}>${uses
        .map((item) => `<li><span class="qty">${esc(item.amount)}</span><span>${esc(item.name)}</span></li>`)
        .join('')}</ul>`
    : '';

// Old plans have short steps without amounts; Claude can write them again from the recipes, nothing new to buy.
function refineBlock(day) {
  if (day.steps.every((step) => Array.isArray(step.uses))) return '';
  return `
    <div class="card" id="refine">
      <h2>Schritte genauer machen?</h2>
      <p>Dieser Ablauf ist noch knapp, ohne Mengen in den Schritten. Claude kann ihn genauer schreiben, Rezepte und Einkauf bleiben gleich.</p>
      <button type="button" class="secondary" data-action="refineCook"${refining.busy ? ' disabled' : ''}>${refining.busy ? 'Claude schreibt, ca. 1 Minute …' : 'Genauer machen'}</button>
      ${refining.error ? `<p class="error" role="alert">${esc(errorText(refining.error))}</p>` : ''}
    </div>`;
}

function overviewView(plan, day, session) {
  const dishes = dayDishes(plan, day.date);
  const boxes = dishes.reduce((sum, dish) => sum + dish.boxes, 0);
  const allDone = day.steps.every((step) => session.done.includes(step.id));
  const started = session.done.length > 0 || session.timers.length > 0;
  const go = allDone ? 'Zu den Boxen' : started ? 'Weiterkochen' : 'Los geht’s';
  return `
    <main class="page cook">
      ${topBar('Übersicht')}
      <h1>Kochtag</h1>
      <p class="sub">Etwa ${day.minutes} Min. · ${dishes.length} ${dishes.length === 1 ? 'Gericht' : 'Gerichte'} · ${boxes} Boxen</p>
      ${refineBlock(day)}
      ${timersBlock(session.timers)}
      ${
        day.equipment.length
          ? `<section id="equipment"><h2 class="section">Das brauchst du</h2><ul class="tags">${day.equipment
              .map((item) => `<li>${esc(item)}</li>`)
              .join('')}</ul></section>`
          : ''
      }
      <section id="dishes">
        <h2 class="section">Gerichte und Zutaten</h2>
        <div class="list">${dishes
          .map(
            (dish) => `
            <details class="dish">
              <summary><span class="grow">${esc(dish.name)}</span><span class="muted small">${dish.boxes} Boxen</span></summary>
              ${usesList(dish.ingredients)}
            </details>`
          )
          .join('')}</div>
      </section>
      <section>
        <h2 class="section">Ablauf</h2>
        <ol class="flow" id="flow">${day.steps
          .map((step, index) => {
            const done = session.done.includes(step.id);
            const now = step.id === session.at && started && !done;
            return `
            <li>
              <button type="button" class="flow-step${done ? ' done' : ''}${now ? ' now' : ''}" data-action="goStep" data-id="${esc(step.id)}">
                <span class="flow-mark" aria-hidden="true">${done ? icon('check') : index + 1}</span>
                <span class="grow"><span class="block">${esc(step.title)}</span><span class="muted small">${esc(recipeOf(plan, step.recipeId)?.name ?? 'Vorbereitung')}${step.timerMinutes ? ` · ${step.timerMinutes} Min. Timer` : ''}</span></span>
                <span class="sr">${done ? ', erledigt' : now ? ', gerade dran' : ''}</span>
              </button>
            </li>`;
          })
          .join('')}</ol>
      </section>
      ${
        started
          ? `<button type="button" class="text-button${confirmRestart ? ' danger' : ''}" data-action="restartCook">${confirmRestart ? 'Wirklich von vorn? Timer gehen aus' : 'Von vorn anfangen'}</button>`
          : ''
      }
      <div class="cook-actions">
        <button type="button" class="secondary" data-action="openCookChat">${icon('chat')}<span>Claude</span></button>
        <button type="button" class="primary" data-action="beginCook" id="beginCook">${go}</button>
      </div>
    </main>`;
}

function stepView(plan, day, session) {
  const index = Math.max(
    day.steps.findIndex((step) => step.id === session.at),
    0
  );
  const step = day.steps[index];
  const recipe = recipeOf(plan, step.recipeId);
  const done = session.done.includes(step.id);
  const uses = stepUses(plan, step);
  const after = nextOpen(day, [...session.done, step.id], step.id);
  const next = day.steps.find((entry) => entry.id === after);
  const running = session.timers.find((timer) => timer.stepId === step.id);
  const timer = step.timerMinutes
    ? running
      ? `<p class="step-timer${over(running) ? ' over' : ''}" id="stepTimer">${icon('clock')}<span class="grow">${esc(running.name)} läuft</span><span class="time" data-timer="${running.id}">${over(running) ? 'Fertig' : clock(running.endAt - Date.now())}</span></p>`
      : `<button type="button" class="secondary step-timer-start" data-action="stepTimer" id="stepTimer">${icon('clock')}<span>Timer starten, ${step.timerMinutes} Min.</span></button>`
    : '';
  return `
    <main class="page cook">
      ${topBar(`Schritt ${index + 1} von ${day.steps.length}`, `<button type="button" class="icon" data-action="showOverview" aria-label="Alle Schritte">${icon('list')}</button>`)}
      <div class="bar wide" aria-hidden="true"><span style="width:${Math.round((session.done.length / day.steps.length) * 100)}%"></span></div>
      <section class="step">
        <span class="eyebrow">${esc(recipe?.name ?? 'Vorbereitung')}${done ? ' · erledigt' : ''}</span>
        <h1 id="stepTitle">${esc(step.title)}</h1>
        <p id="stepDetail">${esc(step.detail)}</p>
        ${usesList(uses, 'stepUses')}
        ${step.doneWhen ? `<p class="done-when"><strong>Fertig, wenn:</strong> ${esc(step.doneWhen)}</p>` : ''}
        ${timer}
        ${
          !Array.isArray(step.uses) && recipe
            ? `<details class="all-ingredients"><summary>Alle Zutaten für ${esc(recipe.name)}</summary>${usesList(
                dayDishes(plan, day.date).find((dish) => dish.id === recipe.id)?.ingredients ?? []
              )}</details>`
            : ''
        }
      </section>
      ${
        next
          ? `<button type="button" class="up-next" data-action="goStep" data-id="${esc(next.id)}" id="upNext"><span class="muted small">Als Nächstes</span><span>${esc(next.title)}</span></button>`
          : ''
      }
      ${timersBlock(session.timers.filter((entry) => entry !== running))}
      <div class="cook-actions three">
        <button type="button" class="icon" data-action="prevStep" aria-label="Einen Schritt zurück"${index ? '' : ' disabled'}>‹</button>
        <button type="button" class="secondary" data-action="openCookChat">${icon('chat')}<span>Claude</span></button>
        <button type="button" class="primary" data-action="doneStep" id="nextStep">${next ? (done ? 'Weiter' : 'Erledigt, weiter') : 'Fertig, zu den Boxen'}</button>
      </div>
    </main>`;
}

function labelsView(plan, session) {
  const labels = boxLabels(plan, session.date);
  return `
    <main class="page cook">
      ${topBar('Boxen', `<button type="button" class="icon" data-action="showOverview" aria-label="Alle Schritte">${icon('list')}</button>`)}
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
      ${leftoverBlock()}
      ${timersBlock(session.timers)}
      <div class="cook-actions">
        <button type="button" class="secondary" data-action="openCookChat">${icon('chat')}<span>Claude</span></button>
        <button type="button" class="primary" data-action="finishCook">Fertig</button>
      </div>
    </main>`;
}

const STARTERS = [
  'Was mache ich jetzt, und was kommt danach?',
  'Was kann ich gerade parallel machen?',
  'Wie lange dauert es noch insgesamt?',
];

function chatView(day, session) {
  const step = day.steps.find((entry) => entry.id === session.at);
  const chat = session.chat ?? [];
  return `
    <main class="chat-screen cook-chat">
      <header class="chat-head">
        <button type="button" class="back" data-action="closeCookChat">Kochen</button>
        <h1>Claude in der Küche</h1>
        <span></span>
      </header>
      <div class="chat-scroll" id="cookChat" role="log">
        ${
          chat.length
            ? chat
                .map((entry) =>
                  entry.role === 'user'
                    ? `<div class="bubble mine">${esc(entry.text)}</div>`
                    : `<div class="bubble">${replyHtml(entry.text)}${entry.changed ? `<div class="chat-change">${icon('check')}<span>Kochablauf angepasst</span></div>` : ''}</div>`
                )
                .join('')
            : `<div class="chat-empty">
                 <p>Claude kennt alle Gerichte, Mengen, Schritte und Timer von heute. Frag, was du willst, oder sag, was fehlt oder schiefgeht: Claude passt den Ablauf an.</p>
                 <div class="starters" id="cookStarters">${STARTERS.map((text) => `<button type="button" class="starter" data-action="cookStarter" data-text="${esc(text)}">${esc(text)}</button>`).join('')}<button type="button" class="starter" data-action="cookFill" data-text="Mir fehlt ">Mir fehlt eine Zutat …</button></div>
               </div>`
        }
        ${
          talk.busy
            ? `<div class="bubble" id="cookLive"><div id="cookLiveText">${esc(talk.text)}</div><p class="chat-status" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(talk.status)}</span></p></div>`
            : ''
        }
      </div>
      <div class="chat-foot">
        ${talk.error ? `<p class="note error" role="alert">${esc(errorText(talk.error))}</p>` : ''}
        ${timersBlock(session.timers, false)}
        ${
          session.phase === 'steps' && step
            ? `<p class="now-line"><span class="muted small">Gerade dran:</span> ${esc(step.title)}</p>`
            : ''
        }
        <form id="cookAsk" class="composer" novalidate>
          <textarea id="cookQuestion" name="question" rows="1" maxlength="500" enterkeyhint="send" aria-label="Frage an Claude" placeholder="Frag Claude …"${talk.busy ? ' disabled' : ''}>${esc(talk.draft)}</textarea>
          <button type="submit" class="send" aria-label="Senden"${talk.busy ? ' disabled' : ''}>${icon('up')}</button>
        </form>
      </div>
    </main>`;
}

// Fresh food the packs left over would spoil before the next plan. Frozen raw, it keeps and the next plan uses it.
function leftoverBlock() {
  settleShopping(undefined, { cooking: true });
  const fresh = getPantry().filter(isPerishable);
  if (!fresh.length) return '';
  return `
    <section id="leftovers">
      <h2 class="section">Übrig vom Einkauf</h2>
      <p class="sub">Roh einfrieren, dann hält es Monate und kommt in einen der nächsten Pläne.</p>
      <div class="list">${fresh
        .map(
          (entry) => `
          <div class="row">
            <span class="grow"><span class="block">${esc(entry.name)}</span><span class="muted small">ca. ${entry.grams} g</span></span>
            <button type="button" class="text-button" data-action="freezeLeftover" data-id="${esc(entry.id)}">Eingefroren</button>
          </div>`
        )
        .join('')}</div>
    </section>`;
}

export function cookView() {
  if (!getSession()) return '';
  const session = current();
  if (!session) {
    saveSession(null);
    return '';
  }
  if (session.paused) return '';
  const plan = getPlan();
  const day = getDay(session.date);
  if (talk.open) return chatView(day, session);
  if (session.phase === 'overview') return overviewView(plan, day, session);
  if (session.phase === 'labels') return labelsView(plan, session);
  return stepView(plan, day, session);
}

async function refine() {
  const session = current();
  const plan = getPlan();
  const day = getDay(session.date);
  Object.assign(refining, { busy: true, error: null });
  rerender();
  try {
    const answer = await askClaudeJson({
      system: COOK_DAY_SYSTEM,
      messages: [{ role: 'user', content: cookDayRequest(plan, day.date, getProfile()) }],
      format: COOK_DAY_SCHEMA,
      maxTokens: 16000,
      effort: 'medium',
    });
    const better = finishCookDay(answer, getDay(session.date));
    if (!better) throw new Error('Claude hat keine Schritte geschickt.');
    saveDay(better);
    const now = current();
    Object.assign(now, { done: [], at: better.steps[0].id });
    saveSession(now);
  } catch (err) {
    refining.error = err;
  }
  refining.busy = false;
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

const change = (fn) => {
  const session = current();
  if (!session) return;
  fn(session, getDay(session.date));
  saveSession(session);
  confirmRestart = false;
  rerender();
  window.scrollTo?.(0, 0);
};

function stopAll() {
  lock?.release?.();
  lock = null;
  clearInterval(ticker);
}

export const cookActions = {
  freezeLeftover: (el) => {
    savePantry(
      getPantry().map((entry) =>
        entry.id === el.dataset.id ? { ...entry, category: 'Tiefkühl', since: localDay() } : entry
      )
    );
    rerender();
  },
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
    const running = getSession();
    if (running?.date === el.dataset.date) saveSession({ ...running, paused: false });
    else {
      const day = getDay(el.dataset.date);
      saveSession({
        date: el.dataset.date,
        phase: 'overview',
        at: day?.steps[0]?.id,
        done: [],
        timers: [],
        startedAt: Date.now(),
        chat: [],
      });
    }
    Object.assign(talk, { open: false, error: null });
    Object.assign(refining, { busy: false, error: null });
    rerender();
  },
  beginCook: () =>
    change((session, day) => {
      unlockSound();
      if (day.steps.every((step) => session.done.includes(step.id))) session.phase = 'labels';
      else {
        session.phase = 'steps';
        if (session.done.includes(session.at)) session.at = nextOpen(day, session.done, session.at);
      }
    }),
  showOverview: () => change((session) => (session.phase = 'overview')),
  goStep: (el) =>
    change((session, day) => {
      if (!day.steps.some((step) => step.id === el.dataset.id)) return;
      Object.assign(session, { phase: 'steps', at: el.dataset.id });
    }),
  doneStep: () =>
    change((session, day) => {
      unlockSound();
      if (!session.done.includes(session.at)) session.done.push(session.at);
      const next = nextOpen(day, session.done, session.at);
      if (next) session.at = next;
      else session.phase = 'labels';
    }),
  prevStep: () =>
    change((session, day) => {
      const index = day.steps.findIndex((step) => step.id === session.at);
      if (index > 0) session.at = day.steps[index - 1].id;
    }),
  stepTimer: () =>
    change((session, day) => {
      unlockSound();
      const step = day.steps.find((entry) => entry.id === session.at);
      if (!step?.timerMinutes || session.timers.some((timer) => timer.stepId === step.id)) return;
      startTimer(session, {
        name: step.timerName || step.title,
        minutes: step.timerMinutes,
        then: step.timerThen ?? '',
        stepId: step.id,
      });
    }),
  dropTimer: (el) => change((session) => stopTimer(session, el.dataset.id)),
  restartCook: () => {
    if (!confirmRestart) {
      confirmRestart = true;
      rerender();
      return;
    }
    change((session, day) => {
      [...session.timers].forEach((timer) => stopTimer(session, timer.id));
      Object.assign(session, { done: [], at: day.steps[0].id, startedAt: Date.now() });
    });
  },
  refineCook: () => refine(),
  openCookChat: () => {
    talk.open = true;
    rerender();
  },
  closeCookChat: () => {
    talk.open = false;
    rerender();
  },
  cookStarter: (el) => askCook(el.dataset.text),
  cookFill: (el) => {
    talk.draft = el.dataset.text;
    rerender();
    const field = document.getElementById('cookQuestion');
    field?.focus();
    field?.setSelectionRange?.(field.value.length, field.value.length);
  },
  // Away from the stove for a moment: everything stays, the timers keep running and ringing.
  leaveCook: () => {
    stopAll();
    const session = getSession();
    if (session) saveSession({ ...session, paused: true });
    talk.open = false;
    rerender();
  },
  finishCook: () => {
    const session = current();
    const plan = getPlan();
    const day = plan.cookDays.find((entry) => entry.date === session.date);
    day.done = true;
    freezeToday(plan, session.date);
    savePlan(plan);
    scheduleReminders(plan);
    setAlarms([], [`cook-${session.date}`, ...session.timers.map((timer) => `timer-${timer.id}`)]);
    stopAll();
    saveSession(null);
    Object.assign(talk, { open: false, draft: '', error: null });
    rerender();
  },
};

export function cookAsk(form) {
  const text = form.elements.question.value;
  form.elements.question.blur();
  askCook(text);
}
