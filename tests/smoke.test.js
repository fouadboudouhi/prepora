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
  packEuro: 2,
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
        twists: ['Mit Limette'],
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
    fillers: [
      {
        id: 'skyr',
        name: 'Skyr mit Haferflocken',
        when: 'Frühstück',
        servings: 7,
        ingredients: [
          FAKE_FOOD('Skyr', 'skyr', 1750, 'Kühlregal', 500),
          FAKE_FOOD('Salz', 'gewuerze', 0, 'Vorrat', 0),
        ],
      },
    ],
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

// The assistant in the chat: thinks, calls tools, and answers once their results are back.
function agentReply(asked) {
  const last = asked.messages.at(-1);
  if (Array.isArray(last.content))
    return [{ type: 'text', text: 'Fertig: **neuer Plan** mit\n- Chili\n- Curry' }];
  if (last.content.includes('Party'))
    return [
      { type: 'tool_use', id: 'tu-look', name: 'get_overview', input: {} },
      { type: 'tool_use', id: 'tu-bad', name: 'update_profile', input: { changes: { goal: 'party' } } },
    ];
  if (last.content.includes('Plan'))
    return [
      { type: 'thinking', thinking: 'Erst Profil, dann Plan.', signature: 'sig-1' },
      { type: 'text', text: 'Mache ich, das dauert ein bis zwei Minuten.' },
      { type: 'tool_use', id: 'tu-1', name: 'update_profile', input: { changes: { cookMinutes: 60 } } },
      { type: 'tool_use', id: 'tu-2', name: 'create_plan', input: { wish: 'mehr Hähnchen' } },
    ];
  return [{ type: 'text', text: 'Hallo!' }];
}
const agentStream = (blocks) =>
  [
    { type: 'message_start', message: {} },
    ...blocks.flatMap((block, index) => {
      const start = { type: 'content_block_start', index };
      const delta = (value) => ({ type: 'content_block_delta', index, delta: value });
      const stop = { type: 'content_block_stop', index };
      if (block.type === 'thinking')
        return [
          { ...start, content_block: { type: 'thinking', thinking: '' } },
          delta({ type: 'thinking_delta', thinking: block.thinking }),
          delta({ type: 'signature_delta', signature: block.signature }),
          stop,
        ];
      if (block.type === 'tool_use')
        return [
          { ...start, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } },
          delta({ type: 'input_json_delta', partial_json: JSON.stringify(block.input) }),
          stop,
        ];
      return [
        { ...start, content_block: { type: 'text', text: '' } },
        delta({ type: 'text_delta', text: block.text }),
        stop,
      ];
    }),
    {
      type: 'message_delta',
      delta: { stop_reason: blocks.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn' },
    },
  ]
    .map((event) => `data: ${JSON.stringify(event)}`)
    .join('\n') + '\n';

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
      if (asked.tools?.some((tool) => tool.name === 'get_overview'))
        return route.fulfill({
          status: 200,
          headers: { ...cors, 'content-type': 'text/event-stream' },
          body: agentStream(agentReply(asked)),
        });
      const isPlan = asked.output_config?.format?.schema?.required?.includes('assignments');
      const required = asked.output_config?.format?.schema?.required ?? [];
      const isPhoto = required.includes('items');
      const said = JSON.stringify(asked.messages);
      const text = isPlan
        ? JSON.stringify(fakePlan(asked))
        : isPhoto
          ? JSON.stringify({ items: ['Paprika', 'Quark'] })
          : required.includes('assumption')
            ? JSON.stringify({
                goal: 'cut',
                activity: 'medium',
                reason: 'Du willst Fett verlieren und trainierst dreimal.',
                assumption: 'Ich gehe von einem Bürojob aus.',
              })
            : required.includes('kcalLow')
              ? JSON.stringify(
                  said.includes('Lasagne')
                    ? {
                        isFood: true,
                        dish: 'Lasagne',
                        confidence: 'mittel',
                        reason: '',
                        portion: 'Normale Portion',
                        kcalLow: 600,
                        kcalHigh: 800,
                        protein: 30,
                        components: ['Nudeln', 'Hack', 'Käse'],
                      }
                    : {
                        isFood: true,
                        dish: 'Auflauf',
                        confidence: 'niedrig',
                        reason: 'Die Menge ist nicht zu sehen.',
                        portion: '',
                        kcalLow: 200,
                        kcalHigh: 900,
                        protein: 10,
                        components: [],
                      }
                )
              : required.includes('recommended')
                ? JSON.stringify({
                    recommended: [
                      {
                        name: 'Kreatin',
                        dose: '3 g',
                        when: 'Täglich',
                        why: 'Hilft beim Muskelaufbau.',
                        evidence: 'stark',
                        caution: '',
                      },
                      {
                        name: 'Vitamin D',
                        dose: '1000 IE',
                        when: 'Im Winter',
                        why: 'Wenig Sonne.',
                        evidence: 'mittel',
                        caution: 'Vorher Bluttest.',
                      },
                    ],
                    notNeeded: [{ name: 'BCAA', why: 'Dein Eiweiß reicht.' }],
                    note: 'Du brauchst wenig.',
                  })
                : required.includes('found')
                  ? JSON.stringify(
                      said.includes('kein Rezept')
                        ? {
                            found: false,
                            name: '',
                            servings: 0,
                            fridgeDays: 0,
                            freezes: false,
                            reheat: '',
                            ingredients: [],
                            steps: [],
                          }
                        : {
                            found: true,
                            name: 'Omas Gulasch',
                            servings: 4,
                            fridgeDays: 4,
                            freezes: true,
                            reheat: '3 Minuten',
                            ingredients: [
                              FAKE_FOOD('Rindfleisch', 'rindfleisch', 800, 'Fleisch und Fisch', 500),
                            ],
                            steps: ['Schmoren'],
                          }
                    )
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

