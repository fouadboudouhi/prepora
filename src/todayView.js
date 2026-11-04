// Heute: what to eat now and the one thing to do next. Eating is one tap; rating it is a second, optional one.
import { addExtra, eat, getExtras, getPlan, getSupplements, rate, saveSupplements, skip } from './actions.js';
import { dailyTargets, GOALS } from './nutrition.js';
import { icon } from './icons.js';
import { getProfile } from './profile.js';
import { localDay, mealName, mealNutrition, recipeOf } from './planner.js';
import { targetText } from './profileView.js';
import { dayLabel, esc, number, rerender } from './ui.js';

let justEaten = null;
let notice = '';
const GAP_KCAL = 150;
const GAP_PROTEIN = 15;
const SKIP_NOTES = {
  frozen: 'Die Box kommt in den Tiefkühler und steht in deiner Liste.',
  moved: 'Die Box wandert auf morgen, sie hält noch.',
  dropped: 'Gestrichen.',
  expired: 'Diese Box hält nicht länger. Heute essen oder entsorgen.',
};

const whereItIs = (plan, meal, today) => {
  const reheat = recipeOf(plan, meal.recipeId)?.reheat;
  const place =
    meal.storage === 'freezer'
      ? meal.date === today
        ? 'Aufgetaut im Kühlschrank'
        : 'Im Tiefkühler'
      : 'Im Kühlschrank';
  return reheat ? `${place}. ${reheat}` : place;
};
const portionLine = (nutrition) =>
  nutrition ? `ca. ${number(nutrition.kcal)} kcal, ${number(nutrition.protein)} g Eiweiß` : '';

function dayTotal(plan, today, key, upcoming = false) {
  const meals = (plan?.meals ?? []).filter(
    (meal) => meal.date === today && !meal.skipped && (upcoming || meal.eaten)
  );
  const fromMeals = meals.reduce((total, meal) => total + (mealNutrition(plan, meal)?.[key] ?? 0), 0);
  return fromMeals + getExtras(today).reduce((total, extra) => total + (extra[key] ?? 0), 0);
}

function progress(plan, today, targets) {
  if (!targets) return '';
  const sum = (key) => dayTotal(plan, today, key);
  const bar = (value, goal) =>
    `<span class="bar"><span style="width:${Math.min(100, Math.round((value / goal) * 100))}%"></span></span>`;
  return `
    <section class="day-line">
      <div><strong>${number(sum('kcal'))}</strong> <span class="muted">von ${number(targets.kcal)} kcal</span>${bar(sum('kcal'), targets.kcal)}</div>
      <div><strong>${number(sum('protein'))} g</strong> <span class="muted">von ${number(targets.protein)} g Eiweiß</span>${bar(sum('protein'), targets.protein)}</div>
    </section>`;
}

// What today's boxes leave open, and what fills it without cooking.
function gapBlock(plan, today, targets) {
  const kcal = targets.kcal - dayTotal(plan, today, 'kcal', true);
  const protein = targets.protein - dayTotal(plan, today, 'protein', true);
  if (kcal < GAP_KCAL && protein < GAP_PROTEIN) return '';
  const fillers = plan?.fillers ?? [];
  return `
    <section id="gap">
      <h2 class="section">Noch offen: ${[kcal > 0 ? `ca. ${number(kcal)} kcal` : '', protein > 0 ? `${number(protein)} g Eiweiß` : ''].filter(Boolean).join(', ')}</h2>
      ${
        fillers.length
          ? `<div class="list">${fillers
              .map(
                (filler) => `
                <div class="row">
                  <span class="grow">
                    <span class="block">${esc(filler.name)}</span>
                    <span class="muted small">${esc(filler.when)}, ca. ${number(filler.nutrition.kcal)} kcal, ${number(filler.nutrition.protein)} g Eiweiß</span>
                  </span>
                  <button type="button" class="text-button" data-action="eatFiller" data-id="${esc(filler.id)}" aria-label="${esc(filler.name)} gegessen">Gegessen</button>
                </div>`
              )
              .join('')}</div>`
          : ''
      }
    </section>`;
}

function supplementBlock(today) {
  const { mine, taken } = getSupplements();
  if (!mine.length) return '';
  const done = taken?.[today] ?? [];
  return `
    <section id="supplementsToday">
      <h2 class="section">Supplements</h2>
      <div class="pills">${mine
        .map((item) => {
          const on = done.includes(item.id);
          return `<button type="button" class="chip${on ? ' taken' : ''}" data-action="takeSupplement" data-id="${esc(item.id)}" aria-pressed="${on}">${esc(item.name)}${item.dose ? `, ${esc(item.dose)}` : ''}</button>`;
        })
        .join('')}</div>
    </section>`;
}

const photoButton = `<label class="secondary as-button" id="dishPhotoLabel">${icon('camera')}Essen fotografieren<input id="dishPhoto" type="file" accept="image/*" capture="environment" hidden></label>`;

