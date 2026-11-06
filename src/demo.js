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
      cookDays: 2,
      cookWeekday2: 3,
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

const oil = () => food('Olivenöl', 'olivenoel', 40, 'Vorrat', 500, 4.5);
const step = (recipeId, title, detail, timerMinutes = 0, timerName = '') => ({
  recipeId,
  title,
  detail,
  timerMinutes,
  timerName,
});

// Two cook days, three dishes each: Sunday for the start of the week, Wednesday for the rest.
const FIRST = [
  {
    id: 'chili',
    name: 'Chili con Carne mit Reis',
    fridgeDays: 4,
    freezes: true,
    reheat: '3 Minuten Mikrowelle, einmal umrühren',
    twists: ['Mit Limette und Koriander', 'Mit einem Klecks Skyr'],
    ingredients: [
      oil(),
      food('Rinderhack mager', 'rinderhack_mager', 560, 'Fleisch und Fisch', 500, 4.5),
      food('Kidneybohnen', 'kidneybohnen_dose', 600, 'Vorrat', 400, 0.9),
      food('Mais', 'mais_dose', 210, 'Vorrat', 280, 0.9),
      food('Gehackte Tomaten', 'tomaten_dose', 600, 'Vorrat', 400, 0.7),
      food('Zwiebeln', 'zwiebeln', 190, 'Gemüse und Obst', 1000, 1.3),
      food('Paprika', 'paprika', 220, 'Gemüse und Obst', 500, 2.5),
      food('Reis', 'reis', 640, 'Vorrat', 1000, 1.9),
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
      oil(),
      food('Hähnchenbrust', 'haehnchenbrust', 680, 'Fleisch und Fisch', 600, 6.5),
      food('Kokosmilch light', 'kokosmilch', 300, 'Vorrat', 400, 1.8),
      food('Currypaste', 'currypaste', 30, 'Vorrat', 110, 2.3),
      food('Brokkoli', 'brokkoli', 380, 'Gemüse und Obst', 500, 1.8),
      food('Basmatireis', 'basmatireis', 640, 'Vorrat', 1000, 2.5),
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
      oil(),
      food('Putenbrust', 'putenbrust', 490, 'Fleisch und Fisch', 450, 5.5),
      food('Vollkornnudeln', 'vollkornnudeln', 520, 'Vorrat', 500, 1.3),
      food('Zucchini', 'zucchini', 300, 'Gemüse und Obst', 500, 1.5),
      food('Kirschtomaten', 'tomaten', 220, 'Gemüse und Obst', 250, 1.6),
      food('Feta', 'feta', 150, 'Kühlregal', 200, 1.9),
    ],
  },
];
const SECOND = [
  {
    id: 'teriyaki',
    name: 'Teriyaki-Hähnchen mit Reis und Brokkoli',
    fridgeDays: 4,
    freezes: true,
    reheat: '2 Minuten Mikrowelle, Sesam frisch darüber',
    twists: ['Mit Frühlingszwiebeln', 'Mit Chiliflocken'],
    ingredients: [
      oil(),
      food('Hähnchenschenkel ohne Haut', 'haehnchenschenkel', 930, 'Tiefkühl', 1000, 6.9),
      food('Sojasauce', 'sojasauce', 100, 'Vorrat', 250, 1.9),
      food('Honig', 'honig', 50, 'Vorrat', 500, 3.5),
      food('Sesam', 'sesam', 20, 'Vorrat', 250, 1.6),
      food('Brokkoli', 'brokkoli', 580, 'Tiefkühl', 750, 1.9),
      food('Reis', 'reis', 980, 'Vorrat', 1000, 1.9),
    ],
  },
  {
    id: 'dal',
    name: 'Rotes Linsen-Dal mit Spinat',
    fridgeDays: 5,
    freezes: true,
    reheat: '3 Minuten Mikrowelle, mit Joghurt servieren',
    twists: ['Mit griechischem Joghurt', 'Mit Zitrone'],
    ingredients: [
      oil(),
      food('Rote Linsen', 'rote_linsen', 580, 'Vorrat', 500, 2.2),
      food('Kokosmilch light', 'kokosmilch', 460, 'Vorrat', 400, 1.8),
      food('Gehackte Tomaten', 'tomaten_dose', 460, 'Vorrat', 400, 0.7),
      food('Blattspinat', 'spinat', 520, 'Tiefkühl', 450, 1.5),
      food('Basmatireis', 'basmatireis', 700, 'Vorrat', 1000, 2.5),
      food('Griechischer Joghurt', 'griechischer_joghurt', 350, 'Kühlregal', 500, 2.3),
    ],
  },
  {
    id: 'bowl',
    name: 'Rinder-Bowl mit Süßkartoffel',
    fridgeDays: 4,
    freezes: true,
    reheat: '3 Minuten Mikrowelle oder 8 Minuten Airfryer',
    twists: ['Mit Avocado-Creme', 'Mit eingelegten Zwiebeln'],
    ingredients: [
      oil(),
      food('Rinderhack mager', 'rinderhack_mager', 870, 'Tiefkühl', 500, 4.5),
      food('Süßkartoffeln', 'suesskartoffeln', 1390, 'Gemüse und Obst', 1000, 2.5),
      food('Kichererbsen', 'kichererbsen_dose', 560, 'Vorrat', 240, 0.8),
      food('Paprika', 'paprika', 350, 'Gemüse und Obst', 500, 2.5),
    ],
  },
];

