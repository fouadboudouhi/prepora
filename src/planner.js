// A week of food: which meals need a portion, what Claude is asked, and what the app checks and works out itself from
// the answer. Kept free of the screen and of storage, so all of it can be tested without a browser.
import { FOOD_IDS, nutritionOf } from './foods.js';
import { GOALS, dailyTargets } from './nutrition.js';

const DAY = 86400000;
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MEAL_SHARE = { Frühstück: 0.25, Mittagessen: 0.4, Abendessen: 0.35 };
const MEAL_ORDER = ['Frühstück', 'Mittagessen', 'Abendessen'];
export const FRIDGE_DAYS = 4;
const MIN_SCALE = 0.75;
const MAX_SCALE = 1.3;

const iso = (date) => new Date(date).toISOString().slice(0, 10);
const dayNumber = (text) => Date.parse(`${text}T00:00:00Z`) / DAY;
const addDays = (text, days) => iso((dayNumber(text) + days) * DAY);
export const weekdayOf = (text) => WEEKDAYS[new Date(`${text}T00:00:00Z`).getUTCDay()];
export const localDay = (at = new Date()) =>
  `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;

// The next cook day: today when today is the day. The day it starts is cooked on and eaten from the day after.
export function nextStart(cookWeekday, today = localDay()) {
  const ahead = (cookWeekday - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7;
  return addDays(today, ahead);
}

// One line per portion the week needs, starting the day after the first cook day.
export function buildSlots(profile, start) {
  const days = profile.eatDays ?? 7;
  const meals = MEAL_ORDER.filter((meal) => profile.meals?.includes(meal));
  const slots = [];
  for (let offset = 1; offset <= days; offset += 1)
    for (const meal of meals) slots.push({ id: `${offset}-${meal}`, date: addDays(start, offset), meal });
  return slots;
}

// The second cook day sits in the middle of the week.
export const cookDates = (profile, start) =>
  (profile.cookDays ?? 1) === 2 ? [start, addDays(start, Math.ceil((profile.eatDays ?? 7) / 2))] : [start];

const ingredientSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'food', 'grams', 'category', 'packGrams', 'per100'],
  properties: {
    name: { type: 'string' },
    food: { type: 'string' },
    grams: { type: 'number' },
    category: {
      type: 'string',
      enum: ['Fleisch und Fisch', 'Kühlregal', 'Gemüse und Obst', 'Vorrat', 'Tiefkühl'],
    },
    packGrams: { type: 'number' },
    per100: {
      type: 'object',
      additionalProperties: false,
      required: ['kcal', 'protein', 'fat', 'carbs'],
      properties: {
        kcal: { type: 'number' },
        protein: { type: 'number' },
        fat: { type: 'number' },
        carbs: { type: 'number' },
      },
    },
  },
};
export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recipes', 'assignments', 'cookDays'],
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'cookDate', 'fridgeDays', 'freezes', 'reheat', 'ingredients'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          cookDate: { type: 'string' },
          fridgeDays: { type: 'integer' },
          freezes: { type: 'boolean' },
          reheat: { type: 'string' },
          ingredients: { type: 'array', items: ingredientSchema },
        },
      },
    },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'recipeId'],
        properties: { slot: { type: 'string' }, recipeId: { type: 'string' } },
      },
    },
    cookDays: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'minutes', 'steps'],
        properties: {
          date: { type: 'string' },
          minutes: { type: 'integer' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['recipeId', 'title', 'detail', 'timerMinutes', 'timerName'],
              properties: {
                recipeId: { type: 'string' },
                title: { type: 'string' },
                detail: { type: 'string' },
                timerMinutes: { type: 'integer' },
                timerName: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

export const PLAN_SYSTEM = `Du planst Foodprep für Menschen, die ein- bis zweimal pro Woche für die ganze Woche kochen.

