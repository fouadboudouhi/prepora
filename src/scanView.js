// Barcode scannen: the camera reads the code, Open Food Facts knows the product, the person says how much. The
// browser's own barcode reader is used where there is one; Safari has none, so ZXing reads the frames there.
import { addExtra } from './actions.js';
import { entryFromProduct, lookupProduct, validCode } from './barcode.js';
import { icon } from './icons.js';
import { localDay } from './planner.js';
import { esc, number, openView, rerender } from './ui.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const EVERY = 200;

const state = { phase: 'camera', code: '', product: null, grams: 100, camera: '' };
let stream = null;
let timer = null;
let decode = null;

const CAMERA_TEXT = {
  denied:
    'Prepora darf die Kamera nicht benutzen. Erlaube es in den Einstellungen des iPhones unter Safari → Kamera, oder tipp die Nummer unten ein.',
  missing: 'Hier gibt es keine Kamera. Tipp die Nummer unter dem Strichcode unten ein.',
};

// The script is large and only needed here, so it loads the first time the scanner opens.
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'assets/vendor/zxing.min.js';
    script.onload = () => resolve(window.ZXing);
    script.onerror = reject;
    document.head.append(script);
  });
}

// Returns a function that reads a code from a video or canvas, or null when there is none in this frame. Only the
// middle band is read, where the frame on screen is; that is faster and ignores other codes around it.
export async function makeDecoder({ native = true } = {}) {
  if (native && 'BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      if (supported.includes('ean_13')) {
        const detector = new window.BarcodeDetector({
          formats: FORMATS.filter((f) => supported.includes(f)),
        });
        return async (source) => (await detector.detect(source))[0]?.rawValue ?? null;
      }
    } catch {
      // Falls through to ZXing.
    }
  }
  const Z = await loadZxing();
  const reader = new Z.MultiFormatReader();
  reader.setHints(
    new Map([
      [
        Z.DecodeHintType.POSSIBLE_FORMATS,
        [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E],
      ],
      [Z.DecodeHintType.TRY_HARDER, true],
    ])
  );
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async (source) => {
    const width = source.videoWidth ?? source.width;
    const height = source.videoHeight ?? source.height;
    if (!width || !height) return null;
    const scale = Math.min(1, 1000 / width);
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * 0.5 * scale);
    context.drawImage(source, 0, height * 0.25, width, height * 0.5, 0, 0, canvas.width, canvas.height);
    try {
      const bitmap = new Z.BinaryBitmap(
        new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas))
      );
      return reader.decodeWithState(bitmap).getText();
    } catch {
      return null;
    } finally {
      reader.reset();
    }
  };
}

export function stopScanner() {
  clearTimeout(timer);
  timer = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
}

function readFrames() {
  timer = setTimeout(async () => {
    const video = document.getElementById('scanVideo');
    if (!video || !stream || !decode) return;
    const code = await decode(video).catch(() => null);
    if (code && validCode(code)) {
      navigator.vibrate?.(40);
      stopScanner();
      find(code);
    } else readFrames();
  }, EVERY);
}

// Called after every draw of the scan screen. A redraw gets the running camera back instead of a new one.
export async function startScanner() {
  const video = document.getElementById('scanVideo');
  if (!video || state.phase !== 'camera') return;
  if (stream) {
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    }
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    state.camera = 'missing';
    return rerender();
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    state.camera = err?.name === 'NotFoundError' ? 'missing' : 'denied';
    return rerender();
  }
  const live = document.getElementById('scanVideo');
  if (!live || state.phase !== 'camera') return stopScanner();
  live.srcObject = stream;
  live.play().catch(() => {});
  decode = decode ?? (await makeDecoder());
  readFrames();
}

async function find(code) {
  Object.assign(state, { phase: 'looking', code, product: null });
  rerender();
  try {
    const product = await lookupProduct(code);
    state.product = product;
    state.phase = product?.per100 ? 'found' : 'missing';
    state.grams = product?.serving ?? 100;
  } catch {
    state.phase = 'offline';
  }
  rerender();
}

const amountButtons = (product) =>
  [
    product.serving ? [product.serving, `Portion, ${number(product.serving)} g`] : null,
    [100, '100 g'],
    product.pack && product.pack !== product.serving
      ? [product.pack, `Packung, ${number(product.pack)} g`]
      : null,
  ]
    .filter(Boolean)
    .map(
      ([grams, label]) =>
        `<button type="button" class="chip${state.grams === grams ? ' taken' : ''}" data-action="scanGrams" data-grams="${grams}" aria-pressed="${state.grams === grams}">${label}</button>`
    )
    .join('');

