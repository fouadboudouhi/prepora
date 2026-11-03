// Der Einkauf: in echten Packungen, mit einem Tipp abhaken. What stays over is said, so it can be planned for.
import { getPlan, getSupplements } from './actions.js';
import { shoppingList } from './planner.js';
import { read, write } from './store.js';
import { dayLabel, esc, number, rerender } from './ui.js';

export function shopView() {
  const plan = getPlan();
  if (!plan)
    return `<div class="card"><h2>Noch nichts zu kaufen</h2><p>Die Liste entsteht mit dem Wochenplan.</p><button type="button" class="primary" data-tab="plan">Zum Wochenplan</button></div>`;
  const checked = read('shop', {});
  const groups = shoppingList(plan, getSupplements().mine ?? []);
  const all = groups.flatMap((group) => group.items);
  const open = all.filter((item) => !checked[item.id]).length;
  return `
    <p class="sub" id="shopFor">Alles für die ganze Woche${plan.shopOn ? `, Einkauf ${esc(dayLabel(plan.shopOn))}` : ''}${plan.cost ? `. Geschätzt ca. ${number(plan.cost)} €` : ''}</p>
    <p class="sub" id="shopCount">${open ? `${open} von ${all.length} offen` : 'Alles im Wagen'}</p>
    ${groups
      .map(
        (group) => `
        <h2 class="section">${esc(group.name)}</h2>
        <div class="list">
          ${group.items
            .map((item) => {
              const on = !!checked[item.id];
              return `<button type="button" class="row check${on ? ' on' : ''}" data-action="toggleShop" data-id="${esc(item.id)}" aria-pressed="${on}">
                <span class="grow"><span class="block">${esc(item.name)}</span><span class="muted small">${esc(item.detail)}</span></span>
                <span class="ring" aria-hidden="true"></span>
              </button>`;
            })
            .join('')}
        </div>`
      )
      .join('')}`;
}

export const shopActions = {
  toggleShop: (el) => {
    const checked = read('shop', {});
    checked[el.dataset.id] = !checked[el.dataset.id];
    write('shop', checked);
    rerender();
  },
};
