// End-to-end smoke tests against the real app in Chromium. Run with `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright');
const { createServer } = require('./serve.js');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const SERVER = 'https://raspberrypi.tail9d7f95.ts.net';

let server, browser, baseURL;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

// The Volumora server as the app sees it: every call is noted, so a test can say what must never happen.
const FAKE_FOOD = (name, food, grams, category, packGrams) => ({
  name,
  food,
  grams,
  category,
  packGrams,
  per100: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
});
// Answers like Claude does, in as many portions as the request lists.
function fakePlan(request) {
  const text = request.messages[0].content;
  const slots = [...text.matchAll(/^(\d+-\S+): (\d{4}-\d{2}-\d{2}), /gm)].map((match) => ({
    slot: match[1],
    day: Number(match[1].split('-')[0]),
  }));
  const start = text.match(/Kochtage: (\d{4}-\d{2}-\d{2})/)[1];
  const assignments = slots.map(({ slot, day }) => ({ slot, recipeId: day % 2 ? 'chili' : 'bowl' }));
  return {
    recipes: [
      {
        id: 'chili',
        name: 'Chili con Carne',
        cookDate: start,
        fridgeDays: 4,
        freezes: true,
        reheat: '3 Minuten Mikrowelle',
        ingredients: [
          FAKE_FOOD('Rinderhack', 'rinderhack_mager', 1400, 'Fleisch und Fisch', 500),
          FAKE_FOOD('Kidneybohnen', 'kidneybohnen_dose', 1500, 'Vorrat', 400),
          FAKE_FOOD('Reis', 'reis', 800, 'Vorrat', 1000),
        ],
      },
      {
        id: 'bowl',
        name: 'Hähnchen-Reis-Bowl',
        cookDate: start,
        fridgeDays: 4,
        freezes: true,
        reheat: '2 Minuten Mikrowelle',
        ingredients: [
          FAKE_FOOD('Hähnchenbrust', 'haehnchenbrust', 1600, 'Fleisch und Fisch', 600),
          FAKE_FOOD('Reis', 'reis', 800, 'Vorrat', 1000),
          FAKE_FOOD('Exotische Sauce', '', 200, 'Kühlregal', 0),
        ],
      },
    ],
    assignments,
    cookDays: [
      {
        date: start,
        minutes: 90,
        steps: [
          { recipeId: '', title: 'Ofen an', detail: '200 °C.', timerMinutes: 0, timerName: '' },
          {
            recipeId: 'bowl',
            title: 'Reis aufsetzen',
            detail: 'Quellen lassen.',
            timerMinutes: 12,
            timerName: 'Reis',
          },
          {
            recipeId: 'chili',
            title: 'Hack anbraten',
            detail: 'Durchgaren.',
            timerMinutes: 30,
            timerName: 'Chili',
          },
          {
            recipeId: '',
            title: 'Portionieren',
            detail: 'In Boxen abkühlen lassen.',
            timerMinutes: 0,
            timerName: '',
          },
        ],
      },
    ],
  };
}
const streamOf = (text) =>
  [
    `data: ${JSON.stringify({ type: 'message_start', message: {} })}`,
    `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}`,
    `data: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })}`,
    '',
  ].join('\n');

