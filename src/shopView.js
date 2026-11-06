// Der Einkauf: in echten Packungen, mit einem Tipp abhaken. What stays over is said, so it can be planned for.
import { getPlan, getSupplements } from './actions.js';
import { shoppingList, shoppingNotes } from './planner.js';
import { read, write } from './store.js';
import { dayLabel, esc, number, rerender } from './ui.js';

const listed = (entries) => entries.map((entry) => `${entry.name} (${number(entry.grams)} g)`).join(', ');

const itemRow = (item, on) => `
  <button type="button" class="row check${on ? ' on' : ''}" data-action="toggleShop" data-id="${esc(item.id)}" aria-pressed="${on}">
    <span class="grow"><span class="block">${esc(item.name)}</span><span class="muted small">${esc(item.detail)}</span></span>
    <span class="ring" aria-hidden="true"></span>
  </button>`;

// What is still to get comes first, by aisle; what is in the cart moves down out of the way.
export function shopView() {
  const plan = getPlan();
  if (!plan)
    return `<div class="card"><h2>Noch nichts zu kaufen</h2><p>Die Liste entsteht mit dem Wochenplan.</p><button type="button" class="primary" data-tab="plan">Zum Wochenplan</button></div>`;
  const checked = read('shop', {});
  const groups = shoppingList(plan, getSupplements().mine ?? []);
  const all = groups.flatMap((group) => group.items);
  const open = all.filter((item) => !checked[item.id]).length;
  const inCart = all.filter((item) => checked[item.id]);
  const notes = shoppingNotes(plan);
  return `
    <p class="sub" id="shopFor">Alles für die ganze Woche${plan.shopOn ? `, Einkauf ${esc(dayLabel(plan.shopOn))}` : '.'}${plan.cost ? ` Geschätzt ca. ${number(plan.cost)} €` : ''}</p>
    <p class="sub" id="shopCount">${open ? `${open} von ${all.length} offen` : 'Alles im Wagen'}</p>
    ${notes.fromHome.length ? `<p class="note" id="fromHome">Schon zu Hause und abgezogen: ${esc(listed(notes.fromHome))}.</p>` : ''}
    ${groups
      .map((group) => ({ ...group, items: group.items.filter((item) => !checked[item.id]) }))
      .filter((group) => group.items.length)
      .map(
        (group) => `
        <h2 class="section">${esc(group.name)}</h2>
        <div class="list">${group.items.map((item) => itemRow(item, false)).join('')}</div>`
      )
      .join('')}
    ${
      inCart.length
        ? `<h2 class="section">Im Wagen</h2><div class="list" id="inCart">${inCart.map((item) => itemRow(item, true)).join('')}</div>`
        : ''
    }
    ${
      notes.left.length
        ? `<details class="guide" id="leftOver">
             <summary>Bleibt übrig: ${notes.left.length} ${notes.left.length === 1 ? 'Sache' : 'Sachen'}</summary>
             <div><p>Kommt in den nächsten Plan.</p><dl>${notes.left
               .map((entry) => `<dt>${esc(entry.name)}</dt><dd>ca. ${number(entry.grams)} g</dd>`)
               .join('')}</dl></div>
           </details>`
        : ''
    }`;
}

export const shopActions = {
  toggleShop: (el) => {
    const checked = read('shop', {});
    checked[el.dataset.id] = !checked[el.dataset.id];
    write('shop', checked);
    rerender();
  },
};
