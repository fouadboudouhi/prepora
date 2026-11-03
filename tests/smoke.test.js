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
async function open({ colorScheme = 'light', storage = {}, claude = 200 } = {}) {
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
    if (path === '/v1/ai/messages')
      return claude === 200
        ? reply(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'OK' }] })
        : reply(claude, { error: 'budget' });
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

// No screen uses Claude yet, so these ask it the way the first plan will.
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
  assert.equal(await ask(page), 'OK');

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

test('never touches the Volumora data on the server', async () => {
  const { context, page, calls } = await open({ storage: signedIn });
  for (const tab of ['plan', 'shop', 'more', 'today']) await page.click(`[data-tab="${tab}"]`);
  await page.waitForTimeout(100);
  assert.equal(
    calls.some((call) => call.path.includes('snapshot')),
    false
  );
  const code = fs.readdirSync('src').map((file) => fs.readFileSync(`src/${file}`, 'utf8'));
  assert.equal(
    code.some((text) => /['"`]\/v1\/snapshot/.test(text)),
    false
  );
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
    await more.context.close();
  });
}
