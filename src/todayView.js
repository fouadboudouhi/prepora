// Heute: what to eat now and the one thing to do next. Eating is one tap; rating it is a second, optional one.
import { eat, getPlan, rate } from './actions.js';
import { dailyTargets, GOALS } from './nutrition.js';
import { getProfile } from './profile.js';
import { localDay, mealName, mealNutrition, recipeOf } from './planner.js';
import { targetText } from './profileView.js';
import { dayLabel, esc, number, rerender } from './ui.js';

let justEaten = null;

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

function progress(plan, today, targets) {
  if (!targets) return '';
  const eaten = (plan.meals ?? []).filter((meal) => meal.date === today && meal.eaten);
  const sum = (key) => eaten.reduce((total, meal) => total + (mealNutrition(plan, meal)?.[key] ?? 0), 0);
  const bar = (value, goal) =>
    `<span class="bar"><span style="width:${Math.min(100, Math.round((value / goal) * 100))}%"></span></span>`;
  return `
    <section class="day-line">
      <div><strong>${number(sum('kcal'))}</strong> <span class="muted">von ${number(targets.kcal)} kcal</span>${bar(sum('kcal'), targets.kcal)}</div>
      <div><strong>${number(sum('protein'))} g</strong> <span class="muted">von ${number(targets.protein)} g Eiweiß</span>${bar(sum('protein'), targets.protein)}</div>
    </section>`;
}

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
    <button type="button" class="row" data-tab="profile" id="todayTargets">
      <span>${esc(GOALS[profile.goal].label)}</span><span class="muted">${esc(targetText(targets))}</span>
    </button>`;
  const plan = getPlan();
  if (!plan)
    return `
      <div class="card">
        <h2>Noch kein Plan</h2>
        <p>Ein Tipp, und Claude plant deine Woche.</p>
        <button type="button" class="primary" data-tab="plan">Zum Wochenplan</button>
      </div>
      <div class="list">${goalRow}</div>`;

  const today = localDay();
  const cookToday = plan.cookDays.find((day) => day.date === today && !day.done);
  const meals = plan.meals.filter((meal) => meal.date === today);
  const next = meals.find((meal) => !meal.eaten);
  const rest = meals.filter((meal) => !meal.eaten && meal !== next);
  const thaw = plan.meals.filter((meal) => meal.thawOn === today && !meal.eaten);
  const upcoming = plan.cookDays.find((day) => day.date > today && !day.done);
  const lastEaten = justEaten && plan.meals.find((meal) => meal.id === justEaten);

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
            <p class="plain">${esc(portionLine(mealNutrition(plan, next)))}</p>
            <button type="button" class="primary" data-action="eat" data-id="${esc(next.id)}">Gegessen</button>
          </section>`
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
    ${progress(plan, today, targets)}
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
          ? `<button type="button" class="row" data-tab="plan"><span>Nächster Kochtag</span><span class="muted">${esc(dayLabel(upcoming.date))}, etwa ${upcoming.minutes} Min.</span></button>`
          : ''
      }
      ${goalRow}
    </div>`;
}

export const todayActions = {
  eat: (el) => {
    eat(el.dataset.id);
    justEaten = el.dataset.id;
    rerender();
  },
  rate: (el) => {
    rate(el.dataset.id, el.dataset.rating);
    justEaten = null;
    rerender();
  },
};
