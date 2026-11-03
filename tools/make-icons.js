// Draws the app icons (a meal-prep box seen from above) into assets/icons. Run with `node tools/make-icons.js`.
const { chromium } = require('playwright');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a2a2e"/>
      <stop offset="1" stop-color="#0b0b0c"/>
    </linearGradient>
    <linearGradient id="food" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffb340"/>
      <stop offset="1" stop-color="#ff9500"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#ground)"/>
  <rect x="96" y="136" width="320" height="240" rx="68" fill="none" stroke="#f5f5f7" stroke-width="20"/>
  <rect x="128" y="168" width="256" height="77" rx="26" fill="url(#food)"/>
  <rect x="128" y="267" width="117" height="77" rx="26" fill="url(#food)"/>
  <rect x="267" y="267" width="117" height="77" rx="26" fill="url(#food)"/>
</svg>`;

(async () => {
  const browser = await chromium.launch();
  for (const [name, size] of [
    ['favicon-32', 32],
    ['apple-touch-icon', 180],
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