export function todayView() {
  const profile = getProfile();
  const targets = dailyTargets(profile);
  if (!targets)
    return `
      <div class="card">
        <h2>Was ist dein Ziel?</h2>
        <p>Daraus berechnet Prepora deine Kalorien und dein Eiweiß.</p>
        <button type="button" class="primary" data-tab="profile">Profil ausfüllen</button>
      </div>`;
  const goalRow = `
    <button type="button" class="row go" data-tab="profile" id="todayTargets">
      <span class="grow"><span class="block">${esc(GOALS[profile.goal].label)}</span><span class="muted small">${esc(targetText(targets))}</span></span>
    </button>`;
  const plan = getPlan();
  if (!plan)
    return `
      <div class="card">
        <h2>Noch kein Plan</h2>
        <p>Ein Tipp, und Claude plant deine Woche.</p>
        <button type="button" class="primary" data-tab="plan">Zum Wochenplan</button>
      </div>
      ${progress(null, localDay(), targets)}
      ${supplementBlock(localDay())}
      ${photoButton}
      <div class="list">${goalRow}</div>`;

  const today = localDay();
  const cookToday = plan.cookDays.find((day) => day.date === today && !day.done);
  const meals = plan.meals.filter((meal) => meal.date === today && !meal.skipped);
  const next = meals.find((meal) => !meal.eaten);
  const rest = meals.filter((meal) => !meal.eaten && meal !== next);
  const thaw = plan.meals.filter((meal) => meal.thawOn === today && !meal.eaten && !meal.skipped);
  const upcoming = plan.cookDays.find((day) => day.date > today && !day.done);
  const lastEaten = justEaten && plan.meals.find((meal) => meal.id === justEaten);
  // Before the first cook day nothing of the plan is bought or cooked yet, so nothing of it can be eaten.
  const early = today < plan.start;

  return `
    ${
      cookToday
        ? `<section class="hero"><span class="eyebrow">Kochtag</span><h2>Etwa ${cookToday.minutes} Minuten</h2><button type="button" class="primary" data-action="startCook" data-date="${cookToday.date}">Kochtag starten</button></section>`
        : ''
    }
    ${
      next
        ? `<section class="hero" id="nextMeal">
            <span class="eyebrow">${esc(next.meal)}</span>
            <h2>${esc(mealName(plan, next))}</h2>
            <p>${esc(whereItIs(plan, next, today))}</p>
            ${next.twist ? `<p class="plain" id="twist">Heute dazu: ${esc(next.twist)}</p>` : ''}
            <p class="plain">${esc(portionLine(mealNutrition(plan, next)))}</p>
            <button type="button" class="primary" data-action="eat" data-id="${esc(next.id)}">Gegessen</button>
            <button type="button" class="text-button" data-action="skipMeal" data-id="${esc(next.id)}">Heute nicht</button>
          </section>`
        : early
          ? `<p class="note" id="planAhead">${
              plan.shopOn && plan.shopOn !== plan.start
                ? `Einkauf am ${esc(dayLabel(plan.shopOn))}, Kochen am ${esc(dayLabel(plan.start))}.`
                : `Am ${esc(dayLabel(plan.start))} kaufst du ein und kochst.`
            } Ab dem Tag danach isst du aus den Boxen, bis dahin wie gewohnt.</p>`
          : !cookToday
            ? `<p class="note">Für heute ist nichts mehr offen.</p>`
            : ''
    }
    ${
      lastEaten
        ? `<section class="rating"><p>Wie war ${esc(mealName(plan, lastEaten))}?</p>
            <div class="three">
              <button type="button" class="secondary" data-action="rate" data-id="${esc(lastEaten.id)}" data-rating="no">Nie wieder</button>
              <button type="button" class="secondary" data-action="rate" data-id="${esc(lastEaten.id)}" data-rating="okay">Okay</button>
              <button type="button" class="secondary" data-action="rate" data-id="${esc(lastEaten.id)}" data-rating="love">Nochmal</button>
            </div></section>`
        : ''
    }
    ${notice ? `<p class="note" id="notice" role="status">${esc(notice)}</p>` : ''}
    ${progress(plan, today, targets)}
    ${early ? '' : gapBlock(plan, today, targets)}
    ${supplementBlock(today)}
    ${photoButton}
    <div class="list">
      ${rest
        .map(
          (meal) =>
            `<div class="row stacked"><span>${esc(meal.meal)}: ${esc(mealName(plan, meal))}</span><span class="muted">${esc(portionLine(mealNutrition(plan, meal)))}</span></div>`
        )
        .join('')}
      ${thaw
        .map(
          (meal) =>
            `<div class="row stacked thaw"><span>Heute Abend auftauen</span><span class="muted">${esc(mealName(plan, meal))} für ${esc(dayLabel(meal.date))} in den Kühlschrank legen</span></div>`
        )
        .join('')}
      ${
        upcoming
          ? `<button type="button" class="row go" data-tab="plan"><span>Nächster Kochtag</span><span class="muted">${esc(dayLabel(upcoming.date))}, etwa ${upcoming.minutes} Min.</span></button>`
          : ''
      }
      ${goalRow}
    </div>`;
}

export const todayActions = {
  skipMeal: (el) => {
    notice = SKIP_NOTES[skip(el.dataset.id)] ?? '';
    rerender();
  },
  eatFiller: (el) => {
    const filler = getPlan()?.fillers?.find((entry) => entry.id === el.dataset.id);
    if (!filler) return;
    addExtra(localDay(), {
      name: filler.name,
      kcal: filler.nutrition.kcal,
      protein: filler.nutrition.protein,
    });
    rerender();
  },
  takeSupplement: (el) => {
    const data = getSupplements();
    const today = localDay();
    const done = data.taken?.[today] ?? [];
    const next = done.includes(el.dataset.id)
      ? done.filter((id) => id !== el.dataset.id)
      : [...done, el.dataset.id];
    saveSupplements({ ...data, taken: { [today]: next } });
    rerender();
  },
  eat: (el) => {
    eat(el.dataset.id);
    justEaten = el.dataset.id;
    notice = '';
    rerender();
  },
  rate: (el) => {
    rate(el.dataset.id, el.dataset.rating);
    justEaten = null;
    rerender();
  },
};
