// What happens to the week: planning it, eating from it, and everything the app remembers on the way.
import { askClaudeJson } from './ai.js';
import { getProfile, saveProfile } from './profile.js';
import {
  PLAN_SCHEMA,
  PLAN_SYSTEM,
  buildSlots,
  freshCookDays,
  MAX_COOK_DAYS,
  MAX_PLAN_DAYS,
  carryOver,
  stillGood,
  finishPlan,
  localDay,
  mealName,
  nextStart,
  placeStock,
  planRequest,
  repeatPlan,
  shopDate,
  skipMeal,
} from './planner.js';
import { planAlarms, setAlarms, syncBlocks } from './push.js';
import { SessionError } from './session.js';
import { read, write } from './store.js';
import { nextAdjustment } from './trend.js';
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

// What is at home from earlier shops: comes off the next list and goes into the next plan.
export const getPantry = (today = localDay()) =>
  read('pantry', []).filter((entry) => stillGood(entry, today));
export const savePantry = (list) => write('pantry', list);

// Once the shop day of the plan has come, its packs are bought: what they leave over is at home from now on.
export function settleShopping(today = localDay()) {
  const plan = getPlan();
  if (!plan || plan.settled || !plan.shopOn || plan.shopOn > today) return false;
  savePantry(carryOver(plan, today));
  savePlan({ ...plan, settled: true });
  return true;
}

export function getFridge() {
  const note = read('fridge', null);
  return note && Date.now() - Date.parse(note.at) < FRIDGE_NOTE_DAYS * DAY ? note.items : [];
}
export const saveFridge = (items) =>
  write('fridge', items.length ? { items, at: new Date().toISOString() } : null);

