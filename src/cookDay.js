// The cook day without the screen: which step is open, what goes in at a step, the amounts in spoons, and what Claude
// is told when it rewrites the steps or helps while cooking. Kept free of storage, so all of it can be tested.
import { STEP_RULES, boxLabels, recipeOf, withIds } from './planner.js';

const OIL = /öl\b|öl$|^öl/i;
const LIQUID = /sauce|soße|essig|honig|sirup|sojasauce|senf|tomatenmark|pesto|zitronensaft|limettensaft/i;

// Small amounts the way one measures them: oil and sauces in spoons, spices in teaspoons.
export function handyAmount(name, grams) {
  if (!grams) return '';
  const round = (value) => Math.max(1, Math.round(value * 2) / 2).toLocaleString('de-DE');
  if (OIL.test(name) && grams <= 120) return `${grams} g (ca. ${round(grams / 10)} EL)`;
  if (LIQUID.test(name) && grams <= 120) return `${grams} g (ca. ${round(grams / 15)} EL)`;
  if (grams <= 15) return `${grams} g (ca. ${round(grams / 4)} TL)`;
  return `${grams} g`;
}

// A plan from before the steps had ids, amounts and equipment still cooks: ids are added, nothing else is guessed.
export function readyDay(day) {
  return { ...day, equipment: day.equipment ?? [], steps: withIds(day.steps ?? []) };
}

// Old steps say nothing about amounts. The ingredients the text names are what goes in there, compound words too:
// "Hack" in the step finds "Rinderhack".
const words = (text) =>
  text
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-zäöüß]+/)
    .filter((word) => word.length > 2)
    .map((word) => (word.length > 4 ? word.replace(/(en|n|e|s)$/, '') : word));

export function stepUses(plan, step) {
  if (Array.isArray(step.uses)) return step.uses;
  const recipe = recipeOf(plan, step.recipeId);
  if (!recipe) return [];
  const said = words(`${step.title} ${step.detail}`);
  return recipe.ingredients
    .filter((item) =>
      words(item.name).some((word) =>
        said.some((part) => word === part || (part.length > 3 && word.endsWith(part)))
      )
    )
    .map((item) => ({ name: item.name, amount: handyAmount(item.name, item.grams) }));
}

// Everything the day cooks, per dish, for the overview before the start.
export function dayDishes(plan, date) {
  const labels = boxLabels(plan, date);
  return (plan.recipes ?? [])
    .filter((recipe) => recipe.cookDate === date)
    .map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      boxes: labels
        .filter((label) => label.recipeId === recipe.id)
        .reduce((sum, label) => sum + label.count, 0),
      ingredients: recipe.ingredients
        .filter((item) => !/\(twist\)/i.test(item.name))
        .map((item) => ({ name: item.name, amount: handyAmount(item.name, item.grams) })),
    }));
}

// A session from before: one number for the step. It becomes the step's id, and all before it count as done.
export function readySession(session, day) {
  if (!session || session.at !== undefined) return session;
  const ids = day.steps.map((step) => step.id);
  const index = Math.min(session.step ?? 0, ids.length);
  return {
    date: session.date,
    phase: index >= ids.length ? 'labels' : 'steps',
    at: ids[Math.min(index, ids.length - 1)],
    done: ids.slice(0, index),
    timers: (session.timers ?? []).map((timer) => ({
      ...timer,
      stepId: timer.stepId ?? '',
      then: timer.then ?? '',
    })),
    startedAt: session.startedAt ?? Date.now(),
    chat: [],
  };
}

// Where "Weiter" goes: the next step after this one that is still open, else the first open one, else the boxes.
export function nextOpen(day, done, fromId) {
  const open = (step) => !done.includes(step.id);
  const from = day.steps.findIndex((step) => step.id === fromId);
  return (
    day.steps.slice(from + 1).find(open)?.id ?? day.steps.slice(0, Math.max(from, 0)).find(open)?.id ?? null
  );
}

// Timers by what ends first; one that is over stays on top until it is put away.
export const sortedTimers = (timers) => [...timers].sort((a, b) => a.endAt - b.endAt);

// What Claude needs to rewrite the steps of a day that is already planned and bought.
export function cookDayRequest(plan, date, profile) {
  const day = plan.cookDays.find((entry) => entry.date === date);
  const recipes = (plan.recipes ?? [])
    .filter((recipe) => recipe.cookDate === date)
    .map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      zutaten: recipe.ingredients.map((item) => `${item.grams} g ${item.name}`),
    }));
  const boxes = boxLabels(plan, date).map(
    (label) =>
      `${label.count} × ${label.name} (${label.storage === 'freezer' ? 'Tiefkühler' : 'Kühlschrank'})`
  );
  return [
    `Kochtag: ${date}, etwa ${day?.minutes ?? profile.cookMinutes ?? 90} Minuten.`,
    `Geräte: ${(profile.devices ?? []).join(', ') || 'Herd'}.`,
    `Rezepte mit den Mengen für alle Portionen: ${JSON.stringify(recipes)}`,
    `Boxen: ${boxes.join(', ')}.`,
    `Bisheriger Ablauf, zu knapp: ${JSON.stringify(day?.steps.map(({ title, detail }) => `${title}: ${detail}`) ?? [])}`,
  ].join('\n');
}

export const COOK_DAY_SYSTEM = `Du schreibst den Kochablauf für einen Kochtag neu, der schon geplant und eingekauft ist. Rezepte und Mengen bleiben genau so, nur die Schritte werden genauer. Deutsch, kurz und klar.

${STEP_RULES}`;

// Claude's new steps, checked: a step needs a title, and ids start fresh so nothing of the old order sticks.
export function finishCookDay(answer, day) {
  const steps = (answer.steps ?? []).filter((step) => step.title?.trim());
  if (!steps.length) return null;
  return {
    ...day,
    minutes: answer.minutes || day.minutes,
    equipment: answer.equipment ?? [],
    steps: withIds(steps, `r${Date.now().toString(36)}-`),
  };
}
