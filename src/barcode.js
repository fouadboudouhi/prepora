// A scanned product: the barcode is checked, looked up at Open Food Facts, and what was eaten is worked out from the
// values per 100 g. Only the number goes out; nothing about the person.
const API = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = [
  'product_name',
  'product_name_de',
  'generic_name_de',
  'brands',
  'nutriments',
  'serving_quantity',
  'serving_size',
  'product_quantity',
  'quantity',
].join(',');
const TIMEOUT = 12000;

// EAN-8, UPC-A (12) and EAN-13: the last digit checks the others, so a misread almost never gets through.
export function validCode(text) {
  const code = String(text ?? '').replace(/\s/g, '');
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const number = (value) => {
  const found = Number(value);
  return value !== null && value !== '' && Number.isFinite(found) && found >= 0 ? found : null;
};
// "400 g", "1,5 kg" or "500 ml" from the label text, in grams; drinks count a millilitre as a gram.
function gramsIn(text) {
  const match = String(text ?? '').match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  return /^(kg|l)$/i.test(match[2]) ? value * 1000 : value;
}

// What the app needs from Open Food Facts' answer, or null when the product or its values are missing.
export function productFrom(code, answer) {
  const found = answer?.status === 1 ? answer.product : null;
  if (!found) return null;
  const n = found.nutriments ?? {};
  const kj = number(n['energy-kj_100g']) ?? number(n.energy_100g);
  const kcal = number(n['energy-kcal_100g']) ?? (kj === null ? null : kj / 4.184);
  const name =
    [found.product_name_de, found.product_name, found.generic_name_de]
      .map((text) => text?.trim())
      .find(Boolean) ?? '';
  const brand =
    (found.brands ?? '')
      .split(',')
      .map((text) => text.trim())
      .find((text) => text && text.toLowerCase() !== name.toLowerCase()) ?? '';
  const serving = number(found.serving_quantity) ?? gramsIn(found.serving_size);
  const pack = number(found.product_quantity) ?? gramsIn(found.quantity);
  return {
    code,
    name: name || brand || `Produkt ${code}`,
    brand: name ? brand : '',
    per100:
      kcal === null
        ? null
        : {
            kcal: Math.round(kcal),
            protein: Math.round((number(n.proteins_100g) ?? 0) * 10) / 10,
            fat: Math.round((number(n.fat_100g) ?? 0) * 10) / 10,
            carbs: Math.round((number(n.carbohydrates_100g) ?? 0) * 10) / 10,
          },
    serving: serving && serving <= 2000 ? Math.round(serving) : null,
    pack: pack && pack <= 5000 ? Math.round(pack) : null,
  };
}

export async function lookupProduct(code, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetcher(`${API}/${code}.json?fields=${FIELDS}`, { signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('lookup');
    return productFrom(code, await response.json());
  } finally {
    clearTimeout(timer);
  }
}

// One entry for the day's list, from the values per 100 g and the grams eaten.
export function entryFromProduct(product, grams) {
  const amount = Math.min(5000, Math.max(1, Math.round(grams)));
  const share = amount / 100;
  return {
    name: `${product.name}, ${amount} g`,
    kcal: Math.round(product.per100.kcal * share),
    protein: Math.round(product.per100.protein * share),
    fat: Math.round(product.per100.fat * share),
    carbs: Math.round(product.per100.carbs * share),
    barcode: product.code,
  };
}