async function open({
  colorScheme = 'light',
  storage = {},
  claude = 200,
  snapshot = null,
  appData = null,
} = {}) {
  const context = await browser.newContext({ locale: 'de-DE', colorScheme });
  await context.addInitScript((entries) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    Object.entries(entries).forEach(([key, value]) => localStorage.setItem(key, JSON.stringify(value)));
  }, storage);
  const calls = [];
  await context.route(`${SERVER}/**`, async (route) => {
    const request = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(request.url()).pathname;
    calls.push({
      method: request.method(),
      path,
      auth: request.headers().authorization,
      body: request.postData(),
    });
    const reply = (status, value) => route.fulfill({ status, headers: cors, json: value });
    if (path === '/v1/login') {
      const { username, password } = JSON.parse(request.postData());
      return username === 'fouad' && password === 'richtiges-passwort'
        ? reply(200, { token: 'fouad.neu' })
        : reply(401, { error: 'user' });
    }
    if (path === '/v1/logout') return reply(200, { ok: true });
    if (request.headers().authorization === 'Bearer abgelaufen.x') return reply(401, { error: 'session' });
    if (path === '/v1/me')
      return reply(200, {
        username: 'fouad',
        ai: { available: true, budget: 5, used: 0.12, month: '2026-11' },
      });
    if (path === '/v1/ai/messages') {
      if (claude !== 200) return reply(claude, { error: 'budget' });
      const asked = JSON.parse(request.postData());
      const isPlan = asked.output_config?.format?.schema?.required?.includes('assignments');
      const isPhoto = asked.output_config?.format?.schema?.required?.includes('items');
      const text = isPlan
        ? JSON.stringify(fakePlan(asked))
        : isPhoto
          ? JSON.stringify({ items: ['Paprika', 'Quark'] })
          : 'Nimm Petersilie.';
      return route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'text/event-stream' },
        body: streamOf(text),
      });
    }
    if (path === '/v1/snapshot')
      return request.method() === 'GET' && snapshot
        ? reply(200, snapshot)
        : reply(request.method() === 'GET' ? 404 : 500, { error: 'nope' });
    if (path === '/v1/apps/prepora/snapshot') {
      if (request.method() === 'PUT') {
        return route.fulfill({ status: 200, headers: { ...cors, etag: '"v2"' }, json: { version: 'v2' } });
      }
      return appData
        ? route.fulfill({
            status: 200,
            headers: { ...cors, etag: '"server1"', 'access-control-expose-headers': 'etag' },
            json: appData,
          })
        : reply(404, { error: 'nothing stored yet' });
    }
    return reply(404, { error: 'not found' });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL);
  return { context, page, errors, calls };
}

const signedIn = { 'prepora-session': { url: SERVER, username: 'fouad', token: 'fouad.alt' } };

async function signIn(page, username = 'fouad', password = 'richtiges-passwort') {
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#signInButton');
}

test('asks for the Volumora account first and opens the app with the right password', async () => {
  const { context, page, errors, calls } = await open();
  assert.equal(await page.locator('h1').innerText(), 'Prepora');
  assert.equal(await page.locator('#username').getAttribute('autocomplete'), 'username');
  assert.equal(await page.locator('#password').getAttribute('autocomplete'), 'current-password');

  await signIn(page);
  await page.waitForSelector('[data-tab="today"]');
  assert.equal(await page.locator('h1').innerText(), 'Heute');
  assert.equal(calls[0].path, '/v1/login');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-session')));
  assert.equal(stored.token, 'fouad.neu');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a wrong password says so and stays on the sign-in', async () => {
  const { context, page } = await open();
  await signIn(page, 'fouad', 'falsch');
  await page.waitForSelector('#signInError:not([hidden])');
  assert.match(await page.locator('#signInError').innerText(), /stimmt nicht/);
  assert.equal(await page.evaluate(() => localStorage.getItem('prepora-session')), null);
  await context.close();
});

test('takes over a sign-in from Volumora in the same browser and leaves it valid on sign-out', async () => {
  const volumora = { url: SERVER, username: 'fouad', token: 'fouad.volumora', version: '1' };
  const { context, page, calls } = await open({ storage: { 'volumora-sync': volumora } });
  await page.waitForSelector('[data-tab="today"]');
  await page.click('[data-tab="more"]');
  assert.equal(await page.locator('#accountName').innerText(), 'fouad');

  await page.click('#signOut');
  await page.waitForSelector('#signIn');
  assert.equal(
    calls.some((call) => call.path === '/v1/logout'),
    false
  );
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('volumora-sync'))), volumora);

  await page.reload();
  await page.waitForSelector('#signIn');
  await context.close();
});

test('ignores a Volumora sign-in the server has already refused', async () => {
  const { context, page } = await open({
    storage: { 'volumora-sync': { url: SERVER, username: 'fouad', token: 'fouad.alt', problem: 'session' } },
  });
  await page.waitForSelector('#signIn');
  await context.close();
});

test('a sign-in the server no longer knows leads back to the sign-in', async () => {
  const { context, page } = await open({
    storage: { 'prepora-session': { url: SERVER, username: 'fouad', token: 'abgelaufen.x' } },
  });
  await page.waitForSelector('#signIn');
  assert.equal(await page.evaluate(() => localStorage.getItem('prepora-session')), null);
  await context.close();
});

test('its own sign-out ends the session on the server', async () => {
  const { context, page, calls } = await open({ storage: signedIn });
  await page.click('[data-tab="more"]');
  await page.click('#signOut');
  await page.waitForSelector('#signIn');
  assert.ok(calls.some((call) => call.path === '/v1/logout' && call.auth === 'Bearer fouad.alt'));
  await context.close();
});