Regeln:
- Baukasten statt fünfmal dasselbe: wenige Proteine, Beilagen und Saucen, die sich unterschiedlich kombinieren. Wiederhole ein Gericht höchstens dreimal in der Woche.
- Der Kochtag hat eine gemeinsame Zeitleiste über alle Rezepte: Parallel Laufendes nutzen, Timer für alles Unbeaufsichtigte, realistisch für die angegebene Zeit und die vorhandenen Geräte.
- Mengen in "grams" sind die Rohgewichte für alle Portionen dieses Rezepts zusammen. Schritte nennen keine Mengen, nur Temperaturen und Zeiten.
- "food" ist genau eine Kennung aus der Liste. Passt keine, ist "food" leer und "per100" enthält deine Schätzung pro 100 g; sonst sind in "per100" alle Werte 0.
- "packGrams" ist die übliche Packungsgröße im deutschen Supermarkt in Gramm, 0 bei loser Ware. Plane so, dass Packungen aufgebraucht werden.
- "fridgeDays": wie viele Tage das gekochte Gericht im Kühlschrank sicher hält, höchstens ${FRIDGE_DAYS}, bei Fisch höchstens 2. "freezes": ob es sich zum Einfrieren eignet.
- Jede Mahlzeit in "assignments" bekommt genau ein Rezept. Rezepte, die länger stehen müssten, als sie halten, müssen einfrierbar sein, sofern ein Tiefkühler da ist.
- Wenn du einen Schritt mit Timer planst, ist "timerMinutes" die Dauer und "timerName" ein kurzes Wort wie "Reis"; sonst 0 und leer.
- Der letzte Schritt jedes Kochtags ist das Portionieren in Boxen und Abkühlen.
- "recipeId" eines Schritts ist das Rezept, um das es geht, oder leer bei Vorbereitung und Portionieren.
- Gegartes Geflügel und Hack müssen durchgegart sein; sage es im Schritt, wo es zählt.
- Deutsch, kurz und klar. "reheat" ist ein kurzer Satz wie "2 Minuten Mikrowelle".

