// Der Wochenplan: one tap makes a week. Everything else on this screen is optional.
import { cookButton } from './cookView.js';
import {
  bestWeek,
  deleteOldPlans,
  discardPlan,
  dropDays,
  getHistory,
  getFridge,
  getPlan,
  newWeek,
  planShape,
  planning,
  repeatBestWeek,
  replaceRecipe,
  saveFridge,
} from './actions.js';
import { askClaudeJson } from './ai.js';
import { icon } from './icons.js';
import { dailyTargets } from './nutrition.js';
import { MEALS, getProfile, saveProfile } from './profile.js';
import {
  FRIDGE_DAYS,
  MAX_COOK_DAYS,
  MAX_PLAN_DAYS,
  boxCheck,
  localDay,
  mealName,
  mealNutrition,
  weekdayOf,
} from './planner.js';
import { shrink } from './photo.js';
import { dayLabel, errorText, esc, number, rerender } from './ui.js';

const fridgeState = { busy: false, error: null };

// A new plan of any length: days, cook days and the start are chosen here, the wish is optional.
const shape = {
  open: false,
  days: null,
  cookDays: null,
  start: 'next',
  wish: '',
  confirmDiscard: false,
  confirmDrop: null,
};
const START_WORDS = [
  ['today', 'Heute'],
  ['tomorrow', 'Morgen'],
  ['next', ''],
];

function freshLine(result, profile) {
  if (result.note) return result.note;
  const longest = Math.ceil(result.days / result.cookDays);
  if (longest <= FRIDGE_DAYS) return 'Alles hält im Kühlschrank bis zum Essen.';
  return profile.freezer === false
    ? 'Ohne Tiefkühler bleibt alles frisch, weil öfter gekocht wird.'
    : `Was länger als ${FRIDGE_DAYS} Tage stehen würde, kommt in den Tiefkühler. Die App erinnert ans Auftauen.`;
}

function shapeBlock() {
  const profile = getProfile();
  const result = planShape({ days: shape.days, cookDays: shape.cookDays, start: shape.start });
  shape.days = result.days;
  shape.cookDays = result.cookDays;
  const stepper = (key, value, low, high, word) => `
    <div class="row stepper-row">
      <span class="grow">${word}</span>
      <span class="stepper">
        <button type="button" class="round" data-action="shapeStep" data-key="${key}" data-by="-1" aria-label="${word}: weniger"${value <= low ? ' disabled' : ''}>−</button>
        <output id="shape-${key}" aria-live="polite">${value}</output>
        <button type="button" class="round" data-action="shapeStep" data-key="${key}" data-by="1" aria-label="${word}: mehr"${value >= high ? ' disabled' : ''}>+</button>
      </span>
    </div>`;
  return `
    <section class="card" id="planShape">
      <h2>Neuer Plan</h2>
      <div class="list">
        ${stepper('days', result.days, 1, MAX_PLAN_DAYS, 'Tage mit Boxen')}
        ${stepper('cookDays', result.cookDays, 1, Math.min(MAX_COOK_DAYS, result.days), 'Kochtage')}
        <div class="row"><span class="grow">Start</span>
          <span class="segmented" role="group" aria-label="Erster Kochtag">${START_WORDS.map(
            ([value, word]) =>
              `<button type="button" data-action="shapeStart" data-start="${value}" aria-pressed="${shape.start === value}">${value === 'next' ? esc(weekdayOf(planShape().start)) : word}</button>`
          ).join('')}</span>
        </div>
      </div>
      <p class="small muted" id="shapeLine">${esc(dayLabel(result.start))} kochen, ${result.days} ${result.days === 1 ? 'Tag' : 'Tage'} essen. ${esc(freshLine(result, profile))}</p>
      <textarea name="shapeWish" rows="2" maxlength="300" placeholder="Wunsch, z. B. mehr Hähnchen, nichts Scharfes" aria-label="Wunsch für den Plan">${esc(shape.wish)}</textarea>
      <button type="button" class="primary" data-action="shapePlan"${planning.busy ? ' disabled' : ''}>Plan erstellen</button>
      <button type="button" class="text-button" data-action="shapeClose">Abbrechen</button>
    </section>`;
}