// Asks the way the screens do, without going through one.
const ask = (page) =>
  page.evaluate(async () => {
    const { askClaude } = await import('/src/ai.js');
    return askClaude({ messages: [{ role: 'user', content: 'Hallo' }] }).catch(
      (err) => `Fehler: ${err.code}`
    );
  });

test('Claude goes through the server with the sign-in, no key is involved', async () => {
  const { context, page, calls } = await open({ storage: signedIn });
  await page.click('[data-tab="more"]');
  await page.waitForFunction(() =>
    document.getElementById('aiLine')?.textContent.includes('0,12 $ von 5,00 $')
  );
  assert.equal(await ask(page), 'Nimm Petersilie.');

  const call = calls.find((entry) => entry.path === '/v1/ai/messages');
  assert.equal(call.auth, 'Bearer fouad.alt');
  assert.equal(JSON.parse(call.body).model, 'claude-opus-5-5');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.doesNotMatch(stored, /sk-ant/);
  await context.close();
});

test('an empty budget comes back as its own error', async () => {
  const { context, page } = await open({ storage: signedIn, claude: 402 });
  assert.equal(await ask(page), 'Fehler: budget');
  await context.close();
});

test('the profile saves every answer, shows the targets and survives a reload', async () => {
  const { context, page, errors } = await open({ storage: signedIn });
  await page.click('#app [data-tab="profile"]');
  assert.equal(await page.locator('h1').innerText(), 'Profil');
  assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'), 'more');

  await page.locator('.pill', { hasText: 'Muskelaufbau' }).click();
  await page.fill('[name="age"]', '30');
  await page.fill('[name="height"]', '180');
  await page.fill('[name="weight"]', '80');
  await page.locator('.pill', { hasText: 'Männlich' }).click();
  await page.locator('.pill', { hasText: 'Mittel' }).click();
  await page.locator('.pill', { hasText: 'Zwei' }).click();
  await page.locator('.pill', { hasText: 'Frühstück' }).click();
  await page.locator('.pill', { hasText: 'Keiner' }).click();
  await page.fill('[name="avoid"]', 'Pilze <b>');
  assert.match(await page.locator('#targets').innerText(), /ca\. 3\.\d{3} kcal, 160 g Eiweiß am Tag/);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-profile')));
  assert.equal(saved.goal, 'muscle');
  assert.equal(saved.weight, 80);
  assert.equal(saved.cookDays, 2);
  assert.equal(saved.freezer, false);
  assert.deepEqual(saved.meals, ['Frühstück', 'Mittagessen', 'Abendessen']);

  await page.reload();
  assert.match(await page.locator('#todayTargets').innerText(), /Muskelaufbau[\s\S]*160 g Eiweiß/);
  await page.click('#todayTargets');
  assert.equal(await page.locator('[name="weight"]').inputValue(), '80');
  assert.equal(await page.locator('[name="avoid"]').inputValue(), 'Pilze <b>');
  assert.ok(await page.locator('input[name="freezer"][value="no"]').isChecked());
  await page.click('.back');
  assert.equal(await page.locator('h1').innerText(), 'Mehr');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Heute asks for the profile until it is complete', async () => {
  const { context, page } = await open({ storage: signedIn });
  await page.locator('.card [data-tab="profile"]').click();
  assert.equal(await page.locator('h1').innerText(), 'Profil');
  await context.close();
});

test('a diet at the limit says so', async () => {
  const profile = { goal: 'lose', sex: 'female', age: 40, height: 170, weight: 50, activity: 'low' };
  const { context, page } = await open({ storage: { ...signedIn, 'prepora-profile': profile } });
  await page.click('#todayTargets');
  assert.match(await page.locator('#targets').innerText(), /Untergewicht/);
  await context.close();
});

const person = {
  goal: 'muscle',
  sex: 'male',
  age: 30,
  height: 180,
  weight: 80,
  activity: 'medium',
  meals: ['Mittagessen', 'Abendessen'],
};
const ready = { ...signedIn, 'prepora-profile': person };

