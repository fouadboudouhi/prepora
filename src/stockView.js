// Der Tiefkühler: was drin liegt und seit wann. The next plan uses it up first, without being asked.
import { getPlan, getStock, saveStock } from './actions.js';
import { localDay, weekdayOf } from './planner.js';
import { dayLabel, esc, rerender } from './ui.js';

const OLD_DAYS = 90;
const DAY = 86400000;
const isOld = (item) => Date.now() - Date.parse(item.frozenAt) > OLD_DAYS * DAY;

// Boxes of the current plan that wait in the freezer for a day of their own, so the free ones are told apart.
export function plannedOf(item, plan = getPlan()) {
  if (!plan || !item.recipeId) return [];
  return plan.meals.filter(
    (meal) =>
      meal.storage === 'freezer' &&
      meal.recipeId === item.recipeId &&
      !meal.eaten &&
      !meal.skipped &&
      !meal.missed
  );
}
const plannedLine = (item) => {
  const planned = plannedOf(item);
  if (!planned.length) return '';
  const people = getPlan()?.people ?? 1;
  const count = Math.min(item.portions, planned.length * people);
  return `, ${count === item.portions ? 'alle' : count} eingeplant für ${planned.map((meal) => weekdayOf(meal.date).slice(0, 2)).join(', ')}`;
};

export function stockView() {
  const stock = getStock();
  return `
    <button type="button" class="back" data-tab="more">Mehr</button>
    <h1>Tiefkühler</h1>
    ${stock.length ? '' : '<p>Noch nichts drin. Nach dem Kochtag landet es von selbst hier.</p>'}
    <div class="list" id="stockList">
      ${stock
        .map(
          (item) => `
          <div class="row">
            <span class="grow">
              <span class="block">${esc(item.name)}</span>
              <span class="muted small">Seit ${esc(dayLabel(item.frozenAt))}${isOld(item) ? ', bald essen' : ''}${esc(plannedLine(item))}</span>
            </span>
            <button type="button" class="round" data-action="stockLess" data-id="${esc(item.id)}" aria-label="Eine Portion ${esc(item.name)} weniger">−</button>
            <span class="count">${item.portions}</span>
          </div>`
        )
        .join('')}
    </div>
    <form id="stockAdd" class="inline-form" novalidate>
      <label class="field">Selbst etwas eintragen
        <input name="name" type="text" maxlength="60" placeholder="Zum Beispiel Linsen-Dal">
      </label>
      <button type="submit" class="secondary">Eine Portion dazu</button>
    </form>`;
}

export function addStock(name) {
  const text = name.trim();
  if (!text) return;
  const stock = getStock();
  const found = stock.find((item) => item.name.toLowerCase() === text.toLowerCase());
  if (found) found.portions += 1;
  else stock.push({ id: `s-${Date.now()}`, name: text, portions: 1, frozenAt: localDay(), nutrition: null });
  saveStock(stock);
  rerender();
}

export const stockActions = {
  stockLess: (el) => {
    const stock = getStock();
    const item = stock.find((entry) => entry.id === el.dataset.id);
    if (item) item.portions -= 1;
    saveStock(stock.filter((entry) => entry.portions > 0));
    rerender();
  },
};
