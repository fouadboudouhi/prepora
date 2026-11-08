// The shell: sign-in or a new account with an invite, four tabs, and the full-screen cook day above them.
import { applyTrend, getPantry, getPlan, getStock, settleShopping, updateBlocks } from './actions.js';
import { chatActions, drawChat, keepDraft, send, watchKeyboard } from './chatView.js';
import { askHelper, cookActions, cookView, cooking, startTicking } from './cookView.js';
import { keepShapeWish, planActions, planView, readFridgePhoto } from './planView.js';
import { photoActions, photoView, readDishPhoto, recheckDish } from './photoView.js';
import { saveFromForm, profileActions, profileView, showTargets } from './profileView.js';
import { importRecipe, importRecipePhoto, recipeActions, recipesView } from './recipesView.js';
import { icon } from './icons.js';
import { pushOn } from './push.js';
import { createInvite, getSession, refreshMe, register, signIn, signOut } from './session.js';
import { shopActions, shopView } from './shopView.js';
import { addStock, plannedOf, stockActions, stockView } from './stockView.js';
import { addSupplement, supplementActions, supplementsView } from './supplementsView.js';
import { clearAfterSignOut, startSync, syncNow } from './sync.js';
import { tasteActions, tasteView } from './tasteView.js';
import { changeAmount, keepFoodDraft, logFood, todayActions, todayView } from './todayView.js';
import { weekView } from './weekView.js';
import { addFridgeItem, addPantry, pantryActions, pantryView, setPantryGrams } from './pantryView.js';
import { navigate, settle, watchScroll } from './motion.js';
import {
  findTyped,
  resetScan,
  scanActions,
  scanView,
  setScanGrams,
  startScanner,
  stopScanner,
} from './scanView.js';
import { errorText, esc, number, setOpener, setRedraw } from './ui.js';
import { updateFromVolumora } from './volumora.js';

