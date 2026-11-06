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
import { icon } from './icons.js';
import { dailyTargets } from './nutrition.js';
import { MEALS, getProfile, saveProfile } from './profile.js';
import { boxCheck, mealName, mealNutrition, weekdayOf } from './planner.js';
import { shrink } from './photo.js';
import { dayLabel, errorText, esc, number, rerender } from './ui.js';

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
    if (meal.skipped) continue;
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

function boxLine(plan, date) {
  const { total, frozen, short } = boxCheck(plan, date, getProfile().boxes);
  const main = `${total} Boxen${frozen ? `, davon ${frozen} fürs Einfrieren` : ''}`;
  return short ? `${main}. Dir fehlen ${short}.` : `${main}.`;
}

// The fridge is where a box usually waits, so only the freezer is said.
const placeOf = (meal) =>
  meal.storage === 'freezer' ? '<span class="muted small block">Tiefkühler, am Vorabend auftauen</span>' : '';

function fridgeBlock() {
  const items = getFridge();
  return `
    <section class="fridge">
      ${
        fridgeState.busy
          ? '<p class="note" role="status">Claude schaut in deinen Kühlschrank …</p>'
          : `<label class="secondary as-button">${icon('camera')}Kühlschrank fotografieren<input id="fridgePhoto" type="file" accept="image/*" capture="environment" hidden></label>`
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

// Two boxes a day for a high target make each box very large. Cooking breakfast too spreads it over three.
const BIG_BOX = 900;
let breakfastAdded = false;
function bigBoxNote(plan) {
  if (breakfastAdded)
    return '<p class="note" id="bigBoxes" role="status">Frühstück kommt ab dem nächsten Plan dazu.</p>';
  const profile = getProfile();
  if (profile.meals?.includes('Frühstück') || profile.bigBoxesOk) return '';
  const boxes = plan.meals
    .filter((meal) => meal.recipeId)
    .map((meal) => mealNutrition(plan, meal)?.kcal ?? 0);
  const average = boxes.length ? boxes.reduce((sum, kcal) => sum + kcal, 0) / boxes.length : 0;
  if (average < BIG_BOX) return '';
  return `
    <section class="card" id="bigBoxes">
      <h2>Große Boxen</h2>
      <p>Jede Box hat ca. ${number(Math.round(average / 50) * 50)} kcal. Das ist viel auf einmal und passt oft nicht in eine normale Box. Kochst du Frühstück mit, verteilt es sich auf drei kleinere Boxen am Tag.</p>
      <button type="button" class="primary" data-action="addBreakfast">Ab nächster Woche Frühstück mitkochen</button>
      <button type="button" class="text-button" data-action="keepBigBoxes">Passt so</button>
    </section>`;
}

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
            <p class="plain" id="boxLine">${esc(boxLine(plan, cook.date))}</p>
            <button type="button" class="primary" data-action="startCook" data-date="${cook.date}">Kochtag starten</button>
          </section>`
        : ''
    }
    ${bigBoxNote(plan)}
    <div class="list" id="weekList">
      ${days
        .map((date) => {
          const meals = plan.meals.filter((meal) => meal.date === date && !meal.skipped);
          return `<div class="row stacked"><span>${esc(dayLabel(date))}</span>${meals
            .map(
              (meal) =>
                `<span class="meal${meal.eaten ? ' done' : ''}"><span class="muted">${esc(meal.meal)}</span><span><span class="dish block">${esc(mealName(plan, meal))}</span>${placeOf(meal)}</span></span>`
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
  addBreakfast: () => {
    const profile = getProfile();
    saveProfile({
      ...profile,
      meals: MEALS.filter((meal) => meal === 'Frühstück' || profile.meals?.includes(meal)),
    });
    breakfastAdded = true;
    rerender();
  },
  keepBigBoxes: () => {
    saveProfile({ ...getProfile(), bigBoxesOk: true });
    rerender();
  },
  newWeek: () => newWeek(),
  repeatWeek: () => repeatBestWeek(),
  replaceRecipe: (el) => replaceRecipe(el.dataset.id),
  dropFridge: (el) => {
    saveFridge(getFridge().filter((item) => item !== el.dataset.item));
    rerender();
  },
};
