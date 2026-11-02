// End-to-end smoke tests against the real app in Chromium. Run with `npm test`.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { chromium } = require('playwright');
const { createServer } = require('./serve.js');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

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

async function open(colorScheme = 'light') {
  const context = await browser.newContext({ locale: 'de-DE', colorScheme });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(baseURL);
  return { context, page, errors };
}

test('starts on Heute and switches between the four tabs without errors', async () => {
  const { context, page, errors } = await open();
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

test('every precached file exists', () => {
  const worker = fs.readFileSync('sw.js', 'utf8');
  const files = [...worker.matchAll(/'\.\/([^']+)'/g)].map((match) => match[1]);
  assert.ok(files.length > 5);
  for (const file of files) assert.ok(fs.existsSync(file), file);
});

for (const scheme of ['light', 'dark']) {
  test(`no serious accessibility violations in ${scheme} mode`, async () => {
    const { context, page } = await open(scheme);
    await page.addScriptTag({ content: AXE });
    const violations = await page.evaluate(async () => {
      const result = await window.axe.run();
      return result.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id);
    });
    assert.deepEqual(violations, []);
    await context.close();
  });
}
