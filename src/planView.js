// Der Wochenplan: one tap makes a week. Everything else on this screen is optional.
import {
  bestWeek,
  getFridge,
  getPlan,
  newWeek,
  planning,
  repeatBestWeek,
  replaceRecipe,
  saveFridge,
} from './actions.js';
import { askClaudeJson } from './ai.js';
import { dailyTargets } from './nutrition.js';
import { getProfile } from './profile.js';
import { mealName, mealNutrition, weekdayOf } from './planner.js';
import { dayLabel, errorText, esc, number, rerender } from './ui.js';

const PHOTO_SIZE = 1280;
const fridgeState = { busy: false, error: null };

const FRIDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: { items: { type: 'array', items: { type: 'string' } } },
};

function dailyAverage(plan) {
  const days = new Map();
  for (const meal of plan.meals) {
    const value = mealNutrition(plan, meal);
    const day = days.get(meal.date) ?? { kcal: 0, protein: 0 };
    days.set(meal.date, {
      kcal: day.kcal + (value?.kcal ?? 0),
      protein: day.protein + (value?.protein ?? 0),
    });
  }
  const all = [...days.values()];
  const mean = (key) => Math.round(all.reduce((sum, day) => sum + day[key], 0) / (all.length || 1));
  return { kcal: mean('kcal'), protein: mean('protein') };
}

const placeOf = (meal) => (meal.storage === 'freezer' ? `Tiefkühler, am Vorabend auftauen` : 'Kühlschrank');

function fridgeBlock() {
  const items = getFridge();
  return `
    <section class="fridge">
      ${
        fridgeState.busy
          ? '<p class="note" role="status">Claude schaut in deinen Kühlschrank …</p>'
          : `<label class="secondary as-button">Kühlschrank fotografieren<input id="fridgePhoto" type="file" accept="image/*" capture="environment" hidden></label>`
      }
      ${fridgeState.error ? `<p class="error" role="alert">${esc(errorText(fridgeState.error))}</p>` : ''}
      ${
        items.length
          ? `<p class="caption">Kommt in den nächsten Plan, antippen zum Entfernen</p>
             <div class="pills">${items
               .map(
                 (item) =>
                   `<button type="button" class="chip" data-action="dropFridge" data-item="${esc(item)}">${esc(item)}</button>`
               )
               .join('')}</div>`
          : ''
      }
    </section>`;
}

const busyBlock = () => `
  <section class="hero" role="status">
    <span class="eyebrow">${planning.replacing ? 'Gericht wird ersetzt' : 'Deine Woche entsteht'}</span>
    <h2>Claude plant</h2>
    <p>Das dauert ein bis drei Minuten. Du kannst die App solange normal benutzen, sie aber nicht schließen.</p>
  </section>`;

export function planView() {
  const targets = dailyTargets(getProfile());
  if (!targets)
    return `
      <div class="card">
        <h2>Erst dein Ziel</h2>
        <p>Der Plan richtet sich nach deinen Kalorien und deinem Eiweiß.</p>
        <button type="button" class="primary" data-tab="profile">Profil ausfüllen</button>
      </div>`;
  const plan = getPlan();
  const error = planning.error ? `<p class="error" role="alert">${esc(errorText(planning.error))}</p>` : '';
  if (!plan)
    return `
      ${planning.busy ? busyBlock() : `<div class="card"><h2>Deine Woche</h2><p>Einmal tippen. Claude plant nach deinem Ziel und deinem Geschmack.</p><button type="button" class="primary" data-action="newWeek">Woche planen</button></div>`}
      ${error}
      ${fridgeBlock()}`;

  const cook = plan.cookDays.find((day) => !day.done);
  const average = dailyAverage(plan);
  const days = [...new Set(plan.meals.map((meal) => meal.date))];
  const best = bestWeek();
  return `
    <p class="sub">Im Schnitt ca. ${number(average.kcal)} kcal, ${number(average.protein)} g Eiweiß am Tag</p>
    ${planning.busy ? busyBlock() : ''}
    ${error}
    ${
      cook
        ? `<section class="hero">
            <span class="eyebrow">Kochtag, ${esc(weekdayOf(cook.date))}, ${esc(dayLabel(cook.date).split(', ')[1])}</span>
            <h2>Etwa ${cook.minutes} Minuten</h2>
            <p>${esc(
              plan.recipes
                .filter((recipe) => recipe.cookDate === cook.date)
                .map((recipe) => recipe.name)
                .join(', ')
            )}</p>
            <button type="button" class="primary" data-action="startCook" data-date="${cook.date}">Kochtag starten</button>
          </section>`
        : ''
    }
    <div class="list" id="weekList">
      ${days
        .map((date) => {
          const meals = plan.meals.filter((meal) => meal.date === date);
          return `<div class="row stacked"><span>${esc(dayLabel(date))}</span>${meals
            .map(
              (meal) =>
                `<span class="muted${meal.eaten ? ' done' : ''}">${esc(meal.meal)}: ${esc(mealName(plan, meal))}. ${esc(placeOf(meal))}</span>`
            )
            .join('')}</div>`;
        })
        .join('')}
    </div>
    <h2 class="section">Gerichte</h2>
    <div class="list" id="recipeList">
      ${plan.recipes
        .map(
          (recipe) => `
          <div class="row">
            <span class="grow">
              <span class="block">${esc(recipe.name)}</span>
              <span class="muted small">ca. ${number(recipe.nutrition.kcal)} kcal, ${number(recipe.nutrition.protein)} g Eiweiß${recipe.estimated ? ', teils geschätzt' : ''}</span>
            </span>
            <button type="button" class="text-button" data-action="replaceRecipe" data-id="${esc(recipe.id)}"${planning.busy ? ' disabled' : ''} aria-label="${esc(recipe.name)} ersetzen">Ersetzen</button>
          </div>`
        )
        .join('')}
    </div>
    ${fridgeBlock()}
    <button type="button" class="secondary" data-action="newWeek"${planning.busy ? ' disabled' : ''}>Neue Woche planen</button>
    ${best ? `<button type="button" class="secondary" data-action="repeatWeek">Beste Woche wiederholen</button>` : ''}`;
}

// A photo is sent small: it costs less and shows enough.
function shrink(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('photo'));
    };
    image.onload = () => {
      const scale = Math.min(1, PHOTO_SIZE / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8).split(',')[1]);
    };
    image.src = url;
  });
}

export async function readFridgePhoto(file) {
  fridgeState.busy = true;
  fridgeState.error = null;
  rerender();
  try {
    const data = await shrink(file);
    const { items } = await askClaudeJson({
      maxTokens: 4000,
      effort: 'low',
      format: FRIDGE_SCHEMA,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
            {
              type: 'text',
              text: 'Welche Lebensmittel sind auf diesem Foto eines Kühlschranks zu erkennen? Nenne jedes kurz auf Deutsch, ohne Getränke und Saucen. Ist auf dem Foto kein Essen zu sehen, gib eine leere Liste zurück.',
            },
          ],
        },
      ],
    });
    saveFridge([...new Set([...getFridge(), ...items.map(String)])]);
  } catch (err) {
    fridgeState.error = err;
  }
  fridgeState.busy = false;
  rerender();
}

export const planActions = {
  newWeek: () => newWeek(),
  repeatWeek: () => repeatBestWeek(),
  replaceRecipe: (el) => replaceRecipe(el.dataset.id),
  dropFridge: (el) => {
    saveFridge(getFridge().filter((item) => item !== el.dataset.item));
    rerender();
  },
};
