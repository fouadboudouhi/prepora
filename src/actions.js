// What happens to the week: planning it, eating from it, and everything the app remembers on the way.
import { askClaudeJson } from './ai.js';
import { getProfile } from './profile.js';
import {
  PLAN_SCHEMA,
  PLAN_SYSTEM,
  buildSlots,
  finishPlan,
  localDay,
  mealName,
  nextStart,
  placeStock,
  planRequest,
  repeatPlan,
} from './planner.js';
import { planAlarms, setAlarms } from './push.js';
import { SessionError } from './session.js';
import { read, write } from './store.js';
import { rerender } from './ui.js';

const DAY = 86400000;
const KEEP_PLANS = 8;
const FRIDGE_NOTE_DAYS = 3;

export const getPlan = () => read('plan', null);
export const getStock = () => read('stock', []);
export const getHistory = () => read('history', []);
export const getTaste = () => read('taste', {});
export const savePlan = (plan) => write('plan', plan);
export const saveStock = (stock) => write('stock', stock);
export const saveTaste = (taste) => write('taste', taste);

export function getFridge() {
  const note = read('fridge', null);
  return note && Date.now() - Date.parse(note.at) < FRIDGE_NOTE_DAYS * DAY ? note.items : [];
}
export const saveFridge = (items) =>
  write('fridge', items.length ? { items, at: new Date().toISOString() } : null);

export const planning = { busy: false, error: null, replacing: null };

export function scheduleReminders(plan) {
  const before = getPlan();
  const nameOf = (meal) => mealName(plan, meal);
  const alarms = planAlarms(plan, nameOf);
  const stale = before
    ? planAlarms(before, (meal) => mealName(before, meal))
        .map((alarm) => alarm.id)
        .filter((id) => !alarms.some((alarm) => alarm.id === id))
    : [];
  return setAlarms(alarms, stale);
}

function adopt(plan) {
  const old = getPlan();
  if (old && old.id !== plan.id) write('history', [old, ...getHistory()].slice(0, KEEP_PLANS));
  scheduleReminders(plan);
  savePlan(plan);
  write('shop', {});
}

// One correction is worth paying for when the answer breaks a rule. A second one is not; then the person hears it.
async function requestPlan(options) {
  const { profile, slots, start, stock } = options;
  const content = planRequest(options);
  const ask = (messages) =>
    askClaudeJson({ system: PLAN_SYSTEM, messages, maxTokens: 32000, effort: 'medium', format: PLAN_SCHEMA });
  const first = await ask([{ role: 'user', content }]);
  const result = finishPlan(first, { profile, slots, start, stock });
  if (!result.problems.length) return result.plan;
  const correction = `Dieser Plan bricht Regeln, korrigiere ihn:\n${result.problems.join('\n')}`;
  const second = await ask([
    { role: 'user', content },
    { role: 'assistant', content: JSON.stringify(first) },
    { role: 'user', content: correction },
  ]);
  const again = finishPlan(second, { profile, slots, start, stock });
  if (again.problems.length) throw new SessionError('badplan', again.problems[0]);
  return again.plan;
}

async function runPlanning(work, replacing = null) {
  if (planning.busy) return;
  Object.assign(planning, { busy: true, error: null, replacing });
  rerender();
  try {
    adopt(await work());
  } catch (err) {
    planning.error = err;
  }
  Object.assign(planning, { busy: false, replacing: null });
  rerender();
}

// The first freezer portions go in without asking: they use up what is there and save a recipe.
export function newWeek() {
  return runPlanning(() => {
    const profile = getProfile();
    const start = nextStart(profile.cookWeekday ?? 0);
    const stock = getStock();
    const placed = placeStock(buildSlots(profile, start), stock, profile.people ?? 1);
    return requestPlan({
      profile,
      taste: getTaste(),
      fridge: getFridge(),
      stock: stock.filter((item) => placed.used.includes(item.id)),
      start,
      slots: placed.slots,
    });
  });
}

// The rest of the plan is meant to stay, so Claude gets it along and only changes this one dish.
export function replaceRecipe(recipeId) {
  const plan = getPlan();
  const recipe = plan?.recipes.find((entry) => entry.id === recipeId);
  if (!recipe) return Promise.resolve();
  return runPlanning(async () => {
    const taste = { ...getTaste(), never: [...new Set([...(getTaste().never ?? []), recipe.name])] };
    const profile = getProfile();
    const { recipes, meals, cookDays } = plan;
    const slots = meals.map(({ id, date, meal, stock }) => ({ id, date, meal, ...(stock ? { stock } : {}) }));
    return requestPlan({
      profile,
      taste,
      fridge: [],
      stock: [],
      start: plan.start,
      slots,
      previous: {
        recipes: recipes.map(({ nutrition, portions, estimated, ...rest }) => rest),
        assignments: meals
          .filter((meal) => meal.recipeId)
          .map((meal) => ({ slot: meal.id, recipeId: meal.recipeId })),
        cookDays,
      },
      correction: `Ersetze nur das Gericht "${recipe.name}" durch ein anderes und passe den Kochablauf dazu an. Alles andere bleibt.`,
    });
  }, recipeId);
}

// The week that went down best, again, without Claude and without a cost.
export function bestWeek() {
  const score = (plan) => {
    const rated = (plan.meals ?? []).filter((meal) => meal.rating);
    if (!rated.length) return 0;
    const points = { love: 2, okay: 1, no: -2 };
    return rated.reduce((sum, meal) => sum + (points[meal.rating] ?? 0), 0) / rated.length;
  };
  const plans = [getPlan(), ...getHistory()].filter(Boolean);
  return plans.reduce((best, plan) => (!best || score(plan) > score(best) ? plan : best), null);
}

export function repeatBestWeek() {
  const best = bestWeek();
  if (!best) return;
  const profile = getProfile();
  adopt(repeatPlan(best, nextStart(profile.cookWeekday ?? 0)));
  rerender();
}

function takeFromStock(plan, meal) {
  const people = plan.people ?? 1;
  const id = meal.stock?.id;
  const stock = getStock();
  const entry = stock.find((item) => (id ? item.id === id : item.recipeId === meal.recipeId));
  if (!entry) return;
  entry.portions -= people;
  saveStock(stock.filter((item) => item.portions > 0));
}

export function eat(mealId) {
  const plan = getPlan();
  const meal = plan?.meals.find((entry) => entry.id === mealId);
  if (!meal || meal.eaten) return;
  meal.eaten = localDay();
  if (meal.storage === 'freezer') takeFromStock(plan, meal);
  savePlan(plan);
  setAlarms([], [`thaw-${meal.id}`]);
}

const without = (list, value) => (list ?? []).filter((entry) => entry !== value);

// A rating teaches the next plan at once. The latest word on a dish wins.
export function rate(mealId, rating) {
  const plan = getPlan();
  const meal = plan?.meals.find((entry) => entry.id === mealId);
  if (!meal) return;
  meal.rating = rating;
  savePlan(plan);
  const name = mealName(plan, meal);
  const taste = getTaste();
  taste.loved = without(taste.loved, name);
  taste.never = without(taste.never, name);
  if (rating === 'love') taste.loved.push(name);
  if (rating === 'no') taste.never.push(name);
  saveTaste(taste);
}