// Earlier plans: one tap shows the count, a second deletes them. The current plan is never part of it.
function oldPlansRow() {
  const count = getHistory().length;
  if (!count && !shape.deletedOld) return '';
  if (!count)
    return `<div class="row" id="oldPlans"><span class="grow muted">Frühere Pläne gelöscht</span></div>`;
  return `<button type="button" class="row danger-row" data-action="deleteOldPlans" id="oldPlans">
      <span class="grow"><span class="block">${shape.confirmOld ? 'Wirklich löschen? Nochmal tippen' : `Frühere Pläne löschen (${count})`}</span><span class="muted small">Der aktuelle Plan bleibt, Gegessenes bleibt gezählt</span></span>
    </button>`;
}

export const keepShapeWish = (text) => {
  shape.wish = text;
};

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
// The fridge is where a box usually waits, so only the freezer gets a mark; what it means is said once below.
const placeOf = (meal) =>
  meal.storage === 'freezer'
    ? `<span class="frozen" title="Aus dem Tiefkühler">${icon('snow')}<span class="sr">Aus dem Tiefkühler</span></span>`
    : '';

function fridgeRow() {
  return fridgeState.busy
    ? '<div class="row" role="status"><span class="muted">Claude schaut in deinen Kühlschrank …</span></div>'
    : `<label class="row go"><span class="tile">${icon('camera')}</span><span class="grow"><span class="block">Kühlschrank fotografieren</span><span class="muted small">Was drin ist, kommt in den Plan</span></span><input id="fridgePhoto" type="file" accept="image/*" capture="environment" hidden></label>`;
}