test('only ever reads the Volumora data, and writes its own to its own place', async () => {
  const { context, page, calls } = await open({ storage: ready });
  await page.click('[data-tab="plan"]');
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('#weekList');
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem('prepora-sync') ?? '{}').dirty === false,
    null,
    {
      timeout: 8000,
    }
  );
  const plain = calls.filter((call) => call.path.startsWith('/v1/snapshot'));
  assert.ok(plain.every((call) => call.method === 'GET'));
  assert.ok(calls.some((call) => call.method === 'PUT' && call.path === '/v1/apps/prepora/snapshot'));
  const code = fs.readdirSync('src').map((file) => fs.readFileSync(`src/${file}`, 'utf8'));
  const uses = code.flatMap((text) => text.split('\n')).filter((line) => /['"`]\/v1\/snapshot/.test(line));
  assert.equal(uses.length, 1);
  assert.match(uses[0], /call\('\/v1\/snapshot'\)/);
  await context.close();
});

test('weight and training come over from Volumora; a newer weight typed in stays', async () => {
  const at = new Date(Date.now() - 2 * 86400000).toISOString();
  const history = Array.from({ length: 12 }, () => ({ finishedAt: at }));
  const snapshot = { backup: { body: [{ date: at, weight: 83.5 }], history } };
  const { context, page } = await open({
    storage: { ...signedIn, 'prepora-profile': { goal: 'keep' } },
    snapshot,
  });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('prepora-profile')).weight === 83.5);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-profile')));
  assert.equal(saved.activity, 'medium');
  await page.click('[data-tab="more"]');
  await page.click('#openProfile');
  assert.match(await page.locator('#profile').innerText(), /aus Volumora/);
  await page.fill('[name="weight"]', '81');
  await page.locator('h1').click();
  await page.click('.back');
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-profile')).weight), 81);
  await context.close();
});

test('a new device takes over what the server holds', async () => {
  const appData = {
    app: 'Prepora',
    changedAt: new Date().toISOString(),
    data: { profile: person, taste: { likes: ['Fisch'] } },
  };
  const { context, page } = await open({ storage: signedIn, appData });
  await page.waitForSelector('#todayTargets, .card');
  await page.waitForFunction(() => !!localStorage.getItem('prepora-profile'));
  await page.click('[data-tab="more"]');
  await page.click('#openTaste');
  assert.match(await page.locator('.page').innerText(), /Fisch/);
  await context.close();
});

