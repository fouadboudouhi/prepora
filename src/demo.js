// The demo: the real app without an account. Everything stays in this tab, nothing reaches the server, and Claude is
// played by prepared answers, so a visitor can make a week, shop and cook without costs and without seeing anyone's data.
import { SERVER_URL } from './session.js';

// The tab's own storage stands in for the device storage: the demo never mixes with a real Prepora or Volumora
// on this domain, and closing the tab forgets it.
Object.defineProperty(window, 'localStorage', { value: window.sessionStorage, configurable: true });

if (!localStorage.getItem('prepora-session')) {
  localStorage.setItem(
    'prepora-session',
    JSON.stringify({ url: SERVER_URL, username: 'demo', token: 'demo.local' })
  );
  localStorage.setItem(
    'prepora-profile',
    JSON.stringify({
      goal: 'muscle',
      sex: 'male',
      age: 30,
      height: 180,
      weight: 80,
      activity: 'medium',
      meals: ['Mittagessen', 'Abendessen'],
    })
  );
}

const food = (name, id, grams, category, packGrams, packEuro, per100 = [0, 0, 0, 0]) => ({
  name,
  food: id,
  grams,
  category,
  packGrams,
  packEuro,
  per100: { kcal: per100[0], protein: per100[1], fat: per100[2], carbs: per100[3] },
});

const RECIPES = [
  {
    id: 'chili',
    name: 'Chili con Carne mit Reis',
    fridgeDays: 4,
    freezes: true,
    reheat: '3 Minuten Mikrowelle, einmal umrühren',
    twists: ['Mit Limette und Koriander', 'Mit einem Klecks Skyr'],
    ingredients: [
      food('Olivenöl', 'olivenoel', 80, 'Vorrat', 500, 4.5),
      food('Rinderhack mager', 'rinderhack_mager', 1450, 'Fleisch und Fisch', 500, 4.5),
      food('Kidneybohnen', 'kidneybohnen_dose', 1150, 'Vorrat', 400, 0.9),
      food('Mais', 'mais_dose', 400, 'Vorrat', 280, 0.9),
      food('Gehackte Tomaten', 'tomaten_dose', 1150, 'Vorrat', 400, 0.7),
      food('Zwiebeln', 'zwiebeln', 450, 'Gemüse und Obst', 1000, 1.3),
      food('Paprika', 'paprika', 600, 'Gemüse und Obst', 500, 2.5),
      food('Reis', 'reis', 1700, 'Vorrat', 1000, 1.9),
    ],
  },
  {
    id: 'curry',
    name: 'Hähnchen-Curry mit Basmati',
    fridgeDays: 4,
    freezes: true,
    reheat: '2–3 Minuten Mikrowelle, etwas Wasser dazu',
    twists: ['Mit frischem Spinat', 'Mit gerösteten Cashews'],
    ingredients: [
      food('Olivenöl', 'olivenoel', 80, 'Vorrat', 500, 4.5),
      food('Hähnchenbrust', 'haehnchenbrust', 1750, 'Fleisch und Fisch', 600, 6.5),
      food('Kokosmilch light', 'kokosmilch', 600, 'Vorrat', 400, 1.8),
      food('Currypaste', 'currypaste', 60, 'Vorrat', 110, 2.3),
      food('Brokkoli', 'brokkoli', 850, 'Gemüse und Obst', 500, 1.8),
      food('Basmatireis', 'basmatireis', 1700, 'Vorrat', 1000, 2.5),
    ],
  },
  {
    id: 'pasta',
    name: 'Pute-Gemüse-Pasta mit Feta',
    fridgeDays: 3,
    freezes: false,
    reheat: '2 Minuten Mikrowelle oder kalt als Salat',
    twists: ['Mit Basilikum-Pesto'],
    ingredients: [
      food('Olivenöl', 'olivenoel', 80, 'Vorrat', 500, 4.5),
      food('Putenbrust', 'putenbrust', 1300, 'Fleisch und Fisch', 450, 5.5),
      food('Vollkornnudeln', 'vollkornnudeln', 1400, 'Vorrat', 500, 1.3),
      food('Zucchini', 'zucchini', 700, 'Gemüse und Obst', 500, 1.5),
      food('Kirschtomaten', 'tomaten', 600, 'Gemüse und Obst', 250, 1.6),
      food('Feta', 'feta', 300, 'Kühlregal', 200, 1.9),
    ],
  },
];

