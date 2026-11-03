// The shell: sign-in with the Volumora account, four tabs, and the full-screen cook day above them.
import { applyTrend, getStock, updateBlocks } from './actions.js';
import { askHelper, cookActions, cookView, cooking, startTicking } from './cookView.js';
import { planActions, planView, readFridgePhoto } from './planView.js';
import { photoActions, photoView, readDishPhoto, recheckDish } from './photoView.js';
import { saveFromForm, profileActions, profileView, showTargets } from './profileView.js';
import { importRecipe, importRecipePhoto, recipeActions, recipesView } from './recipesView.js';
import { icon } from './icons.js';
import { pushOn } from './push.js';
import { getSession, refreshMe, signIn, signOut } from './session.js';
import { shopActions, shopView } from './shopView.js';
import { addStock, stockActions, stockView } from './stockView.js';
import { addSupplement, supplementActions, supplementsView } from './supplementsView.js';
import { clearAfterSignOut, startSync, syncNow } from './sync.js';
import { tasteActions, tasteView } from './tasteView.js';
import { todayActions, todayView } from './todayView.js';
import { errorText, esc, number, setOpener, setRedraw } from './ui.js';
import { updateFromVolumora } from './volumora.js';

const TABS = [
  { id: 'today', label: 'Heute', title: 'Heute', view: todayView },
  { id: 'plan', label: 'Plan', title: 'Wochenplan', view: planView },
  { id: 'shop', label: 'Einkauf', title: 'Einkauf', view: shopView },
  { id: 'more', label: 'Mehr', title: 'Mehr', view: moreView },
];
// Screens that open from a tab and keep it lit. They bring their own title and way back.
const SUB_VIEWS = {
  profile: profileView,
  stock: stockView,
  taste: tasteView,
  supplements: supplementsView,
  recipes: recipesView,
  photo: photoView,
};
const ACTIONS = {
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
    tab: 'stock',
    id: 'openStock',
    icon: 'snow',
    label: 'Tiefkühler',
    hint: () => {
      const portions = getStock().reduce((sum, item) => sum + item.portions, 0);
      return `${number(portions)} ${portions === 1 ? 'Portion' : 'Portionen'}`;
    },
  },
];

const money = (value) => `${Number(value).toFixed(2).replace('.', ',')} $`;
const app = document.getElementById('app');
let current = 'today';

function aiLine(ai) {
  if (!ai) return 'Wird geprüft';
  if (!ai.available) return 'Kein Schlüssel auf dem Server';
  return `${money(ai.used)} von ${money(ai.budget)} diesen Monat`;
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
      <div class="row"><span>Erinnerungen</span><span class="muted" id="pushLine">${pushOn() ? 'An' : 'Gehen beim ersten Kochtag an'}</span></div>
    </div>
    <button type="button" class="secondary" id="signOut">Abmelden</button>`;
}

function draw() {
  if (!getSession()) return showGate();
  if (cooking()) {
    const page = cookView();
    if (page) {
      app.innerHTML = page;
      startTicking();
      return;
    }
  }
  const sub = SUB_VIEWS[current];
  const lit = current === 'photo' ? 'today' : sub ? 'more' : current;
  const tab = TABS.find((entry) => entry.id === lit) ?? TABS[0];
  const content = sub ? sub() : `<h1>${tab.title}</h1>${tab.view()}`;
  app.innerHTML = `
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
  current = id;
  draw();
  window.scrollTo(0, 0);
}

function showGate() {
  app.innerHTML = `
    <main class="page gate">
      <img class="gate-icon" src="assets/icons/icon-192.png" alt="" width="64" height="64">
      <h1>Prepora</h1>
      <p>Melde dich mit deinem Volumora-Konto an.</p>
      <form id="signIn" novalidate>
        <label>Benutzername
          <input id="username" type="text" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="32" required>
        </label>
        <label>Passwort
          <input id="password" type="password" name="password" autocomplete="current-password" required>
        </label>
        <p class="error" id="signInError" role="alert" hidden></p>
        <button type="submit" class="primary" id="signInButton">Anmelden</button>
      </form>
      <p class="note">Noch kein Konto? <a href="../volumora/">Mit Einladung in Volumora registrieren</a></p>
    </main>`;
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
      if (applyTrend() || changed) redrawKeepingPlace();
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
setOpener(open);

const FORMS = {
  async signIn() {
    const error = document.getElementById('signInError');
    const button = document.getElementById('signInButton');
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!username || !password) {
      error.textContent = 'Bitte beides ausfüllen.';
      error.hidden = false;
      return;
    }
    button.disabled = true;
    error.hidden = true;
    try {
      await signIn(username, password);
      start();
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
      button.disabled = false;
    }
  },
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
app.addEventListener('input', saveProfileChange);

start();

if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // The app works without offline support; the next start tries again.
  });
}
