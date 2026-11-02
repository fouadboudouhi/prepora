// The shell: four tabs with their empty states. The real screens follow the milestones in PLAN.md.
const TABS = [
  {
    id: 'today',
    label: 'Heute',
    title: 'Heute',
    empty: 'Noch kein Plan. Hier steht bald, was du heute isst.',
  },
  { id: 'plan', label: 'Plan', title: 'Wochenplan', empty: 'Hier entsteht dein Plan für die Woche.' },
  { id: 'shop', label: 'Einkauf', title: 'Einkauf', empty: 'Die Einkaufsliste kommt mit dem ersten Plan.' },
  { id: 'more', label: 'Mehr', title: 'Mehr', empty: 'Ziel, Vorlieben und Konto.' },
];

const app = document.getElementById('app');

function show(id) {
  const tab = TABS.find((entry) => entry.id === id) ?? TABS[0];
  app.innerHTML = `
    <main class="page"><h1>${tab.title}</h1><p>${tab.empty}</p></main>
    <nav class="tabs" aria-label="Bereiche">
      ${TABS.map(
        (entry) =>
          `<button type="button" data-tab="${entry.id}"${entry.id === tab.id ? ' aria-current="page"' : ''}>${entry.label}</button>`
      ).join('')}
    </nav>`;
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (button) show(button.dataset.tab);
});

show('today');

if ('serviceWorker' in navigator && location.hostname !== '127.0.0.1') {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // The app works without offline support; the next start tries again.
  });
}