// Answers like Claude does: one portion per slot the request lists, all cooked on the first cook day.
function plan(request) {
  const text = request.messages[0].content;
  const slots = [...text.matchAll(/^(\d+-\S+): (\d{4}-\d{2}-\d{2}), /gm)].map((match) => match[1]);
  const start = text.match(/Kochtage: (\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().slice(0, 10);
  return {
    recipes: RECIPES.map((recipe) => ({ ...recipe, cookDate: start })),
    // The pasta keeps three days and does not freeze, so it only comes early in the week.
    assignments: slots.map((slot, index) => {
      const fits = Number(slot.split('-')[0]) <= 3 ? RECIPES : RECIPES.filter((recipe) => recipe.freezes);
      return { slot, recipeId: fits[index % fits.length].id };
    }),
    fillers: [
      {
        id: 'quark',
        name: 'Quark mit Banane und Erdnussbutter',
        when: 'Snack',
        servings: 7,
        ingredients: [
          food('Magerquark', 'magerquark', 1750, 'Kühlregal', 500, 0.9),
          food('Bananen', 'banane', 840, 'Gemüse und Obst', 1000, 1.8),
          food('Erdnussbutter', 'erdnussbutter', 140, 'Vorrat', 350, 2.9),
        ],
      },
      {
        id: 'skyr',
        name: 'Skyr mit Haferflocken und Beeren',
        when: 'Frühstück',
        servings: 7,
        ingredients: [
          food('Skyr', 'skyr', 1750, 'Kühlregal', 500, 1.5),
          food('Haferflocken', 'haferflocken', 350, 'Vorrat', 500, 0.9),
          food('Beeren', 'beeren_tk', 700, 'Tiefkühl', 750, 3.5),
        ],
      },
    ],
    cookDays: [
      {
        date: start,
        minutes: 100,
        steps: [
          {
            recipeId: '',
            title: 'Alles bereitlegen',
            detail: 'Zwiebeln, Paprika, Zucchini und Brokkoli schneiden.',
            timerMinutes: 0,
            timerName: '',
          },
          {
            recipeId: 'chili',
            title: 'Chili ansetzen',
            detail: 'Hack krümelig anbraten, Zwiebeln und Paprika dazu, Tomaten und Bohnen einrühren.',
            timerMinutes: 35,
            timerName: 'Chili',
          },
          {
            recipeId: 'curry',
            title: 'Reis aufsetzen',
            detail: 'Reis und Basmati in zwei Töpfen kochen.',
            timerMinutes: 15,
            timerName: 'Reis',
          },
          {
            recipeId: 'curry',
            title: 'Curry kochen',
            detail: 'Hähnchen anbraten, Currypaste und Kokosmilch dazu, Brokkoli in den letzten 6 Minuten.',
            timerMinutes: 20,
            timerName: 'Curry',
          },
          {
            recipeId: 'pasta',
            title: 'Pasta kochen',
            detail: 'Nudeln bissfest, Pute und Zucchini in der Pfanne, alles mischen, Feta darüber.',
            timerMinutes: 10,
            timerName: 'Nudeln',
          },
          {
            recipeId: '',
            title: 'Portionieren',
            detail: 'In Boxen abkühlen lassen, beschriften, die späteren Tage in den Tiefkühler.',
            timerMinutes: 0,
            timerName: '',
          },
        ],
      },
    ],
  };
}

// Everything else that asks for a fixed format gets a fitting example.
const EXAMPLES = {
  items: { items: ['Paprika', 'Magerquark', 'Eier', 'Spinat'] },
  assumption: {
    goal: 'muscle',
    activity: 'medium',
    reason: 'Du willst Muskeln aufbauen und trainierst drei- bis viermal pro Woche.',
    assumption: 'In der Demo ist das ein Beispiel; in der App antwortet Claude auf deinen Text.',
  },
  kcalLow: {
    isFood: true,
    dish: 'Lasagne',
    confidence: 'mittel',
    reason: '',
    portion: 'Normale Portion',
    kcalLow: 600,
    kcalHigh: 800,
    protein: 30,
    components: ['Nudelplatten', 'Hackfleisch', 'Käse'],
  },
  recommended: {
    recommended: [
      {
        name: 'Kreatin',
        dose: '3 g',
        when: 'Täglich',
        why: 'Gut belegt für Kraft und Muskelaufbau.',
        evidence: 'stark',
        caution: '',
      },
      {
        name: 'Vitamin D',
        dose: '1000 IE',
        when: 'Im Winter',
        why: 'Wenig Sonne in den Wintermonaten.',
        evidence: 'mittel',
        caution: 'Am besten vorher den Wert messen lassen.',
      },
    ],
    notNeeded: [{ name: 'BCAA', why: 'Mit genug Eiweiß aus dem Essen bringen sie nichts dazu.' }],
    note: 'Beispielantwort der Demo.',
  },
  found: {
    found: true,
    name: 'Omas Gulasch',
    servings: 4,
    fridgeDays: 4,
    freezes: true,
    reheat: '3 Minuten Mikrowelle',
    ingredients: [
      food('Rindfleisch', 'rindfleisch', 800, 'Fleisch und Fisch', 500, 7),
      food('Zwiebeln', 'zwiebeln', 400, 'Gemüse und Obst', 1000, 1.3),
      food('Paprika', 'paprika', 300, 'Gemüse und Obst', 500, 2.5),
    ],
    steps: ['Fleisch scharf anbraten', 'Zwiebeln dazu, mit Paprika würzen', 'Zwei Stunden schmoren'],
  },
};
const DEMO_TEXT =
  'Das ist die Demo: Hier antworte ich mit vorbereiteten Texten. In der App kann ich deinen Plan ändern, ' +
  'Gerichte tauschen, dein Profil anpassen und Fragen beim Kochen beantworten.';

const sse = (events) => events.map((event) => `data: ${JSON.stringify(event)}`).join('\n') + '\n';
const textStream = (text) =>
  sse([
    { type: 'message_start', message: {} },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ]);

function claude(asked) {
  if (asked.tools?.length) return textStream(DEMO_TEXT);
  const required = asked.output_config?.format?.schema?.required ?? [];
  if (required.includes('assignments')) return textStream(JSON.stringify(plan(asked)));
  const example = Object.keys(EXAMPLES).find((key) => required.includes(key));
  return textStream(example ? JSON.stringify(EXAMPLES[example]) : DEMO_TEXT);
}

const json = (status, value, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function answer(path, method, body) {
  if (path === '/v1/login') return json(200, { token: 'demo.local' });
  if (path === '/v1/logout') return json(200, { ok: true });
  if (path === '/v1/me')
    return json(200, { username: 'demo', ai: { available: true, budget: 5, used: 0, month: '' } });
  if (path === '/v1/apps/prepora/snapshot' && method === 'PUT')
    return json(200, { version: 'demo' }, { etag: '"demo"' });
  if (path === '/v1/ai/messages') {
    // A short pause, so the app shows what it does while Claude works.
    await wait(1500);
    return new Response(claude(JSON.parse(body)), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }
  // No Volumora data, no stored copy, no push in the demo.
  return json(404, { error: 'demo' });
}

// Every call to the server is answered here; none ever leaves the browser.
const realFetch = window.fetch.bind(window);
window.fetch = (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith(SERVER_URL)) return realFetch(input, init);
  return answer(new URL(url).pathname, init.method ?? 'GET', init.body);
};

await import('./app.js');