function fridgeItems() {
  const items = getFridge();
  return `
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
    }`;
}

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
      <p>Jede Box hat ca. ${number(Math.round(average / 50) * 50)} kcal. Das ist viel auf einmal und passt oft nicht in eine normale Box. Kochst du ab der nächsten Woche Frühstück mit, verteilt es sich auf drei kleinere Boxen am Tag.</p>
      <button type="button" class="primary" data-action="addBreakfast">Frühstück mitkochen</button>
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
      ${shape.open && !planning.busy ? shapeBlock() : planning.busy ? busyBlock() : `<div class="card"><h2>Dein Plan</h2><p>Einmal tippen. Claude plant nach deinem Ziel und deinem Geschmack.</p><button type="button" class="primary" data-action="newWeek">Plan erstellen</button><button type="button" class="text-button" data-action="shapeOpen">Tage und Kochtage wählen</button></div>`}
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
    ${plan.note ? `<p class="note" id="planNote">${esc(plan.note)}</p>` : ''}
    ${shape.open && !planning.busy ? shapeBlock() : ''}
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
            <button type="button" class="primary" data-action="startCook" data-date="${cook.date}">${cookButton(cook.date)}</button>
          </section>`
        : ''
    }
    ${bigBoxNote(plan)}
    <div class="list" id="weekList">
      ${days
        .map((date) => {
          const meals = plan.meals.filter((meal) => meal.date === date && !meal.skipped);
          const canDrop = date >= localDay() && !meals.some((meal) => meal.eaten) && !planning.busy;
          const asking = shape.confirmDrop === date;
          return `<div class="row stacked" data-date="${date}"><span class="day-head"><span>${esc(dayLabel(date))}</span>${
            canDrop
              ? `<button type="button" class="text-button${asking ? ' danger' : ''}" data-action="dropDay" data-date="${date}">${asking ? 'Wirklich raus?' : 'Entfernen'}<span class="sr">: ${esc(dayLabel(date))}</span></button>`
              : ''
          }</span>${meals
            .map(
              (meal) =>
                `<span class="meal${meal.eaten ? ' done' : ''}"><span class="muted">${esc(meal.meal)}</span><span class="dish">${esc(mealName(plan, meal))}${placeOf(meal)}</span></span>`
            )
            .join('')}</div>`;
        })
        .join('')}
    </div>
    ${
      plan.meals.some((meal) => meal.storage === 'freezer')
        ? `<p class="note" id="freezerNote">${icon('snow')} kommt aus dem Tiefkühler. Am Vorabend in den Kühlschrank legen, die App erinnert dich.</p>`
        : ''
    }
    ${
      plan.fillers?.length
        ? `<h2 class="section">Dazu, wenn du magst</h2>
           <p class="sub">Ohne Kochen, für den Rest deines Tagesziels. Steht auf der Einkaufsliste unter Optional.</p>
           <div class="list" id="fillerList">${plan.fillers
             .map(
               (filler) =>
                 `<div class="row"><span class="grow"><span class="block">${esc(filler.name)}</span><span class="muted small">${esc(filler.when ?? '')}${filler.nutrition?.kcal ? `, ca. ${number(filler.nutrition.kcal)} kcal` : ''}</span></span></div>`
             )
             .join('')}</div>`
        : ''
    }
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
    <h2 class="section">Plan ändern</h2>
    <div class="list" id="planMore">
      <button type="button" class="row go" data-action="shapeOpen"${planning.busy ? ' disabled' : ''}>
        <span class="tile">${icon('plan')}</span>
        <span class="grow"><span class="block">Neu planen</span><span class="muted small">Tage, Kochtage und Start frei wählen</span></span>
      </button>
      ${
        best
          ? `<button type="button" class="row go" data-action="repeatWeek">
               <span class="tile">${icon('repeat')}</span>
               <span class="grow"><span class="block">Beste Woche wiederholen</span><span class="muted small">Ohne Claude, kostet nichts</span></span>
             </button>`
          : ''
      }
      ${fridgeRow()}
      <button type="button" class="row danger-row" data-action="discardPlan" id="discardPlan"${planning.busy ? ' disabled' : ''}>
        <span class="grow"><span class="block">${shape.confirmDiscard ? 'Wirklich verwerfen? Nochmal tippen' : 'Plan verwerfen'}</span><span class="muted small">Schon Gegessenes bleibt gezählt</span></span>
      </button>
      ${oldPlansRow()}
    </div>
    ${fridgeItems()}`;
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
  shapeOpen: () => {
    Object.assign(shape, { open: true, confirmDiscard: false });
    rerender();
    document.getElementById('planShape')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  },
  shapeClose: () => {
    shape.open = false;
    rerender();
  },
  shapeStep: (el) => {
    const key = el.dataset.key;
    shape[key] = (shape[key] ?? 1) + Number(el.dataset.by);
    if (key === 'days') shape.cookDays = Math.min(shape.cookDays ?? 1, shape.days);
    rerender();
  },
  shapeStart: (el) => {
    shape.start = el.dataset.start;
    rerender();
  },
  shapePlan: () => {
    const options = { days: shape.days, cookDays: shape.cookDays };
    if (shape.start !== 'next') options.start = shape.start;
    const wish = shape.wish.trim();
    Object.assign(shape, { open: false, wish: '' });
    newWeek(wish, options);
  },
  deleteOldPlans: () => {
    if (!shape.confirmOld) {
      shape.confirmOld = true;
      rerender();
      return;
    }
    shape.confirmOld = false;
    shape.deletedOld = deleteOldPlans() > 0;
    rerender();
  },
  discardPlan: () => {
    if (!shape.confirmDiscard) {
      shape.confirmDiscard = true;
      rerender();
      return;
    }
    shape.confirmDiscard = false;
    discardPlan();
    rerender();
  },
  dropDay: (el) => {
    const date = el.dataset.date;
    if (shape.confirmDrop !== date) {
      shape.confirmDrop = date;
      rerender();
      return;
    }
    shape.confirmDrop = null;
    dropDays([date]);
    rerender();
  },
  repeatWeek: () => repeatBestWeek(),
  replaceRecipe: (el) => replaceRecipe(el.dataset.id),
  dropFridge: (el) => {
    saveFridge(getFridge().filter((item) => item !== el.dataset.item));
    rerender();
  },
};
