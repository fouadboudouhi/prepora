// Geschmack: a few quick answers help the first plan. It can stop at any point, and the ratings after eating go on
// teaching the app anyway. What it knows is shown and can be taken back with a tap.
import { getTaste, saveTaste } from './actions.js';
import { DISHES } from './dishes.js';
import { esc, rerender } from './ui.js';

const chips = (field, values) =>
  `<div class="pills">${(values ?? [])
    .map(
      (value) =>
        `<button type="button" class="chip${field === 'likes' || field === 'loved' ? ' warm' : ''}" data-action="dropTaste" data-field="${field}" data-value="${esc(value)}" aria-label="${esc(value)} entfernen">${esc(value)}</button>`
    )
    .join('')}</div>`;
const section = (title, field, values) =>
  values?.length ? `<p class="caption">${title}</p>${chips(field, values)}` : '';

export function tasteView() {
  const taste = getTaste();
  const index = taste.index ?? 0;
  const dish = DISHES[index];
  const known = ['likes', 'dislikes', 'loved', 'never'].some((field) => taste[field]?.length);
  return `
    <button type="button" class="back" data-tab="more">Mehr</button>
    <h1>Dein Geschmack</h1>
    ${
      dish
        ? `<section class="hero" id="dishCard">
            <span class="eyebrow">${index + 1} von ${DISHES.length}. ${esc(dish.kind)}</span>
            <h2>${esc(dish.name)}</h2>
            <p>${esc(dish.facts)}</p>
            <div class="three">
              <button type="button" class="secondary" data-action="answerDish" data-answer="no">Nein</button>
              <button type="button" class="secondary" data-action="answerDish" data-answer="okay">Okay</button>
              <button type="button" class="primary" data-action="answerDish" data-answer="love">Lecker</button>
            </div>
          </section>`
        : ''
    }
    ${known ? '' : dish ? '' : '<p>Noch nichts gelernt.</p>'}
    ${section('Magst du', 'likes', taste.likes)}
    ${section('Lieber nicht', 'dislikes', taste.dislikes)}
    ${section('Gerne wieder', 'loved', taste.loved)}
    ${section('Nie wieder', 'never', taste.never)}`;
}

export const tasteActions = {
  answerDish: (el) => {
    const taste = getTaste();
    const index = taste.index ?? 0;
    const dish = DISHES[index];
    if (!dish) return;
    const add = (field) => {
      taste[field] = [...new Set([...(taste[field] ?? []), dish.tag])];
    };
    if (el.dataset.answer === 'love') add('likes');
    if (el.dataset.answer === 'no') add('dislikes');
    taste.index = index + 1;
    saveTaste(taste);
    rerender();
  },
  dropTaste: (el) => {
    const taste = getTaste();
    taste[el.dataset.field] = (taste[el.dataset.field] ?? []).filter((value) => value !== el.dataset.value);
    saveTaste(taste);
    rerender();
  },
};