const dayOf = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;

// Answers like Claude does: each portion comes from the last cook day before it and only while it keeps or freezes.
function plan(request) {
  const text = request.messages[0].content;
  const slots = [...text.matchAll(/^(\d+-\S+): (\d{4}-\d{2}-\d{2}), /gm)].map((match) => ({
    slot: match[1],
    date: match[2],
  }));
  const cookDates = (text.match(/Kochtage: ([^,]+),/)?.[1] ?? '').match(/\d{4}-\d{2}-\d{2}/g) ?? [
    new Date().toISOString().slice(0, 10),
  ];
  const groups = cookDates.map((date, index) => ({
    date,
    recipes: (index === 0 || cookDates.length === 1 ? FIRST : SECOND).map((recipe) => ({
      ...recipe,
      cookDate: date,
    })),
  }));
  // With one cook day the whole week comes from it, so the second batch of dishes joins the first.
  if (groups.length === 1)
    groups[0].recipes.push(...SECOND.map((recipe) => ({ ...recipe, cookDate: cookDates[0] })));
  const turns = new Map();
  const assignments = slots.map(({ slot, date }) => {
    const group = groups.filter((entry) => dayOf(entry.date) < dayOf(date)).at(-1) ?? groups[0];
    const age = dayOf(date) - dayOf(group.date);
    const fits = group.recipes.filter((recipe) => recipe.fridgeDays >= age || recipe.freezes);
    const turn = turns.get(group.date) ?? 0;
    turns.set(group.date, turn + 1);
    return { slot, recipeId: fits[turn % fits.length].id };
  });
  const used = new Set(assignments.map((entry) => entry.recipeId));
  return {
    recipes: groups.flatMap((group) => group.recipes).filter((recipe) => used.has(recipe.id)),
    assignments,
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
    cookDays: groups.map((group, index) =>
      index === 0
        ? {
            date: group.date,
            minutes: 90,
            steps: [
              step('', 'Alles bereitlegen', 'Zwiebeln, Paprika, Zucchini und Brokkoli schneiden.'),
              step(
                'chili',
                'Chili ansetzen',
                'Hack krümelig anbraten, Zwiebeln und Paprika dazu, Tomaten und Bohnen einrühren.',
                35,
                'Chili'
              ),
              step('curry', 'Reis aufsetzen', 'Reis und Basmati in zwei Töpfen kochen.', 15, 'Reis'),
              step(
                'curry',
                'Curry kochen',
                'Hähnchen anbraten, Currypaste und Kokosmilch dazu, Brokkoli in den letzten 6 Minuten.',
                20,
                'Curry'
              ),
              step(
                'pasta',
                'Pasta kochen',
                'Nudeln bissfest, Pute und Zucchini in der Pfanne, alles mischen, Feta darüber.',
                10,
                'Nudeln'
              ),
              step('', 'Portionieren', 'In Boxen abkühlen lassen und beschriften.'),
            ],
          }
        : {
            date: group.date,
            minutes: 75,
            steps: [
              step(
                'bowl',
                'Süßkartoffeln in den Ofen',
                'Würfeln, mit Öl und Paprika mischen, bei 200 °C rösten.',
                30,
                'Ofen'
              ),
              step(
                'dal',
                'Dal ansetzen',
                'Linsen mit Tomaten und Kokosmilch köcheln, Spinat am Ende unterrühren.',
                20,
                'Dal'
              ),
              step(
                'teriyaki',
                'Teriyaki braten',
                'Hähnchen anbraten, Sojasauce und Honig einkochen, Sesam darüber.',
                12,
                'Teriyaki'
              ),
              step('bowl', 'Hack und Kichererbsen', 'Krümelig braten, Kichererbsen mitrösten.', 8, 'Pfanne'),
              step('', 'Portionieren', 'In Boxen abkühlen lassen, die letzten Tage in den Tiefkühler.'),
            ],
          }
    ),
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
