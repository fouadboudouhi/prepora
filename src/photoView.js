// Essen fotografieren: one photo gives a range, or the honest word that it would only be a guess. Then a name helps.
import { addExtra } from './actions.js';
import { askClaudeJson } from './ai.js';
import { DISH_SCHEMA, DISH_SYSTEM, assessDish } from './dish.js';
import { imageBlock, shrink } from './photo.js';
import { localDay } from './planner.js';
import { errorText, esc, number, openView, rerender } from './ui.js';

const state = { busy: false, image: null, assessed: null, error: null, added: false };

async function ask(note) {
  state.busy = true;
  state.error = null;
  state.assessed = null;
  rerender();
  try {
    const result = await askClaudeJson({
      system: DISH_SYSTEM,
      maxTokens: 6000,
      effort: 'medium',
      format: DISH_SCHEMA,
      messages: [
        {
          role: 'user',
          content: [
            imageBlock(state.image),
            {
              type: 'text',
              text: note ? `Der Mensch sagt dazu: ${note}` : 'Was ist das, und wie viel hat es?',
            },
          ],
        },
      ],
    });
    state.assessed = assessDish(result);
  } catch (err) {
    state.error = err;
  }
  state.busy = false;
  rerender();
}

export async function readDishPhoto(file) {
  Object.assign(state, { busy: true, assessed: null, error: null, added: false });
  openView('photo');
  try {
    state.image = await shrink(file);
  } catch {
    state.busy = false;
    state.image = null;
    state.error = { code: 'server', detail: 'Das Foto ließ sich nicht lesen.' };
    rerender();
    return;
  }
  await ask();
}

export function recheckDish(name) {
  const text = name.trim();
  if (text && state.image) ask(text);
}

const fixForm = (label) => `
  <form id="dishFix" class="inline-form" novalidate>
    <label class="field">${label}
      <input name="name" type="text" maxlength="120" placeholder="Zum Beispiel: Lasagne, kleine Portion">
    </label>
    <button type="submit" class="secondary">Nochmal prüfen</button>
  </form>`;

function result() {
  const a = state.assessed;
  if (a.kind === 'notfood')
    return `<section class="hero" id="dishResult"><h2>Kein Essen erkannt</h2><p>Versuch es mit einem Foto von oben, auf dem der ganze Teller zu sehen ist.</p></section>`;
  if (a.kind === 'unsure')
    return `
      <section class="hero" id="dishResult">
        <span class="eyebrow">Zu unsicher für eine Zahl</span>
        <h2>${esc(a.dish || 'Nicht sicher erkennbar')}</h2>
        <p>${esc(a.reason || 'Das Foto reicht dafür nicht aus.')}</p>
      </section>
      ${fixForm('Was ist es, und wie viel davon?')}`;
  return `
    <section class="hero" id="dishResult">
      <span class="eyebrow">Sicherheit: ${esc(a.confidence)}</span>
      <h2>${esc(a.dish)}</h2>
      <p class="big" id="dishRange">ca. ${number(a.low)}–${number(a.high)} kcal</p>
      <p class="plain">Etwa ${number(a.protein)} g Eiweiß${a.portion ? `. ${esc(a.portion)}` : ''}</p>
      ${a.components.length ? `<p>${esc(a.components.join(', '))}</p>` : ''}
      <p>Schätzung vom Foto. Öl, Butter und Saucen sieht man kaum, im Zweifel eher oben rechnen.</p>
      ${
        state.added
          ? '<p class="plain" role="status">Zu heute hinzugefügt.</p>'
          : `<button type="button" class="primary" data-action="addDish">Zu heute hinzufügen</button>`
      }
    </section>
    ${fixForm('Stimmt nicht? Was ist es?')}`;
}

export function photoView() {
  return `
    <button type="button" class="back" data-tab="today">Heute</button>
    <h1>Essen schätzen</h1>
    ${state.busy ? '<p class="note" role="status">Claude schaut sich das an …</p>' : ''}
    ${state.error ? `<p class="error" role="alert">${esc(errorText(state.error))}</p>` : ''}
    ${state.assessed ? result() : ''}
    ${state.busy ? '' : `<label class="secondary as-button">Neues Foto<input id="dishPhoto" type="file" accept="image/*" capture="environment" hidden></label>`}`;
}

export const photoActions = {
  addDish: () => {
    const a = state.assessed;
    if (a?.kind !== 'estimate' || state.added) return;
    addExtra(localDay(), { name: a.dish, kcal: a.middle, protein: a.protein, estimated: true });
    state.added = true;
    rerender();
  },
};
