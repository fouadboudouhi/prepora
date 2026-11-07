// Vorrat: what is at home. Leftovers from earlier shops come in by themselves; here they can be put right, and the
// fridge note and the freezer sit next to them. The next shop list and the next plan take it from here.
import { changePantry, getFridge, getPantry, getStock, PANTRY_PLACES, saveFridge } from './actions.js';
import { icon } from './icons.js';
import { dayLabel, esc, number, rerender } from './ui.js';

const PLACE_WORD = {
  Vorrat: 'Vorratsschrank',
  Kühlregal: 'Kühlschrank',
  'Gemüse und Obst': 'Obst und Gemüse',
  'Fleisch und Fisch': 'Fleisch und Fisch',
  Tiefkühl: 'Tiefkühler',
};

const placeSelect = (name, chosen, label) =>
  `<select class="amount place" name="${name}" aria-label="${esc(label)}">${PANTRY_PLACES.map(
    (place) =>
      `<option value="${esc(place)}"${place === chosen ? ' selected' : ''}>${esc(PLACE_WORD[place])}</option>`
  ).join('')}</select>`;

export function pantryView() {
  const pantry = getPantry();
  const fridge = getFridge();
  const stock = getStock();
  const portions = stock.reduce((sum, item) => sum + item.portions, 0);
  return `
    <button type="button" class="back" data-tab="more">Mehr</button>
    <h1>Vorrat</h1>
    <p class="sub">Was du zu Hause hast. Es kommt von der Einkaufsliste runter und der nächste Plan verbraucht es zuerst.</p>
    <h2 class="section">Zu Hause</h2>
    ${
      pantry.length
        ? `<div class="list" id="pantryList">${pantry
            .map(
              (entry) => `
          <div class="row pantry-row" data-key="${esc(entry.id)}">
            <span class="grow"><span class="block">${esc(entry.name)}</span><span class="muted small">${esc(PLACE_WORD[entry.category] ?? 'Vorrat')}, seit ${esc(dayLabel(entry.since))}</span></span>
            <span class="entry"><input type="number" inputmode="numeric" min="0" max="50000" step="10" name="pantryGrams" data-id="${esc(entry.id)}" data-name="${esc(entry.name)}" value="${entry.grams}" aria-label="Gramm ${esc(entry.name)}"><span>g</span></span>
            <button type="button" class="mini" data-action="pantryRemove" data-name="${esc(entry.name)}" aria-label="${esc(entry.name)} entfernen">${icon('close')}</button>
          </div>`
            )
            .join('')}</div>`
        : '<p class="note">Noch nichts. Nach dem ersten Einkauf steht hier, was übrig bleibt.</p>'
    }
    <form id="pantryAdd" class="composer add-line" novalidate>
      <input name="name" type="text" maxlength="80" placeholder="Hinzufügen, z. B. Reis" aria-label="Was hast du da?" autocomplete="off">
      <input name="grams" class="dose" type="number" inputmode="numeric" min="1" max="50000" placeholder="g" aria-label="Gramm">
      ${placeSelect('place', 'Vorrat', 'Wo es liegt')}
      <button type="submit" class="send" aria-label="Hinzufügen">${icon('plus')}</button>
    </form>
    <h2 class="section">Im Kühlschrank, schnell verbrauchen</h2>
    ${
      fridge.length
        ? `<div class="pills" id="fridgeList">${fridge
            .map(
              (item) =>
                `<button type="button" class="chip" data-action="fridgeRemove" data-item="${esc(item)}" aria-label="${esc(item)} entfernen">${esc(item)} ${icon('close')}</button>`
            )
            .join('')}</div>`
        : ''
    }
    <form id="fridgeAdd" class="composer add-line" novalidate>
      <input name="item" type="text" maxlength="80" placeholder="Hinzufügen, z. B. halbe Paprika" aria-label="Was ist im Kühlschrank?" autocomplete="off">
      <button type="submit" class="send" aria-label="Hinzufügen">${icon('plus')}</button>
    </form>
    <div class="list" id="pantryMore">
      <button type="button" class="row go" data-tab="stock">
        <span class="tile">${icon('snow')}</span>
        <span class="grow"><span class="block">Tiefkühler</span><span class="muted small">${number(portions)} ${portions === 1 ? 'Portion' : 'Portionen'} fertig gekocht</span></span>
      </button>
    </div>
    <p class="note">Du kannst das auch Claude sagen, etwa „Ich habe noch 500 g Reis und keine Eier mehr“.</p>`;
}

export function addPantry(form) {
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim();
  const grams = Number(data.get('grams'));
  if (!name || !(grams > 0)) return;
  changePantry([{ name, grams, category: String(data.get('place') ?? 'Vorrat'), rename: true }]);
  rerender();
}

export function addFridgeItem(form) {
  const item = String(new FormData(form).get('item') ?? '')
    .trim()
    .slice(0, 80);
  if (!item) return;
  saveFridge([...getFridge().filter((entry) => entry !== item), item].slice(0, 30));
  rerender();
}

// The field already shows the new amount, so only a removal redraws; a tap right after still lands where it aims.
export function setPantryGrams(input) {
  const grams = Number(input.value);
  changePantry([{ id: input.dataset.id, name: input.dataset.name, grams }]);
  if (!(grams > 0)) rerender();
}

export const pantryActions = {
  pantryRemove: (el) => {
    changePantry([{ name: el.dataset.name, grams: 0 }]);
    rerender();
  },
  fridgeRemove: (el) => {
    saveFridge(getFridge().filter((item) => item !== el.dataset.item));
    rerender();
  },
};