test('Claude suggests goal and activity from a wish in own words, and one tap takes it', async () => {
  const profile = {
    goal: 'muscle',
    sex: 'male',
    age: 31,
    height: 184,
    weight: 89,
    activity: 'high',
    health: 'Nimmt Blutverdünner',
  };
  const { context, page, calls, errors } = await open({
    storage: { ...signedIn, 'prepora-profile': profile },
  });
  await page.click('#app [data-tab="profile"]');
  await page.click('[data-action="adviseGoal"]');
  assert.match(await page.locator('.error').innerText(), /Schreib erst/);

  await page.fill('[name="goalText"]', 'Bauch weg, Muskeln behalten. Ich trainiere dreimal die Woche.');
  await page.click('[data-action="adviseGoal"]');
  await page.waitForSelector('#goalAdvice');
  const card = await page.locator('#goalAdvice').innerText();
  assert.match(card, /Definition, Bewegung Mittel/);
  assert.match(card, /ca\. 2\.650 kcal, 195 g Eiweiß am Tag/);
  assert.match(card, /Bürojob/);
  const asked = calls.find((call) => call.path === '/v1/ai/messages').body;
  assert.match(asked, /Bauch weg, Muskeln behalten/);
  assert.doesNotMatch(asked, /Blutverdünner/);

  await page.click('[data-action="applyAdvice"]');
  assert.match(await page.locator('#goalAdvice').innerText(), /Ist so eingestellt/);
  assert.match(await page.locator('#targets').innerText(), /ca\. 2\.650 kcal/);
  assert.equal(await page.locator('[name="goal"]').inputValue(), 'cut');
  assert.equal(await page.locator('[name="activity"]').inputValue(), 'medium');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-profile')));
  assert.equal(saved.goal, 'cut');
  assert.equal(saved.activity, 'medium');
  assert.equal(saved.activityFrom, '');
  assert.equal(saved.goalText, 'Bauch weg, Muskeln behalten. Ich trainiere dreimal die Woche.');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the profile saves every answer, shows the targets and survives a reload', async () => {
  const { context, page, errors } = await open({ storage: signedIn });
  await page.click('#app [data-tab="profile"]');
  assert.equal(await page.locator('h1').innerText(), 'Profil');
  assert.equal(await page.locator('[aria-current="page"]').getAttribute('data-tab'), 'more');

  // Nothing chosen yet reads as such, not as the first choice.
  assert.equal(await page.locator('[name="goal"] option:checked').innerText(), 'Wählen');
  await page.selectOption('[name="goal"]', 'muscle');
  await page.fill('[name="age"]', '30');
  await page.fill('[name="height"]', '180');
  await page.fill('[name="weight"]', '80');
  await page.selectOption('[name="sex"]', 'male');
  await page.selectOption('[name="activity"]', 'medium');
  await page.selectOption('[name="cookDays"]', '2');
  // Several answers stay folded into one row until opened, and the row says what is chosen.
  assert.equal(await page.locator('label.row', { hasText: 'Frühstück' }).isVisible(), false);
  await page.locator('summary', { hasText: 'Vorkochen für' }).click();
  await page.locator('label.row', { hasText: 'Frühstück' }).click();
  assert.equal(
    await page.locator('[data-summary="meals"]').innerText(),
    'Frühstück, Mittagessen, Abendessen'
  );
  await page.locator('label.row', { hasText: 'Tiefkühler' }).click();
  await page.fill('[name="avoid"]', 'Pilze <b>');
  assert.match(await page.locator('#targets').innerText(), /ca\. 3\.\d{3} kcal, 160 g Eiweiß am Tag/);
  // Each choice says what it does, and the full breakdown is one tap away.
  assert.match(await page.locator('#goalHint').innerText(), /300 kcal über/);
  assert.match(await page.locator('#activityHint').innerText(), /zwei- bis fünfmal/);
  await page.selectOption('[name="goal"]', 'cut');
  assert.match(await page.locator('#goalHint').innerText(), /300 kcal unter/);
  await page.selectOption('[name="goal"]', 'muscle');
  await page.locator('summary', { hasText: 'Was passt zu mir' }).click();
  assert.match(
    await page.locator('.guide').innerText(),
    /Definition[\s\S]*Sitzend[\s\S]*Wenig\s+Mittel\s+Viel/
  );

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
  assert.equal(await page.locator('[name="freezer"]').isChecked(), false);
  assert.equal(await page.locator('[name="sex"]').inputValue(), 'male');
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

test('switches between the five tabs without errors', async () => {
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
  // The chat has the screen to itself, like in Volumora, and goes back to where it was opened.
  await page.click('[data-tab="shop"]');
  await page.click('nav [data-tab="chat"]');
  assert.equal(await page.locator('.chat-screen h1').innerText(), 'Claude');
  assert.equal(await page.locator('nav.tabs').count(), 0);
  assert.equal(await page.locator('.chat-head .back').innerText(), 'Einkauf');
  await page.click('.chat-head .back');
  assert.equal(await page.locator('h1').innerText(), 'Einkauf');
  // Each tab shows a drawn icon over its name; the name alone is what a screen reader hears.
  assert.equal(await page.locator('.tabs button svg[aria-hidden="true"]').count(), 5);
  assert.deepEqual(await page.locator('.tabs button').allInnerTexts(), [
    'Heute',
    'Plan',
    'Einkauf',
    'Claude',
    'Mehr',
  ]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the service worker only ever touches caches with its own prefix', () => {
  const worker = fs.readFileSync('sw.js', 'utf8');
  assert.match(worker, /const PREFIX = 'prepora-'/);
  assert.match(worker, /k\.startsWith\(PREFIX\) && k !== CACHE/);
});

test('the demo makes a week without an account, never reaches the server and keeps nothing', async () => {
  const context = await browser.newContext({ locale: 'de-DE' });
  const calls = [];
  await context.route(`${SERVER}/**`, (route) => {
    calls.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseURL}/demo.html`);
  await page.click('[data-tab="plan"]');
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('#weekList', { timeout: 8000 });
  assert.match(await page.locator('#recipeList').innerText(), /Chili con Carne/);
  await page.click('nav [data-tab="chat"]');
  await page.fill('#chatForm textarea', 'Mach mir einen neuen Plan');
  await page.press('#chatForm textarea', 'Enter');
  await page.waitForFunction(() => document.body.innerText.includes('Das ist die Demo'), null, {
    timeout: 8000,
  });
  assert.deepEqual(calls, []);
  const kept = await page.evaluate(() => {
    const real = Object.getOwnPropertyDescriptor(Window.prototype, 'localStorage')?.get?.call(window);
    return real ? Object.keys(real).filter((key) => key.startsWith('prepora-')) : [];
  });
  assert.deepEqual(kept, []);
  assert.deepEqual(errors, []);
  await context.close();
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
    await more.page.selectOption('[name="goal"]', 'lose');
    await more.page.locator('summary', { hasText: 'Geräte' }).click();
    assert.deepEqual(await check(more.page), []);
    await more.page.click('nav [data-tab="chat"]');
    assert.deepEqual(await check(more.page), []);
    assert.equal(await more.page.locator('.chat-head .back').innerText(), 'Profil');
    await more.page.click('.chat-head .back');
    await more.page.click('[data-tab="more"]');
    await more.page.click('#openTaste');
    assert.deepEqual(await check(more.page), []);
    await more.page.click('.back');
    await more.page.click('#openSupplements');
    assert.deepEqual(await check(more.page), []);
    await more.page.click('.back');
    await more.page.click('#openRecipes');
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

test('"Heute nicht" decides by itself what happens to the box', async () => {
  const today = await (async () => {
    const at = new Date();
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  })();
  const recipe = {
    id: 'a',
    name: 'Chili',
    cookDate: today,
    fridgeDays: 4,
    freezes: true,
    reheat: '',
    ingredients: [],
    nutrition: { kcal: 600, protein: 40 },
  };
  const plan = {
    id: 'p',
    start: today,
    people: 1,
    recipes: [recipe],
    fillers: [
      { id: 'f', name: 'Skyr', when: 'Frühstück', ingredients: [], nutrition: { kcal: 300, protein: 30 } },
    ],
    meals: [
      {
        id: '1-Mittagessen',
        date: today,
        meal: 'Mittagessen',
        recipeId: 'a',
        storage: 'fridge',
        twist: 'Mit Limette',
      },
    ],
    cookDays: [{ date: today, minutes: 90, steps: [{ title: 'x', detail: '' }], done: true }],
  };
  const { context, page } = await open({ storage: { ...ready, 'prepora-plan': plan } });
  assert.match(await page.locator('#twist').innerText(), /Mit Limette/);
  assert.match(await page.locator('#gap').innerText(), /Skyr/);
  await page.click('[data-action="eatFiller"]');
  assert.match(await page.locator('.day-line').innerText(), /^300/);
  await page.click('[data-action="skipMeal"]');
  assert.match(await page.locator('#notice').innerText(), /Tiefkühler/);
  assert.equal(await page.locator('#nextMeal').count(), 0);
  const stock = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-stock')));
  assert.equal(stock[0].portions, 1);
  await context.close();
});

test('the list has everything for the week in one shop', async () => {
  const { context, page } = await open({ storage: ready });
  await page.click('[data-tab="more"]');
  await page.click('#openSupplements');
  await page.fill('#supplementAdd [name="name"]', 'Kreatin');
  await page.fill('#supplementAdd [name="dose"]', '3 g');
  await page.click('#supplementAdd button');
  await page.waitForSelector('#supplementList');
  await page.click('[data-tab="plan"]');
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('#weekList');
  assert.match(await page.locator('#boxLine').innerText(), /14 Boxen/);
  await page.click('[data-tab="shop"]');
  const list = await page.locator('.page').innerText();
  assert.match(list, /Alles für die ganze Woche, Einkauf/);
  assert.match(list, /Geschätzt ca\. \d+ €/);
  assert.doesNotMatch(await page.locator('#shopFor').innerText(), /\.\./, 'the date ends the sentence');
  assert.match(list, /Skyr/);
  assert.match(list, /Prüfen, ob da/);
  assert.match(list, /Kreatin/);
  await context.close();
});

test('a dish photo gives no number when it would be a guess, a name makes it an estimate', async () => {
  const { context, page, calls } = await open({ storage: ready });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  await page.setInputFiles('#dishPhoto', { name: 'd.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('#dishResult');
  const unsure = await page.locator('#dishResult').innerText();
  assert.match(unsure, /Zu unsicher/);
  assert.match(unsure, /Menge ist nicht zu sehen/);
  assert.doesNotMatch(unsure, /kcal/);
  assert.equal(await page.locator('[data-action="addDish"]').count(), 0);

  await page.fill('#dishFix [name="name"]', 'Lasagne, normale Portion');
  await page.click('#dishFix button');
  await page.waitForSelector('#dishRange');
  assert.match(await page.locator('#dishRange').innerText(), /600–800 kcal/);
  const asked = JSON.parse(calls.filter((call) => call.path === '/v1/ai/messages').at(-1).body);
  assert.equal(asked.messages[0].content[0].type, 'image');

  await page.click('[data-action="addDish"]');
  await page.click('.back');
  assert.match(await page.locator('.page').innerText(), /700/);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  assert.equal(stored.includes('base64'), false, 'the photo is not kept');
  await context.close();
});

test('supplements: own list, advice from Claude, one tap to adopt and to tick off', async () => {
  const profile = { ...person, health: 'Blutverdünner', diet: ['Vegan'] };
  const { context, page, calls } = await open({ storage: { ...signedIn, 'prepora-profile': profile } });
  await page.click('[data-tab="more"]');
  await page.click('#openSupplements');
  await page.click('[data-action="askAdvice"]');
  await page.waitForSelector('#advice');
  const sent = JSON.parse(calls.find((call) => call.path === '/v1/ai/messages').body);
  assert.match(sent.messages[0].content, /Blutverdünner/);
  assert.match(sent.messages[0].content, /Vegan/);
  const shown = await page.locator('#advice').innerText();
  assert.match(shown, /Kreatin/);
  assert.match(shown, /Studienlage: stark/);
  assert.match(shown, /Vorher Bluttest/);
  assert.match(shown, /BCAA/);
  assert.match(shown, /ärztlichen Rat/);
  await page.locator('[data-action="adoptSupplement"]').first().click();
  assert.match(await page.locator('#supplementList').innerText(), /Kreatin/);
  await page.click('[data-tab="today"]');
  await page.click('[data-action="takeSupplement"]');
  assert.equal(await page.locator('[data-action="takeSupplement"]').getAttribute('aria-pressed'), 'true');
  await context.close();
});

test('own recipes come from text, go into the next plan once, and an unreadable one says so', async () => {
  const { context, page, calls } = await open({ storage: ready });
  await page.click('[data-tab="more"]');
  await page.click('#openRecipes');
  await page.fill('[name="source"]', 'Das ist kein Rezept');
  await page.click('#recipeImport button');
  await page.waitForSelector('.error');
  assert.match(await page.locator('.error').innerText(), /kein Rezept/);

  await page.fill('[name="source"]', 'https://example.com/gulasch');
  await page.click('#recipeImport button');
  await page.waitForSelector('#myRecipeList');
  assert.match(
    await page.locator('#myRecipeList').innerText(),
    /Omas Gulasch[\s\S]*Pro Portion ca\. 300 kcal/
  );
  const asked = JSON.parse(calls.filter((call) => call.path === '/v1/ai/messages').at(-1).body);
  assert.equal(asked.tools[0].type, 'web_fetch_20260209');

  await page.click('[data-tab="plan"]');
  await page.click('[data-action="newWeek"]');
  await page.waitForSelector('#weekList');
  const planCall = JSON.parse(calls.filter((call) => call.path === '/v1/ai/messages').at(-1).body);
  assert.match(planCall.messages[0].content, /Omas Gulasch/);
  const mine = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-myRecipes')));
  assert.equal(mine[0].wanted, undefined);
  await context.close();
});

test('fixed times are set in the profile, a second cook day only shows when chosen', async () => {
  const { context, page } = await open({ storage: ready });
  await page.click('[data-tab="more"]');
  await page.click('#openProfile');
  assert.equal(await page.locator('[name="cookTime2"]').count(), 0);
  await page.selectOption('[name="cookDays"]', '2');
  await page.waitForSelector('[name="cookTime2"]');
  await page.fill('[name="cookTime"]', '09:30');
  await page.fill('[name="shopTime"]', '18:15');
  await page.locator('h1').click();
  await page.selectOption('[name="shopWeekday"]', '5');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-profile')));
  assert.equal(saved.cookDays, 2);
  assert.equal(saved.cookTime, '09:30');
  assert.equal(saved.shopTime, '18:15');
  assert.equal(saved.shopWeekday, 5);
  await context.close();
});

const agentCalls = (calls) =>
  calls
    .filter((call) => call.path === '/v1/ai/messages')
    .map((call) => JSON.parse(call.body))
    .filter((body) => body.tools?.some((tool) => tool.name === 'get_overview'));
const withHealth = { ...signedIn, 'prepora-profile': { ...person, health: 'Nimmt Blutverdünner' } };

test('Claude in the chat changes the profile and makes the plan, and one tap takes both back', async () => {
  const { context, page, calls, errors } = await open({ storage: withHealth });
  await page.click('nav [data-tab="chat"]');
  assert.equal(await page.locator('h1').innerText(), 'Claude');
  assert.equal(await page.locator('.starter').count(), 4);
  await page.fill('[name="message"]', 'Mach mir einen Plan mit mehr Hähnchen, nur 60 Minuten');
  await page.press('[name="message"]', 'Enter');
  await page.waitForSelector('.chat-change');

  const answer = await page.locator('.bubble').last().innerText();
  assert.match(answer, /Mache ich[\s\S]*Fertig: neuer Plan/);
  assert.equal(await page.locator('.bubble li').count(), 2);
  assert.match(await page.locator('.chat-change').innerText(), /Geändert: Profil, Wochenplan/);
  const stored = () =>
    page.evaluate(() => ({
      profile: JSON.parse(localStorage.getItem('prepora-profile')),
      plan: JSON.parse(localStorage.getItem('prepora-plan')),
    }));
  let saved = await stored();
  assert.equal(saved.profile.cookMinutes, 60);
  assert.ok(saved.plan.meals.length);

  // Within a turn the thinking goes back exactly as it came, and every tool call gets its result.
  const turns = agentCalls(calls);
  assert.equal(turns.length, 2);
  assert.deepEqual(turns[1].messages.at(-2).content[0], {
    type: 'thinking',
    thinking: 'Erst Profil, dann Plan.',
    signature: 'sig-1',
  });
  assert.deepEqual(
    turns[1].messages.at(-1).content.map((result) => result.tool_use_id),
    ['tu-1', 'tu-2']
  );
  const planCall = calls
    .filter((call) => call.path === '/v1/ai/messages')
    .find((call) => call.body.includes('assignments'));
  assert.match(planCall.body, /mehr Hähnchen/);

  await page.click('[data-action="chatUndo"]');
  assert.match(await page.locator('.chat-change').innerText(), /Zurückgenommen/);
  saved = await stored();
  assert.equal(saved.profile.cookMinutes, undefined);
  assert.equal(saved.plan, null);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the chat checks what Claude asks for and never shows it the health note', async () => {
  const { context, page, calls } = await open({ storage: withHealth });
  await page.click('nav [data-tab="chat"]');
  await page.fill('[name="message"]', 'Setz mein Ziel auf Party');
  await page.click('#chatForm [type="submit"]');
  await page.waitForSelector('.bubble li');
  assert.equal(await page.locator('.chat-change').count(), 0);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('prepora-profile')));
  assert.equal(saved.goal, 'muscle');
  const [looked, refused] = agentCalls(calls)[1].messages.at(-1).content;
  assert.equal(looked.is_error, undefined);
  assert.match(looked.content, /"goal":"muscle"/);
  assert.equal(refused.is_error, true);
  assert.match(refused.content, /Ungültiger Wert für goal/);
  assert.ok(agentCalls(calls).every((body) => !JSON.stringify(body).includes('Blutverdünner')));
  await context.close();
});

test('when Claude cannot answer, the message goes back into the field', async () => {
  const { context, page } = await open({ storage: ready, claude: 402 });
  await page.click('nav [data-tab="chat"]');
  await page.fill('[name="message"]', 'Hallo');
  await page.press('[name="message"]', 'Enter');
  await page.waitForSelector('.note.error');
  assert.match(await page.locator('.note.error').innerText(), /Budget/);
  assert.equal(await page.locator('[name="message"]').inputValue(), 'Hallo');
  assert.equal(await page.locator('.bubble').count(), 0);
  await context.close();
});

test('before the plan starts, Heute offers nothing of it to eat and says when it begins', async () => {
  const at = new Date();
  at.setDate(at.getDate() + 3);
  const start = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  const plan = {
    id: 'p',
    start,
    shopOn: start,
    people: 1,
    recipes: [],
    fillers: [
      { id: 'f', name: 'Skyr', when: 'Frühstück', ingredients: [], nutrition: { kcal: 300, protein: 30 } },
    ],
    meals: [],
    cookDays: [{ date: start, minutes: 90, steps: [{ title: 'x', detail: '' }] }],
  };
  const { context, page } = await open({ storage: { ...ready, 'prepora-plan': plan } });
  assert.match(await page.locator('#planAhead').innerText(), /kaufst du ein und kochst/);
  assert.equal(await page.locator('#gap').count(), 0);
  assert.equal(await page.locator('[data-action="eatFiller"], [data-action="eat"]').count(), 0);
  await context.close();
});

test('an answer lost while the app was in the background is asked for again when it comes back', async () => {
  const { context, page } = await open({ storage: ready });
  let first = true;
  await context.route(`${SERVER}/v1/ai/messages`, (route) => {
    if (route.request().method() !== 'POST' || !first) return route.fallback();
    // Never answers, like a connection the iPhone cut while the app was away.
    first = false;
  });
  await page.click('nav [data-tab="chat"]');
  await page.fill('[name="message"]', 'Hallo');
  await page.press('[name="message"]', 'Enter');
  await page.evaluate(() => {
    let state = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForSelector('.bubble:not(.mine):not(#chatLive)', { timeout: 15000 });
  assert.equal(await page.locator('.bubble:not(.mine):not(#chatLive)').innerText(), 'Hallo!');
  assert.equal(await page.locator('.note.error').count(), 0);
  await context.close();
});