test('from one tap to a week: plan, list, cook day, boxes, freezer, eating, rating', async () => {
  const { context, page, errors, calls } = await open({ storage: ready });
  await page.click('[data-tab="plan"]');
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('#weekList');

  const sent = JSON.parse(calls.find((call) => call.path === '/v1/ai/messages').body);
  assert.equal(sent.stream, true);
  assert.match(sent.messages[0].content, /Muskelaufbau/);
  assert.match(sent.messages[0].content, /Tagesziel einer Person/);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-plan')));
  assert.equal(stored.meals.length, 14);
  assert.ok(stored.meals.every((meal) => meal.recipeId));
  // Cooked once, a week long: what would stand too long goes into the freezer, with a day to thaw it.
  const late = stored.meals.filter((meal) => meal.id.startsWith('6-') || meal.id.startsWith('7-'));
  assert.ok(late.every((meal) => meal.storage === 'freezer' && meal.thawOn));
  assert.ok(
    stored.meals.filter((meal) => meal.id.startsWith('1-')).every((meal) => meal.storage === 'fridge')
  );
  assert.match(await page.locator('#recipeList').innerText(), /teils geschätzt/);

  await page.click('[data-tab="shop"]');
  const list = await page.locator('.page').innerText();
  assert.match(list, /Packung/);
  assert.equal((list.match(/\bReis\b/g) ?? []).length, 1, 'same food is added up');
  await page.locator('.check').first().click();
  assert.match(await page.locator('#shopCount').innerText(), /von/);
  assert.equal(await page.locator('.check').first().getAttribute('aria-pressed'), 'true');

  await page.click('[data-tab="plan"]');
  await page.click('[data-action="startCook"]');
  assert.equal(await page.locator('#stepTitle').innerText(), 'Ofen an');
  assert.equal(await page.locator('.tabs').count(), 0);
  await page.click('#nextStep');
  assert.match(await page.locator('#nextStep').innerText(), /Timer starten, 12 Min/);
  await page.locator('summary').click();
  assert.match(await page.locator('details').innerText(), /g Reis/);
  await page.click('#nextStep');
  assert.match(await page.locator('[data-timer]').first().innerText(), /^(12:00|11:5\d)$/);

  await page.click('[data-action="toggleHelper"]');
  await page.fill('[name="question"]', 'Ich habe keinen Koriander');
  await page.click('#cookHelper button[type="submit"]');
  await page.waitForSelector('.answer');
  assert.match(await page.locator('.answer').innerText(), /Petersilie/);

  await page.reload();
  assert.equal(await page.locator('#stepTitle').innerText(), 'Hack anbraten');
  assert.equal(await page.locator('[data-timer]').count(), 1, 'a timer survives a reload');

  await page.click('#nextStep');
  await page.click('#nextStep');
  const labels = await page.locator('#labels').innerText();
  assert.match(labels, /Tiefkühler/);
  assert.match(labels, /Kühlschrank/);
  await page.click('[data-action="finishCook"]');
  assert.equal(await page.locator('[data-tab="today"]').count(), 1);

  const stock = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-stock')));
  const frozen = stored.meals.filter((meal) => meal.storage === 'freezer').length;
  assert.equal(
    stock.reduce((sum, item) => sum + item.portions, 0),
    frozen
  );
  await page.click('[data-tab="more"]');
  assert.match(await page.locator('#openStock').innerText(), new RegExp(`${frozen} Portionen`));

  // Eating needs a meal for today, so the plan is moved to start yesterday.
  await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem('prepora-plan'));
    const pad = (n) => String(n).padStart(2, '0');
    const at = new Date();
    plan.meals[0].date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    localStorage.setItem('prepora-plan', JSON.stringify(plan));
  });
  await page.click('[data-tab="today"]');
  await page.click('[data-action="eat"]');
  assert.match(await page.locator('.rating').innerText(), /Wie war/);
  await page.locator('.rating [data-rating="no"]').click();
  assert.equal(await page.locator('.rating').count(), 0);
  const taste = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-taste')));
  assert.equal(taste.never.length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the best week comes back without asking Claude', async () => {
  const { context, page, calls } = await open({ storage: ready });
  await page.click('[data-tab="plan"]');
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('#weekList');
  const before = calls.filter((call) => call.path === '/v1/ai/messages').length;
  const oldId = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-plan')).id);
  await page.click('[data-action="repeatWeek"]');
  await page.waitForFunction((id) => JSON.parse(localStorage.getItem('prepora-plan')).id !== id, oldId);
  assert.equal(calls.filter((call) => call.path === '/v1/ai/messages').length, before);
  await context.close();
});

test('the next plan uses up the freezer first, without a recipe from Claude', async () => {
  const stock = [
    {
      id: 's1',
      name: 'Altes Curry',
      portions: 2,
      frozenAt: '2026-10-01',
      nutrition: { kcal: 500, protein: 30 },
    },
  ];
  const { context, page, calls } = await open({ storage: { ...ready, 'prepora-stock': stock } });
  await page.click('[data-tab="plan"]');
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('#weekList');
  const sent = JSON.parse(calls.find((call) => call.path === '/v1/ai/messages').body);
  assert.match(await page.locator('#weekList').innerText(), /Altes Curry/);
  assert.ok(sent.messages[0].content.length > 0);
  const plan = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-plan')));
  assert.equal(plan.meals.filter((meal) => meal.stock).length, 2);
  assert.ok(plan.meals.filter((meal) => meal.stock).every((meal) => meal.storage === 'freezer'));
  await context.close();
});

test('a failed plan says why and keeps the screen usable', async () => {
  const { context, page } = await open({ storage: ready, claude: 402 });
  await page.click('[data-tab="plan"]');
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('.error');
  assert.match(await page.locator('.error').first().innerText(), /aufgebraucht/);
  assert.equal(await page.locator('[data-action="newWeek"]').count(), 1);
  await context.close();
});

test('the taste questions can stop any time and can be taken back', async () => {
  const { context, page } = await open({ storage: signedIn });
  await page.click('[data-tab="more"]');
  await page.click('#openTaste');
  await page.locator('[data-answer="love"]').click();
  await page.locator('[data-answer="no"]').click();
  const text = await page.locator('.page').innerText();
  assert.match(text, /Eintöpfe/);
  assert.match(text, /Hähnchen/);
  await page.locator('[data-action="dropTaste"]').first().click();
  assert.doesNotMatch(await page.locator('.page').innerText(), /Eintöpfe/);
  await context.close();
});