const TABS = [
  { id: 'today', label: 'Heute', title: 'Heute', view: todayView },
  { id: 'plan', label: 'Plan', title: 'Plan', view: planView },
  { id: 'shop', label: 'Einkauf', title: 'Einkauf', view: shopView },
  { id: 'chat', label: 'Claude', title: 'Claude' },
  { id: 'more', label: 'Mehr', title: 'Mehr', view: moreView },
];
// Screens that open from a tab and keep it lit. They bring their own title and way back.
const SUB_VIEWS = {
  profile: profileView,
  pantry: pantryView,
  stock: stockView,
  taste: tasteView,
  supplements: supplementsView,
  recipes: recipesView,
  photo: photoView,
  week: weekView,
  scan: scanView,
};
// Screens that belong to Heute keep it lit; the rest open from Mehr.
const UNDER_TODAY = ['photo', 'week', 'scan'];
const ACTIONS = {
  createInvite: async () => {
    Object.assign(inviting, { busy: true, error: '' });
    redrawKeepingPlace();
    try {
      inviting.code = await createInvite();
    } catch (err) {
      inviting.error = errorText(err);
    }
    inviting.busy = false;
    redrawKeepingPlace();
  },
  shareInvite: async () => {
    const link = inviteLink(inviting.code);
    const text = `Dein Zugang zu Prepora: ${link}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Prepora', text, url: link });
      else await navigator.clipboard.writeText(link);
    } catch {
      // Closed without sharing.
    }
  },
  rateHabits: () => {
    open('chat');
    send('Bewerte meine Essgewohnheiten der letzten zwei Wochen.');
  },
  ...todayActions,
  ...planActions,
  ...shopActions,
  ...stockActions,
  ...tasteActions,
  ...cookActions,
  ...profileActions,
  ...photoActions,
  ...supplementActions,
  ...recipeActions,
  ...chatActions,
  ...scanActions,
  ...pantryActions,
};

// The rows under Mehr; each hint is worked out when the screen is drawn.
const MORE = [
  {
    tab: 'profile',
    id: 'openProfile',
    icon: 'person',
    label: 'Profil',
    hint: () => 'Ziel, Körper, Kochen, Essen',
  },
  {
    tab: 'taste',
    id: 'openTaste',
    icon: 'heart',
    label: 'Geschmack',
    hint: () => 'Was Prepora über dich weiß',
  },
  {
    tab: 'recipes',
    id: 'openRecipes',
    icon: 'book',
    label: 'Eigene Rezepte',
    hint: () => 'Aus Link, Foto oder Text',
  },
  {
    tab: 'supplements',
    id: 'openSupplements',
    icon: 'pill',
    label: 'Supplements',
    hint: () => 'Deine und was Claude rät',
  },
  {
    tab: 'pantry',
    id: 'openPantry',
    icon: 'jar',
    label: 'Vorrat',
    hint: () => {
      const count = getPantry().length;
      return count ? `${count} ${count === 1 ? 'Sache' : 'Sachen'} zu Hause` : 'Was du zu Hause hast';
    },
  },
  {
    tab: 'stock',
    id: 'openStock',
    icon: 'snow',
    label: 'Tiefkühler',
    hint: () => {
      const stock = getStock();
      const portions = stock.reduce((sum, item) => sum + item.portions, 0);
      const people = getPlan()?.people ?? 1;
      const planned = stock.reduce(
        (sum, item) => sum + Math.min(item.portions, plannedOf(item).length * people),
        0
      );
      return `${number(portions)} ${portions === 1 ? 'Portion' : 'Portionen'}${planned ? `, ${number(planned)} eingeplant` : ''}`;
    },
  },
];

const money = (value) => `${Number(value).toFixed(2).replace('.', ',')} $`;
const app = document.getElementById('app');
let current = 'today';
// The chat covers the tabs; its back button returns to where it was opened from.
let chatBack = 'today';

function aiLine(ai) {
  if (!ai) return 'Wird geprüft';
  if (!ai.available) return 'Kein Schlüssel auf dem Server';
  return `${money(ai.used)} von ${money(ai.budget)} diesen Monat`;
}

// The admin hands out invites from here, so nobody needs Volumora to join.
const inviting = { busy: false, code: '', error: '' };
const inviteLink = (code) => `${location.origin}${location.pathname}?invite=${encodeURIComponent(code)}`;
function inviteBlock() {
  return `
    <h2 class="section">Einladen</h2>
    <div class="list" id="invite">
      ${
        inviting.code
          ? `<div class="row"><span class="grow"><span class="block">Code <strong id="inviteCode">${esc(inviting.code)}</strong></span><span class="muted small">Gilt einmal. Mit dem Link ist der Code schon eingetragen.</span></span>
             <button type="button" class="text-button" data-action="shareInvite">Teilen</button></div>`
          : ''
      }
      <button type="button" class="row go" data-action="createInvite" id="createInvite"${inviting.busy ? ' disabled' : ''}>
        <span class="grow"><span class="block">${inviting.code ? 'Noch eine Einladung' : 'Einladung erstellen'}</span><span class="muted small">Für ein eigenes Prepora-Konto</span></span>
      </button>
    </div>
    ${inviting.error ? `<p class="error" role="alert">${esc(inviting.error)}</p>` : ''}`;
}

function moreView() {
  const session = getSession();
  return `
    <div class="list">
      ${MORE.map(
        (entry) => `
        <button type="button" class="row go" data-tab="${entry.tab}" id="${entry.id}">
          <span class="tile">${icon(entry.icon)}</span>
          <span class="grow"><span class="block">${entry.label}</span><span class="muted small">${entry.hint()}</span></span>
        </button>`
      ).join('')}
    </div>
    <div class="list">
      <div class="row"><span>Konto</span><span class="muted" id="accountName">${esc(session.username)}</span></div>
      <div class="row"><span>Claude</span><span class="muted" id="aiLine">${esc(aiLine(session.ai))}</span></div>
      <div class="row"><span>Erinnerungen</span><span class="muted" id="pushLine">${pushOn() ? 'An' : 'Ab dem ersten Kochtag'}</span></div>
    </div>
    ${session.admin ? inviteBlock() : ''}
    <button type="button" class="secondary" id="signOut">Abmelden</button>`;
}

// The camera only runs while the scanner is on screen.
function draw() {
  if (current !== 'scan') stopScanner();
  paint();
  if (current === 'scan') startScanner();
  settle(app);
}

function paint() {
  if (!getSession()) return showGate();
  if (cooking()) {
    const page = cookView();
    if (page) {
      app.innerHTML = page;
      startTicking();
      return;
    }
  }
  if (current === 'chat') return drawChat(app, chatBack);
  const sub = SUB_VIEWS[current];
  const lit = UNDER_TODAY.includes(current) ? 'today' : sub ? 'more' : current;
  const tab = TABS.find((entry) => entry.id === lit) ?? TABS[0];
  const content = sub ? sub() : `<h1>${tab.title}</h1>${tab.view()}`;
  app.innerHTML = `
    <div class="topbar" aria-hidden="true"><span></span></div>
    <main class="page">${content}</main>
    <nav class="tabs" aria-label="Bereiche">
      ${TABS.map(
        (entry) =>
          `<button type="button" data-tab="${entry.id}"${entry.id === tab.id ? ' aria-current="page"' : ''}>${icon(entry.id)}<span>${entry.label}</span></button>`
      ).join('')}
    </nav>`;
  showTargets();
}

// A redraw from the background must not throw away what is being typed, nor jump to the top of the page.
function redrawKeepingPlace() {
  if (
    document.activeElement?.matches?.(
      'input[type="text"], input[type="number"], input[type="time"], textarea'
    )
  )
    return;
  const top = window.scrollY;
  draw();
  window.scrollTo(0, top);
}

function open(id) {
  if (id === 'chat' && current !== 'chat') chatBack = current;
  if (id === 'scan' && current !== 'scan') resetScan();
  const from = current;
  current = id;
  const deep = (view) => view in SUB_VIEWS;
  const direction =
    id === 'chat'
      ? 'sheet'
      : from === 'chat'
        ? 'close'
        : deep(id) && !deep(from)
          ? 'push'
          : deep(from) && !deep(id)
            ? 'pop'
            : 'tab';
  const update = () => {
    draw();
    window.scrollTo(0, 0);
    document.documentElement.classList.remove('scrolled');
  };
  if (from === id) return update();
  navigate(direction, update);
}

// An invite link opens straight on the new account, with the code filled in.
const invited = () => new URLSearchParams(location.search).get('invite') ?? '';
function showGate(mode = invited() ? 'register' : 'signIn') {
  const fresh = mode === 'register';
  app.innerHTML = `
    <main class="page gate">
      <img class="gate-icon" src="assets/icons/icon-192.png" alt="" width="64" height="64">
      <h1>Prepora</h1>
      <p>${fresh ? 'Neues Konto mit deinem Einladungscode.' : 'Melde dich an.'}</p>
      <form id="${fresh ? 'register' : 'signIn'}" novalidate>
        <label>Benutzername
          <input id="username" type="text" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="32" required>
        </label>
        <label>Passwort
          <input id="password" type="password" name="password" autocomplete="${fresh ? 'new-password' : 'current-password'}" required>
        </label>
        ${
          fresh
            ? `<label>Einladungscode
                 <input id="inviteInput" type="text" name="invite" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" value="${esc(invited())}" required>
               </label>`
            : ''
        }
        <p class="error" id="signInError" role="alert" hidden></p>
        <button type="submit" class="primary" id="signInButton">${fresh ? 'Konto erstellen' : 'Anmelden'}</button>
      </form>
      <p class="note">${
        fresh
          ? 'Schon ein Konto? <button type="button" class="link" id="gateSignIn">Anmelden</button>'
          : 'Noch kein Konto? <button type="button" class="link" id="gateRegister">Mit Einladungscode erstellen</button>'
      }</p>
      <p class="note small">Ein Volumora-Konto funktioniert hier auch.</p>
    </main>`;
  document.getElementById('gateSignIn')?.addEventListener('click', () => showGate('signIn'));
  document.getElementById('gateRegister')?.addEventListener('click', () => showGate('register'));
}

// What the server knows comes in the background. Nothing here waits for it, and without a connection nothing changes.
function refreshAccount() {
  refreshMe()
    .then(() => {
      if (current === 'more') redrawKeepingPlace();
    })
    .catch(() => {
      if (!getSession()) showGate();
    });
  updateFromVolumora()
    .catch(() => false)
    .then((changed) => {
      const settled = settleShopping();
      if (applyTrend() || settled || changed) redrawKeepingPlace();
    });
  updateBlocks();
}

function start() {
  current = 'today';
  draw();
  if (getSession()) {
    refreshAccount();
    startSync(redrawKeepingPlace);
  }
}

setRedraw(redrawKeepingPlace);
watchScroll();
watchKeyboard();
setOpener(open);

async function enter(how) {
  const error = document.getElementById('signInError');
  const button = document.getElementById('signInButton');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const invite = document.getElementById('inviteInput')?.value.trim();
  if (!username || !password || invite === '') {
    error.textContent = invite === '' ? 'Bitte alles ausfüllen.' : 'Bitte beides ausfüllen.';
    error.hidden = false;
    return;
  }
  button.disabled = true;
  error.hidden = true;
  try {
    await how(username, password, invite);
    if (invited()) history.replaceState(null, '', location.pathname);
    start();
    // In the background the camera goes off; back on the scanner it comes on again.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stopScanner();
      else if (current === 'scan') startScanner();
    });
  } catch (err) {
    error.textContent = errorText(err);
    error.hidden = false;
    button.disabled = false;
  }
}

const FORMS = {
  pantryAdd: addPantry,
  fridgeAdd: addFridgeItem,
  register: () => enter(register),
  signIn: () => enter(signIn),
  stockAdd(form) {
    const name = form.elements.name.value;
    form.elements.name.value = '';
    form.elements.name.blur();
    addStock(name);
  },
  supplementAdd(form) {
    addSupplement(form.elements.name.value, form.elements.dose.value);
    form.reset();
    document.activeElement?.blur?.();
  },
  recipeImport(form) {
    const text = form.elements.source.value;
    form.reset();
    document.activeElement?.blur?.();
    importRecipe(text);
  },
  dishFix(form) {
    const name = form.elements.name.value;
    document.activeElement?.blur?.();
    recheckDish(name);
  },
  scanCode(form) {
    const text = form.elements.code.value;
    form.elements.code.blur();
    findTyped(text);
  },
  foodLogForm(form) {
    const text = form.elements.food.value;
    form.elements.food.blur();
    logFood(text);
  },
  chatForm(form) {
    const text = form.elements.message.value;
    form.elements.message.blur();
    send(text);
  },
  cookHelper(form) {
    const question = form.elements.question.value;
    form.elements.question.blur();
    askHelper(question);
  },
};

app.addEventListener('submit', (event) => {
  const handler = FORMS[event.target.id];
  if (!handler) return;
  event.preventDefault();
  handler(event.target);
});

app.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    open(tab.dataset.tab);
    if (tab.dataset.tab === 'more') refreshAccount();
    return;
  }
  const action = event.target.closest('[data-action]');
  if (action && !action.disabled) {
    ACTIONS[action.dataset.action]?.(action);
    return;
  }
  if (event.target.closest('#signOut')) {
    await syncNow().catch(() => {});
    await signOut();
    await clearAfterSignOut();
    showGate();
  }
});

// Every answer in the profile counts the moment it is given, there is no save button.
const saveProfileChange = (event) => {
  const form = event.target.closest?.('#profile');
  if (form) saveFromForm(form);
};
app.addEventListener('change', (event) => {
  saveProfileChange(event);
  if (event.target.matches?.('select[data-extra]')) changeAmount(event.target);
  if (event.target.name === 'pantryGrams') setPantryGrams(event.target);
  const file = event.target.files?.[0];
  if (file) {
    const readers = {
      fridgePhoto: readFridgePhoto,
      dishPhoto: readDishPhoto,
      recipePhoto: importRecipePhoto,
    };
    readers[event.target.id]?.(file);
  }
  if (event.target.closest?.('#profile')) {
    updateBlocks();
    if (event.target.name === 'cookDays') redrawKeepingPlace();
  }
});
app.addEventListener('input', (event) => {
  saveProfileChange(event);
  if (event.target.closest?.('#foodLogForm')) keepFoodDraft(event.target.value);
  if (event.target.name === 'shapeWish') keepShapeWish(event.target.value);
  if (event.target.name === 'scanGrams') setScanGrams(event.target.value);
  if (event.target.matches?.('#foodLogForm textarea')) {
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
  }
  if (event.target.closest?.('#chatForm')) {
    keepDraft(event.target.value);
    // The field grows with the text, up to a few lines.
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 132)}px`;
  }
});

// Return sends, Shift and Return makes a new line.
app.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  const form = event.target.closest?.('#chatForm, #foodLogForm');
  if (!form) return;
  event.preventDefault();
  form.requestSubmit();
});

start();

if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // The app works without offline support; the next start tries again.
  });
}
