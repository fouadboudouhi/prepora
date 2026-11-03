// The shell: sign-in with the Volumora account, then four tabs. The real screens follow the milestones in PLAN.md.
import { GOALS, dailyTargets } from './nutrition.js';
import { getProfile } from './profile.js';
import { profileView, saveFromForm, showTargets, targetText } from './profileView.js';
import { SessionError, getSession, refreshMe, signIn, signOut } from './session.js';

const TABS = [
  { id: 'today', label: 'Heute', title: 'Heute', empty: '' },
  { id: 'plan', label: 'Plan', title: 'Wochenplan', empty: 'Hier entsteht dein Plan für die Woche.' },
  { id: 'shop', label: 'Einkauf', title: 'Einkauf', empty: 'Die Einkaufsliste kommt mit dem ersten Plan.' },
  { id: 'more', label: 'Mehr', title: 'Mehr', empty: '' },
];
const ERRORS = {
  user: 'Benutzername oder Passwort stimmt nicht.',
  network: 'Der Server ist gerade nicht erreichbar.',
  blocked: 'Zu viele Versuche. Bitte in zehn Minuten nochmal.',
  budget: 'Das Claude-Budget für diesen Monat ist aufgebraucht.',
  noai: 'Auf dem Server ist kein Claude-Schlüssel hinterlegt.',
  server: 'Beim Server ist etwas schiefgelaufen.',
};
const errorText = (err) => ERRORS[err instanceof SessionError ? err.code : 'server'] ?? ERRORS.server;
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (value) => `${Number(value).toFixed(2).replace('.', ',')} $`;

const app = document.getElementById('app');
let current = 'today';

function aiLine(ai) {
  if (!ai) return 'Wird geprüft';
  if (!ai.available) return ERRORS.noai;
  return `${money(ai.used)} von ${money(ai.budget)} diesen Monat`;
}

function todayView() {
  const profile = getProfile();
  const targets = dailyTargets(profile);
  if (!targets)
    return `
      <div class="card">
        <h2>Was ist dein Ziel?</h2>
        <p>Daraus berechnet Prepora deine Kalorien und dein Eiweiß.</p>
        <button type="button" class="primary" data-tab="profile">Profil ausfüllen</button>
      </div>`;
  return `
    <div class="list">
      <button type="button" class="row" data-tab="profile" id="todayTargets">
        <span>${esc(GOALS[profile.goal].label)}</span><span class="muted">${esc(targetText(targets))}</span>
      </button>
    </div>
    <p class="note">Noch kein Plan. Hier steht bald, was du heute isst.</p>`;
}

function moreView() {
  const session = getSession();
  return `
    <div class="list">
      <button type="button" class="row" data-tab="profile" id="openProfile"><span>Profil</span><span class="muted">Ziel, Körper, Kochen, Essen</span></button>
      <div class="row"><span>Konto</span><span class="muted" id="accountName">${esc(session.username)}</span></div>
      <div class="row"><span>Claude</span><span class="muted" id="aiLine">${esc(aiLine(session.ai))}</span></div>
    </div>
    <button type="button" class="secondary" id="signOut">Abmelden</button>`;
}

const VIEWS = { today: todayView, more: moreView };

function showTab(id) {
  current = id;
  // The profile opens from Mehr and Heute and stays in the Mehr tab.
  const active = id === 'profile' ? 'more' : id;
  const tab = TABS.find((entry) => entry.id === active) ?? TABS[0];
  const content =
    id === 'profile' ? profileView() : `<h1>${tab.title}</h1>${VIEWS[tab.id]?.() ?? `<p>${tab.empty}</p>`}`;
  app.innerHTML = `
    <main class="page">${content}</main>
    <nav class="tabs" aria-label="Bereiche">
      ${TABS.map(
        (entry) =>
          `<button type="button" data-tab="${entry.id}"${entry.id === tab.id ? ' aria-current="page"' : ''}>${entry.label}</button>`
      ).join('')}
    </nav>`;
  window.scrollTo(0, 0);
  showTargets();
}

function showGate() {
  app.innerHTML = `
    <main class="page gate">
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

function refreshAccount() {
  refreshMe()
    .then(() => {
      if (current === 'more') showTab('more');
    })
    .catch((err) => {
      if (!getSession()) showGate();
      else if (current === 'more' && document.getElementById('aiLine'))
        document.getElementById('aiLine').textContent = errorText(err);
    });
}

function start() {
  if (!getSession()) return showGate();
  showTab('today');
  refreshAccount();
}

app.addEventListener('submit', async (event) => {
  if (event.target.id !== 'signIn') return;
  event.preventDefault();
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
});

app.addEventListener('click', async (event) => {
  const tab = event.target.closest('[data-tab]');
  if (tab) {
    showTab(tab.dataset.tab);
    if (tab.dataset.tab === 'more') refreshAccount();
    return;
  }
  if (event.target.closest('#signOut')) {
    await signOut();
    showGate();
    return;
  }
});

// Every answer counts the moment it is given, there is no save button.
const saveProfileChange = (event) => {
  const form = event.target.closest?.('#profile');
  if (form) saveFromForm(form);
};
app.addEventListener('change', saveProfileChange);
app.addEventListener('input', saveProfileChange);

start();

if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // The app works without offline support; the next start tries again.
  });
}