// What was eaten besides the boxes, by day. Two months stay, enough for the week and for what comes back often.
const EXTRA_DAYS = 60;
export const getAllExtras = () => read('extras', {});
export const getExtras = (date) => getAllExtras()[date] ?? [];
export function addExtra(date, entry) {
  const extras = getAllExtras();
  const oldest = localDay(new Date(Date.now() - EXTRA_DAYS * DAY));
  const kept = Object.fromEntries(Object.entries(extras).filter(([day]) => day >= oldest));
  const id = entry.id ?? `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  write('extras', { ...kept, [date]: [...(kept[date] ?? []), { ...entry, id }] });
}
// Older entries have no id of their own; their place in the day stands in for it.
function changeExtra(date, id, change) {
  const extras = getAllExtras();
  const day = (extras[date] ?? [])
    .map((entry, index) => ((entry.id ?? `x-${index}`) === id ? change(entry) : entry))
    .filter(Boolean);
  write('extras', { ...extras, [date]: day });
}
export const removeExtra = (date, id) => changeExtra(date, id, () => null);
export const setExtraFactor = (date, id, factor) => changeExtra(date, id, (entry) => ({ ...entry, factor }));

export const getMyRecipes = () => read('myRecipes', []);
export const saveMyRecipes = (list) => write('myRecipes', list);
export const getSupplements = () => read('supplements', { mine: [], taken: {}, advice: null });
export const saveSupplements = (value) => write('supplements', value);

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

// A plan that makes room keeps what was really eaten, so the history and the numbers stay right. Its boxes from
// `from` on that were not eaten are let go; otherwise they would later count as eaten. A plan nobody used yet goes.
function retire(old, from) {
  if (!old) return;
  const used =
    old.meals.some((meal) => meal.eaten || meal.date < from) || old.cookDays.some((day) => day.done);
  if (!used) return;
  const meals = old.meals.map((meal) =>
    !meal.eaten && meal.date >= from ? { ...meal, skipped: true, dropped: true } : meal
  );
  write('history', [{ ...old, meals }, ...getHistory()].slice(0, KEEP_PLANS));
}

function adopt(plan) {
  const old = getPlan();
  if (old && old.id !== plan.id) retire(old, plan.start < localDay() ? localDay() : addDaysTo(plan.start, 1));
  scheduleReminders(plan);
  savePlan(plan);
  syncBlocks(getProfile(), plan);
  write('shop', {});
  // An own recipe asked for once is in the plan now.
  const mine = getMyRecipes();
  if (mine.some((recipe) => recipe.wanted)) saveMyRecipes(mine.map(({ wanted, ...recipe }) => recipe));
}

// One correction is worth paying for when the answer breaks a rule. A second one is not; then the person hears it.
async function requestPlan(options) {
  const { profile, slots, start, stock, pantry, shopOn } = options;
  const content = planRequest(options);
  const ask = (messages) =>
    askClaudeJson({ system: PLAN_SYSTEM, messages, maxTokens: 32000, effort: 'medium', format: PLAN_SCHEMA });
  const first = await ask([{ role: 'user', content }]);
  const result = finishPlan(first, { profile, slots, start, stock, pantry, shopOn });
  if (!result.problems.length) return result.plan;
  const correction = `Dieser Plan bricht Regeln, korrigiere ihn:\n${result.problems.join('\n')}`;
  const second = await ask([
    { role: 'user', content },
    { role: 'assistant', content: JSON.stringify(first) },
    { role: 'user', content: correction },
  ]);
  const again = finishPlan(second, { profile, slots, start, stock, pantry, shopOn });
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

const wishLine = (wish) => (wish ? `Wunsch der Person für diesen Plan: ${wish}` : undefined);

const addDaysTo = (date, days) => {
  const at = new Date(`${date}T12:00:00`);
  at.setDate(at.getDate() + days);
  return localDay(at);
};

// The shape of one plan: from when, for how many days, with how many cook days. Anything not given comes from the
// profile. Without a freezer there are as many cook days as it takes for nothing to stand too long.
export function planShape(options = {}, profile = getProfile(), today = localDay()) {
  const whole = (value, low, high) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n >= low && n <= high ? n : null;
  };
  const days = whole(options.days, 1, MAX_PLAN_DAYS) ?? profile.eatDays ?? 7;
  const wanted = Math.min(whole(options.cookDays, 1, MAX_COOK_DAYS) ?? profile.cookDays ?? 1, days);
  const cookDays = Math.min(freshCookDays(profile, days, wanted), MAX_COOK_DAYS, days);
  let start = nextStart(profile.cookWeekday ?? 0, today);
  if (options.start === 'today') start = today;
  else if (options.start === 'tomorrow') start = addDaysTo(today, 1);
  else if (
    /^\d{4}-\d{2}-\d{2}$/.test(options.start ?? '') &&
    options.start >= today &&
    options.start <= addDaysTo(today, 14)
  )
    start = options.start;
  const fixed = options.start !== undefined || options.cookDays !== undefined;
  const shaped = { ...profile, eatDays: days, cookDays, ...(fixed ? { cookWeekday2: null } : {}) };
  const regular = shopDate(profile, start);
  const shopOn = regular < today ? today : regular;
  const note =
    cookDays > wanted ? `Ohne Tiefkühler hält nichts ${days} Tage frisch, deshalb ${cookDays} Kochtage.` : '';
  return { start, days, cookDays, shopOn, profile: shaped, note };
}

// A new plan. A wish comes from the chat, in the person's words; the shape says from when and for how long.
// The first freezer portions go in without asking: they use up what is there and save a recipe.
export function newWeek(wish = '', options = {}) {
  return runPlanning(async () => {
    const shape = planShape(options);
    const profile = shape.profile;
    const start = shape.start;
    const stock = getStock();
    const placed = placeStock(buildSlots(profile, start), stock, profile.people ?? 1);
    const wanted = getMyRecipes().filter((recipe) => recipe.wanted);
    const plan = await requestPlan({
      ownRecipes: wanted.map(({ name, servings, fridgeDays, freezes, reheat, ingredients, steps }) => ({
        name,
        servings,
        fridgeDays,
        freezes,
        reheat,
        ingredients,
        steps,
      })),
      profile,
      taste: getTaste(),
      fridge: getFridge(),
      stock: stock.filter((item) => placed.used.includes(item.id)),
      pantry: getPantry(),
      start,
      shopOn: shape.shopOn,
      slots: placed.slots,
      correction: wishLine(wish),
    });
    return shape.note ? { ...plan, note: shape.note } : plan;
  });
}

// Away with the current plan. What was eaten from it stays counted; reminders and the ticked shop list go too.
export function discardPlan() {
  const old = getPlan();
  if (!old) return false;
  retire(old, localDay());
  setAlarms(
    [],
    planAlarms(old, (meal) => mealName(old, meal)).map((alarm) => alarm.id)
  );
  savePlan(null);
  syncBlocks(getProfile(), null);
  write('shop', {});
  return true;
}

// The rest of the plan is meant to stay, so Claude gets it along and only changes this one dish.
export function replaceRecipe(recipeId, wish = '') {
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
      pantry: plan.pantry ?? [],
      start: plan.start,
      slots,
      previous: {
        recipes: recipes.map(({ nutrition, portions, estimated, ...rest }) => rest),
        fillers: (plan.fillers ?? []).map(({ nutrition, ...rest }) => rest),
        assignments: meals
          .filter((meal) => meal.recipeId)
          .map((meal) => ({ slot: meal.id, recipeId: meal.recipeId })),
        cookDays,
      },
      correction: [
        `Ersetze nur das Gericht "${recipe.name}" durch ein anderes und passe den Kochablauf dazu an. Alles andere bleibt.`,
        wishLine(wish),
      ]
        .filter(Boolean)
        .join('\n'),
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
  adopt(repeatPlan(best, nextStart(profile.cookWeekday ?? 0), getPantry()));
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

// One tap on a box that is not eaten today. What happens to it follows from what is safe.
export function skip(mealId) {
  const plan = getPlan();
  const profile = getProfile();
  const result = skipMeal(plan, mealId, { today: localDay(), freezer: profile.freezer !== false });
  if (result.outcome === 'frozen') {
    const stock = getStock();
    const today = localDay();
    const found = stock.find((item) => item.recipeId === result.recipe.id && item.frozenAt === today);
    if (found) found.portions += plan.people ?? 1;
    else
      stock.push({
        id: `s-${today}-${result.recipe.id}`,
        recipeId: result.recipe.id,
        name: result.recipe.name,
        portions: plan.people ?? 1,
        frozenAt: today,
        nutrition: result.recipe.nutrition,
      });
    saveStock(stock);
  }
  savePlan(plan);
  return result.outcome;
}

// Once in a while the real weight curve corrects the target; the person only reads about it.
export function applyTrend() {
  const profile = getProfile();
  const change = nextAdjustment(profile);
  if (change) saveProfile({ ...profile, ...change });
  return !!change;
}

export const updateBlocks = () => syncBlocks(getProfile(), getPlan());
