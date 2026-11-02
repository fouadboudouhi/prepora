// Draws the app icons (a filled meal box) into assets/icons. Run with `node tools/make-icons.js`.
const { chromium } = require('playwright');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#1a1206"/>
  <rect x="116" y="196" width="280" height="196" rx="44" fill="#ff9f0a"/>
  <rect x="96" y="136" width="320" height="52" rx="26" fill="#f2f2f3"/>
  <rect x="244" y="228" width="24" height="132" rx="12" fill="#1a1206"/>
</svg>`;

(async () => {
  const browser = await chromium.launch();
  for (const [name, size] of [
    ['favicon-32', 32],
    ['icon-192', 192],
    ['icon-512', 512],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>*{margin:0}svg{display:block;width:100vw;height:100vh}</style>${SVG}`);
    await page.screenshot({ path: path.join(__dirname, '..', 'assets', 'icons', `${name}.png`) });
    await page.close();
  }
  await browser.close();
})();