test('a fridge photo becomes a list for the next plan', async () => {
  const { context, page, calls } = await open({ storage: ready });
  await page.click('[data-tab="plan"]');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.setInputFiles('#fridgePhoto', { name: 'k.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('[data-action="dropFridge"]');
  assert.match(await page.locator('.fridge').innerText(), /Paprika/);
  const sent = JSON.parse(calls.find((call) => call.path === '/v1/ai/messages').body);
  assert.equal(sent.messages[0].content[0].type, 'image');
  await page.locator('[data-item="Quark"]').click();
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('#weekList');
  const planCall = calls.filter((call) => call.path === '/v1/ai/messages').at(-1);
  assert.match(JSON.parse(planCall.body).messages[0].content, /bitte verbrauchen: Paprika\./);
  await context.close();
});

test('the freezer can be kept by hand', async () => {
  const { context, page } = await open({ storage: signedIn });
  await page.click('[data-tab="more"]');
  await page.click('#openStock');
  await page.fill('[name="name"]', 'Linsen-Dal');
  await page.click('#stockAdd button');
  await page.waitForSelector('#stockList .row');
  assert.match(await page.locator('#stockList').innerText(), /Linsen-Dal/);
  await page.click('[data-action="stockLess"]');
  assert.equal(await page.locator('#stockList .row').count(), 0);
  await context.close();
});

test('switches between the four tabs without errors', async () => {
  const { context, page, errors } = await open({ storage: signedIn });
  assert.equal(await page.locator('h1').innerText(), 'Heute');
  for (const [tab, title] of [
    ['plan', 'Wochenplan'],
    ['shop', 'Einkauf'],
    ['more', 'Mehr'],
    ['today', 'Heute'],
  ]) {
    await page.click(`[data-tab="${tab}"]`);
    assert.equal(await page.locator('h1').innerText(), title);
    assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'), tab);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('the service worker only ever touches caches with its own prefix', () => {
  const worker = fs.readFileSync('sw.js', 'utf8');
  assert.match(worker, /const PREFIX = 'prepora-'/);
  assert.match(worker, /k\.startsWith\(PREFIX\) && k !== CACHE/);
});

test('every precached file exists and every module is precached', () => {
  const worker = fs.readFileSync('sw.js', 'utf8');
  const files = [...worker.matchAll(/'\.\/([^']+)'/g)].map((match) => match[1]);
  assert.ok(files.length > 5);
  for (const file of files) assert.ok(fs.existsSync(file), file);
  for (const file of fs.readdirSync('src')) assert.ok(files.includes(`src/${file}`), file);
});

for (const colorScheme of ['light', 'dark']) {
  test(`no serious accessibility violations in ${colorScheme} mode`, async () => {
    const check = async (page) => {
      await page.addScriptTag({ content: AXE });
      return page.evaluate(async () => {
        const result = await window.axe.run();
        return result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id);
      });
    };
    const gate = await open({ colorScheme });
    assert.deepEqual(await check(gate.page), []);
    await gate.context.close();
    const more = await open({ colorScheme, storage: signedIn });
    await more.page.click('[data-tab="more"]');
    assert.deepEqual(await check(more.page), []);
    await more.page.click('#openProfile');
    await more.page.locator('.pill', { hasText: 'Abnehmen' }).click();
    assert.deepEqual(await check(more.page), []);
    await more.page.click('[data-tab="more"]');
    await more.page.click('#openTaste');
    assert.deepEqual(await check(more.page), []);
    await more.context.close();

    const week = await open({ colorScheme, storage: ready });
    await week.page.click('[data-tab="plan"]');
    await week.page.click('[data-action="newWeek"]');
    await week.page.waitForSelector('#weekList');
    assert.deepEqual(await check(week.page), []);
    await week.page.click('[data-tab="shop"]');
    assert.deepEqual(await check(week.page), []);
    await week.page.click('[data-tab="plan"]');
    await week.page.click('[data-action="startCook"]');
    assert.deepEqual(await check(week.page), []);
    await week.context.close();
  });
}

test('a sign-out leaves nothing of this person on the device', async () => {
  const { context, page } = await open({ storage: ready });
  await page.click('[data-tab="more"]');
  await page.click('#signOut');
  await page.waitForSelector('#signIn');
  assert.equal(await page.evaluate(() => localStorage.getItem('prepora-profile')), null);
  await context.close();
});