Erlaubte Lebensmittel-Kennungen: ${FOOD_IDS.join(', ')}`;

function tasteLines(taste) {
  const lines = [];
  if (taste?.likes?.length) lines.push(`Mag gern: ${taste.likes.join(', ')}.`);
  if (taste?.dislikes?.length) lines.push(`Lieber nicht: ${taste.dislikes.join(', ')}.`);
  if (taste?.loved?.length) lines.push(`Wünscht sich wieder: ${taste.loved.join(', ')}.`);
  if (taste?.never?.length) lines.push(`Nie wieder: ${taste.never.join(', ')}.`);
  return lines;
}

// What Claude gets to know for this one week.
export function planRequest({ profile, taste, slots, start, fridge, correction, previous }) {
  const targets = dailyTargets(profile);
  const dates = cookDates(profile, start);
  const lines = [
    `Ziel: ${GOALS[profile.goal]?.label ?? 'gesund essen'}.`,
    targets
      ? `Tagesziel einer Person: ca. ${targets.kcal} kcal und ${targets.protein} g Eiweiß. Teile der Mahlzeiten: ${slotsShare(profile)}.`
      : '',
    `Personen: ${profile.people ?? 1}. Eine Mahlzeit in der Liste heißt Portionen für alle Personen.`,
    `Kochtage: ${dates.join(' und ')}, je etwa ${profile.cookMinutes ?? 90} Minuten.`,
    `Geräte: ${(profile.devices ?? []).join(', ') || 'Herd'}.`,
    `Tiefkühler: ${profile.freezer === false ? 'keiner' : 'vorhanden'}.`,
    profile.diet?.length ? `Ernährung: ${profile.diet.join(', ')}.` : '',
    profile.avoid ? `Mag oder verträgt nicht: ${profile.avoid}.` : '',
    ...tasteLines(taste),
    fridge?.length ? `Noch im Kühlschrank, bitte verbrauchen: ${fridge.join(', ')}.` : '',
    `Mahlzeiten, die ein Rezept brauchen (slot = Datum und Mahlzeit stehen dahinter):`,
    ...slots.map((slot) => `${slot.id}: ${slot.date}, ${slot.meal}`),
    previous ? `Bisheriger Plan zum Anpassen: ${JSON.stringify(previous)}` : '',
    correction ?? '',
  ];
  return lines.filter(Boolean).join('\n');
}

function slotsShare(profile) {
  const meals = MEAL_ORDER.filter((meal) => profile.meals?.includes(meal));
  return meals.map((meal) => `${meal} ${Math.round(MEAL_SHARE[meal] * 100)} %`).join(', ');
}

const addUp = (ingredients) =>
  ingredients.reduce(
    (sum, item) => {
      const part = nutritionOf(item);
      return {
        kcal: sum.kcal + part.kcal,
        protein: sum.protein + part.protein,
        fat: sum.fat + part.fat,
        carbs: sum.carbs + part.carbs,
      };
    },
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );

// What a person gets on the plate, after the amounts were fitted to the target.
const perPortion = (total, portions) =>
  Object.fromEntries(Object.entries(total).map(([key, value]) => [key, Math.round(value / portions)]));

// Turns Claude's answer into the plan the app uses, or says what is wrong with it. `problems` go back to Claude once.
export function finishPlan(answer, { profile, slots, start, stock = [] }) {
  const problems = [];
  const people = profile.people ?? 1;
  const recipes = new Map((answer.recipes ?? []).map((recipe) => [recipe.id, recipe]));
  const dates = cookDates(profile, start);
  const bySlot = new Map((answer.assignments ?? []).map((entry) => [entry.slot, entry.recipeId]));

  const meals = [];
  for (const slot of slots) {
    if (slot.stock) {
      meals.push({ ...slot });
      continue;
    }
    const recipe = recipes.get(bySlot.get(slot.id));
    if (!recipe) {
      problems.push(`Mahlzeit ${slot.id} hat kein Rezept.`);
      continue;
    }
    meals.push({ ...slot, recipeId: recipe.id });
  }

  for (const recipe of recipes.values()) {
    if (!dates.includes(recipe.cookDate)) recipe.cookDate = dates[0];
    recipe.fridgeDays = Math.min(Math.max(recipe.fridgeDays || 1, 1), FRIDGE_DAYS);
  }

  // Where each box waits: the code decides, not Claude, so nothing stands too long.
  for (const meal of meals) {
    if (meal.stock) {
      meal.storage = 'freezer';
      meal.thawOn = addDays(meal.date, -1);
      continue;
    }
    const recipe = recipes.get(meal.recipeId);
    const age = dayNumber(meal.date) - dayNumber(recipe.cookDate);
    if (age < 0)
      problems.push(`${recipe.name} wird am ${meal.date} gegessen, aber erst am ${recipe.cookDate} gekocht.`);
    if (age <= recipe.fridgeDays) meal.storage = 'fridge';
    else if (profile.freezer !== false && recipe.freezes) {
      meal.storage = 'freezer';
      meal.thawOn = addDays(meal.date, -1);
    } else {
      meal.storage = 'fridge';
      meal.tooOld = true;
      problems.push(
        `${recipe.name} am ${meal.date} wäre ${age} Tage alt, hält aber nur ${recipe.fridgeDays} Tage${profile.freezer === false ? '; es gibt keinen Tiefkühler' : ' und lässt sich nicht einfrieren'}.`
      );
    }
  }

  // Amounts follow the target, so a plan that is a bit small or large does not need a new, paid answer.
  const targets = dailyTargets(profile);
  const finished = [...recipes.values()]
    .map((recipe) => {
      const portions = meals.filter((meal) => meal.recipeId === recipe.id).length * people;
      if (!portions) return null;
      const share =
        meals
          .filter((meal) => meal.recipeId === recipe.id)
          .reduce((sum, meal) => sum + MEAL_SHARE[meal.meal], 0) /
        meals.filter((meal) => meal.recipeId === recipe.id).length;
      let scale = 1;
      const raw = addUp(recipe.ingredients);
      if (targets && raw.kcal > 0)
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (targets.kcal * share * portions) / raw.kcal));
      const ingredients = recipe.ingredients.map((item) => ({
        ...item,
        grams: Math.round((item.grams * scale) / 5) * 5,
      }));
      return {
        ...recipe,
        ingredients,
        portions,
        nutrition: perPortion(addUp(ingredients), portions),
        estimated: ingredients.some((item) => !nutritionOf(item).known && item.food !== 'gewuerze'),
      };
    })
    .filter(Boolean);

  const steps = (answer.cookDays ?? []).map((day) => ({
    date: dates.includes(day.date) ? day.date : dates[0],
    minutes: day.minutes,
    steps: day.steps,
  }));
  if (!steps.length || steps.some((day) => !day.steps?.length))
    problems.push('Ein Kochtag hat keine Schritte.');

  return {
    problems,
    plan: {
      id: `${start}-${Date.now()}`,
      start,
      createdAt: new Date().toISOString(),
      people,
      recipes: finished,
      meals,
      cookDays: steps,
      stockUsed: stock.map((item) => item.id),
    },
  };
}

// Same food, new dates: a proven week again, without asking Claude.
export function repeatPlan(old, start) {
  const shift = dayNumber(start) - dayNumber(old.start);
  return {
    ...old,
    id: `${start}-${Date.now()}`,
    start,
    createdAt: new Date().toISOString(),
    recipes: old.recipes.map((recipe) => ({ ...recipe, cookDate: addDays(recipe.cookDate, shift) })),
    meals: old.meals
      .filter((meal) => !meal.stock)
      .map(({ eaten, rating, ...meal }) => ({
        ...meal,
        date: addDays(meal.date, shift),
        ...(meal.thawOn ? { thawOn: addDays(meal.thawOn, shift) } : {}),
      })),
    cookDays: old.cookDays.map(({ done, ...day }) => ({ ...day, date: addDays(day.date, shift) })),
    stockUsed: [],
  };
}

// Freezer portions go to the end of the week, where a frozen box belongs, and need no recipe from Claude.
export function placeStock(slots, stock, people = 1) {
  const placed = slots.map((slot) => ({ ...slot }));
  let index = placed.length - 1;
  const used = [];
  for (const item of stock) {
    let left = Math.floor((item.portions ?? 0) / people);
    while (left > 0 && index >= 0) {
      placed[index].stock = {
        id: item.id,
        name: item.name,
        nutrition: item.nutrition ?? null,
        recipeId: item.recipeId ?? null,
      };
      used.push(item.id);
      index -= 1;
      left -= 1;
    }
  }
  return { slots: placed, used: [...new Set(used)] };
}

const PACK_WORD = (count) => (count === 1 ? '1 Packung' : `${count} Packungen`);
const amount = (grams) =>
  grams >= 1000 ? `${String(Math.round(grams / 100) / 10).replace('.', ',')} kg` : `${grams} g`;
const CATEGORY_ORDER = ['Fleisch und Fisch', 'Kühlregal', 'Gemüse und Obst', 'Tiefkühl', 'Vorrat'];

// The list for the shop: same food added up, in whole packs, and what stays over.
export function shoppingList(plan) {
  const items = new Map();
  for (const recipe of plan.recipes ?? [])
    for (const item of recipe.ingredients) {
      if (item.food === 'gewuerze' && !item.grams) continue;
      const key = (item.food || item.name).toLowerCase();
      const found = items.get(key) ?? {
        id: key,
        name: item.name,
        category: item.category,
        grams: 0,
        pack: item.packGrams || 0,
        recipes: new Set(),
      };
      found.grams += item.grams;
      found.recipes.add(recipe.name);
      items.set(key, found);
    }
  const groups = new Map();
  for (const item of items.values()) {
    const packs = item.pack ? Math.ceil(item.grams / item.pack) : 0;
    const left = packs ? packs * item.pack - item.grams : 0;
    const detail = packs
      ? `${PACK_WORD(packs)} à ${amount(item.pack)}${left >= item.pack * 0.25 ? `, ${amount(left)} bleiben übrig` : ''}`
      : amount(item.grams);
    const category = item.category ?? 'Vorrat';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ id: item.id, name: item.name, detail, left });
  }
  return [...groups.entries()]
    .sort(([a], [b]) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
    .map(([name, entries]) => ({ name, items: entries.sort((a, b) => a.name.localeCompare(b.name, 'de')) }));
}

export const recipeOf = (plan, id) => plan?.recipes?.find((recipe) => recipe.id === id) ?? null;
export const mealName = (plan, meal) => meal.stock?.name ?? recipeOf(plan, meal.recipeId)?.name ?? '';
export const mealNutrition = (plan, meal) =>
  meal.stock ? meal.stock.nutrition : (recipeOf(plan, meal.recipeId)?.nutrition ?? null);

// What goes into which box on one cook day.
export function boxLabels(plan, date) {
  const labels = new Map();
  const recipeIds = new Set(
    (plan.recipes ?? []).filter((recipe) => recipe.cookDate === date).map((recipe) => recipe.id)
  );
  for (const meal of plan.meals ?? []) {
    if (!recipeIds.has(meal.recipeId)) continue;
    const key = `${meal.recipeId}-${meal.storage}`;
    const label = labels.get(key) ?? {
      recipeId: meal.recipeId,
      name: recipeOf(plan, meal.recipeId).name,
      storage: meal.storage,
      count: 0,
      days: [],
    };
    label.count += plan.people ?? 1;
    label.days.push(weekdayOf(meal.date).slice(0, 2));
    labels.set(key, label);
  }
  return [...labels.values()];
}