function result() {
  const product = state.product;
  if (state.phase === 'looking') return '<p class="note" role="status">Sucht bei Open Food Facts …</p>';
  if (state.phase === 'offline')
    return `<p class="note error" role="alert">Open Food Facts ist gerade nicht erreichbar.</p>
            <button type="button" class="secondary" data-action="scanAgain">Nochmal scannen</button>`;
  if (state.phase === 'missing')
    return `<section class="card" id="scanResult">
              <h2>${product ? esc(product.name) : 'Nicht gefunden'}</h2>
              <p>${product ? 'Für dieses Produkt stehen keine Nährwerte bei Open Food Facts.' : `Open Food Facts kennt die Nummer ${esc(state.code)} nicht.`} Schreib es unter Heute in eigenen Worten, dann schätzt Claude.</p>
              <button type="button" class="secondary" data-action="scanAgain">Nochmal scannen</button>
            </section>`;
  const eaten = entryFromProduct(product, state.grams);
  return `
    <section class="card" id="scanResult">
      ${product.brand ? `<span class="eyebrow">${esc(product.brand)}</span>` : ''}
      <h2>${esc(product.name)}</h2>
      <p class="small">Pro 100 g: ${number(product.per100.kcal)} kcal, ${number(product.per100.protein)} g Eiweiß, ${number(product.per100.fat)} g Fett, ${number(product.per100.carbs)} g Kohlenhydrate</p>
      <div class="pills amounts">${amountButtons(product)}</div>
      <label class="row scan-grams"><span>Gegessen</span><span class="entry"><input type="number" inputmode="numeric" name="scanGrams" value="${state.grams}" min="1" max="5000"><span>g</span></span></label>
      <p class="plain" id="scanTotal">ca. ${number(eaten.kcal)} kcal, ${number(eaten.protein)} g Eiweiß</p>
      <button type="button" class="primary" data-action="scanLog">Eintragen</button>
      <button type="button" class="text-button" data-action="scanAgain">Anderes Produkt scannen</button>
      <p class="source">Daten: Open Food Facts</p>
    </section>`;
}

export function scanView() {
  const camera = state.phase === 'camera';
  return `
    <button type="button" class="back" data-tab="today">Heute</button>
    <h1>Barcode scannen</h1>
    ${
      camera
        ? state.camera
          ? `<p class="note error" role="alert">${CAMERA_TEXT[state.camera]}</p>`
          : `<div class="scanner"><video id="scanVideo" playsinline muted autoplay aria-label="Kamerabild"></video><span class="scan-frame" aria-hidden="true"></span></div>
             <p class="sub">Halte den Strichcode in den Rahmen.</p>`
        : result()
    }
    ${
      camera
        ? `<form id="scanCode" class="composer" novalidate>
             <input name="code" type="text" inputmode="numeric" autocomplete="off" maxlength="14" aria-label="Nummer unter dem Strichcode" placeholder="Oder die Nummer eintippen">
             <button type="submit" class="send" aria-label="Suchen">${icon('up')}</button>
           </form>
           <p class="note" id="scanError" role="alert"></p>
           <p class="source">Nur die Nummer geht an Open Food Facts, eine freie Datenbank.</p>`
        : ''
    }`;
}

// Typed in by hand, the number has to pass the same check as a scanned one.
export function findTyped(text) {
  const code = String(text ?? '').replace(/\s/g, '');
  if (!validCode(code)) {
    const line = document.getElementById('scanError');
    if (line)
      line.textContent =
        'Das ist keine gültige Nummer. Sie hat 8 oder 13 Ziffern und steht unter dem Strichcode.';
    return;
  }
  stopScanner();
  find(code);
}

export function setScanGrams(value) {
  const grams = Number(value);
  if (!Number.isFinite(grams) || grams <= 0) return;
  state.grams = Math.min(5000, Math.round(grams));
  const total = document.getElementById('scanTotal');
  if (total && state.product?.per100) {
    const eaten = entryFromProduct(state.product, state.grams);
    total.textContent = `ca. ${number(eaten.kcal)} kcal, ${number(eaten.protein)} g Eiweiß`;
  }
}

// A fresh start each time the scanner is opened from Heute.
export function resetScan() {
  Object.assign(state, { phase: 'camera', code: '', product: null, grams: 100, camera: '' });
}

export const scanActions = {
  scanGrams: (el) => {
    setScanGrams(el.dataset.grams);
    rerender();
  },
  scanAgain: () => {
    resetScan();
    rerender();
  },
  scanLog: () => {
    if (!state.product?.per100) return;
    addExtra(localDay(), entryFromProduct(state.product, state.grams));
    resetScan();
    openView('today');
  },
};
