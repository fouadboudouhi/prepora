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
const OVER_BUDGET = 1.2;

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
  (profile.cookDays ?? 1) === 2 ? [start, secondCookDay(profile, start)] : [start];

function secondCookDay(profile, start) {
  if (profile.cookWeekday2 === undefined || profile.cookWeekday2 === null)
    return addDays(start, Math.ceil((profile.eatDays ?? 7) / 2));
  const ahead = (profile.cookWeekday2 - new Date(`${start}T00:00:00Z`).getUTCDay() + 7) % 7;
  return addDays(start, ahead || 7);
}

// One shop a week: the last shop day before the first cook day, or that very day.
export function shopDate(profile, start) {
  const back = (new Date(`${start}T00:00:00Z`).getUTCDay() - (profile.shopWeekday ?? 6) + 7) % 7;
  return addDays(start, -back);
}

export const ingredientSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'food', 'grams', 'category', 'packGrams', 'packEuro', 'per100'],
  properties: {
    name: { type: 'string' },
    food: { type: 'string' },
    grams: { type: 'number' },
    category: {
      type: 'string',
      enum: ['Fleisch und Fisch', 'Kühlregal', 'Gemüse und Obst', 'Vorrat', 'Tiefkühl'],
    },
    packGrams: { type: 'number' },
    packEuro: { type: 'number' },
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
  required: ['recipes', 'assignments', 'cookDays', 'fillers'],
  properties: {
    fillers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'when', 'servings', 'ingredients'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          when: { type: 'string' },
          servings: { type: 'integer' },
          ingredients: { type: 'array', items: ingredientSchema },
        },
      },
    },
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'cookDate', 'fridgeDays', 'freezes', 'reheat', 'twists', 'ingredients'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          cookDate: { type: 'string' },
          fridgeDays: { type: 'integer' },
          freezes: { type: 'boolean' },
          reheat: { type: 'string' },
          twists: { type: 'array', items: { type: 'string' } },
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
- "twists": zwei bis drei kleine Varianten pro Rezept, die beim Aufwärmen in einer Minute aus derselben Box etwas anderes machen, zum Beispiel "Mit Limette und Koriander". Was sie brauchen, steht in "ingredients".
- "fillers": zwei bis drei Bausteine ganz ohne Kochen für den Rest des Tagesziels, zum Beispiel Frühstück oder Snack. "when" ist kurz wie "Frühstück", "servings" die Portionen für die Woche, "ingredients" die Mengen für alle Portionen. Ist keine Lücke genannt, ist die Liste leer.
- Es wird nur einmal pro Woche eingekauft. Frisches Fleisch und frischer Fisch für einen späteren Kochtag müssen bis dahin halten: dann als Tiefkühlware planen oder im Kochablauf ans Auftauen erinnern. Empfindliches Gemüse und Kräuter früh in der Woche verbrauchen.
- "packEuro": geschätzter Preis einer Packung im deutschen Discounter, bei loser Ware der Preis für diese Menge. Gewürze und Grundvorrat wie Salz, Pfeffer und Öl stehen auch in "ingredients", mit "food" "gewuerze" wenn sie kaum Kalorien haben.

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
export function planRequest({ profile, taste, slots, start, fridge, correction, previous, ownRecipes = [] }) {
  const targets = dailyTargets(profile);
  const dates = cookDates(profile, start);
  const gap = targets ? dayGap(profile, targets) : null;
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
    `Einkauf: einmal pro Woche, am ${shopDate(profile, start)}.`,
    profile.budget ? `Wochenbudget für den Einkauf: etwa ${profile.budget} Euro.` : '',
    gap ? `Lücke pro Tag und Person für "fillers": ca. ${gap.kcal} kcal und ${gap.protein} g Eiweiß.` : '',
    ownRecipes.length
      ? `Baue diese eigenen Rezepte in den Plan ein, Mengen darfst du anpassen: ${JSON.stringify(ownRecipes)}`
      : '',
    `Mahlzeiten, die ein Rezept brauchen (slot = Datum und Mahlzeit stehen dahinter):`,
    ...slots.map((slot) => `${slot.id}: ${slot.date}, ${slot.meal}`),
    previous ? `Bisheriger Plan zum Anpassen: ${JSON.stringify(previous)}` : '',
    correction ?? '',
  ];
  return lines.filter(Boolean).join('\n');
}

// What the cooked meals leave open of a day.
function dayGap(profile, targets) {
  const covered = MEAL_ORDER.filter((meal) => profile.meals?.includes(meal)).reduce(
    (sum, meal) => sum + MEAL_SHARE[meal],
    0
  );
  const open = 1 - covered;
  return open > 0.05
    ? { kcal: Math.round(targets.kcal * open), protein: Math.round(targets.protein * open) }
    : null;
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

  // A different small twist each time a dish comes round.
  const round = new Map();
  for (const meal of meals) {
    const twists = recipes.get(meal.recipeId)?.twists ?? [];
    if (!twists.length) continue;
    const turn = round.get(meal.recipeId) ?? 0;
    meal.twist = twists[turn % twists.length];
    round.set(meal.recipeId, turn + 1);
  }

  const fillers = (answer.fillers ?? []).map((filler) => {
    const servings = Math.max(filler.servings || 1, 1);
    return { ...filler, servings, nutrition: perPortion(addUp(filler.ingredients ?? []), servings) };
  });

  const steps = (answer.cookDays ?? []).map((day) => ({
    date: dates.includes(day.date) ? day.date : dates[0],
    minutes: day.minutes,
    steps: day.steps,
  }));
  if (!steps.length || steps.some((day) => !day.steps?.length))
    problems.push('Ein Kochtag hat keine Schritte.');

  const plan = {
    id: `${start}-${Date.now()}`,
    start,
    shopOn: shopDate(profile, start),
    createdAt: new Date().toISOString(),
    people,
    recipes: finished,
    fillers,
    meals,
    cookDays: steps,
    stockUsed: stock.map((item) => item.id),
  };
  plan.cost = shoppingCost(plan);
  if (profile.budget && plan.cost > profile.budget * OVER_BUDGET)
    problems.push(`Der Einkauf kostet etwa ${plan.cost} Euro, das Budget sind ${profile.budget} Euro.`);
  return { problems, plan };
}

// Same food, new dates: a proven week again, without asking Claude.
export function repeatPlan(old, start) {
  const shift = dayNumber(start) - dayNumber(old.start);
  return {
    ...old,
    id: `${start}-${Date.now()}`,
    start,
    ...(old.shopOn ? { shopOn: addDays(old.shopOn, shift) } : {}),
    createdAt: new Date().toISOString(),
    recipes: old.recipes.map((recipe) => ({ ...recipe, cookDate: addDays(recipe.cookDate, shift) })),
    meals: old.meals
      .filter((meal) => !meal.stock)
      .map(({ eaten, rating, skipped, moved, ...meal }) => ({
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
const CHECK_GROUP = 'Prüfen, ob da';
const SUPPLEMENT_GROUP = 'Supplements';
const CATEGORY_ORDER = [
  'Fleisch und Fisch',
  'Kühlregal',
  'Gemüse und Obst',
  'Tiefkühl',
  'Vorrat',
  CHECK_GROUP,
  SUPPLEMENT_GROUP,
];

// The same food in several dishes is one line in the shop. Fillers count too: everything for the week, in one trip.
function mergedIngredients(plan) {
  const items = new Map();
  const sources = [...(plan.recipes ?? []), ...(plan.fillers ?? [])];
  for (const source of sources)
    for (const item of source.ingredients ?? []) {
      const key = (item.food && item.food !== 'gewuerze' ? item.food : item.name).toLowerCase();
      const found = items.get(key) ?? {
        id: key,
        name: item.name,
        category: item.food === 'gewuerze' ? CHECK_GROUP : item.category,
        grams: 0,
        pack: item.packGrams || 0,
        packEuro: item.packEuro || 0,
        loose: 0,
      };
      found.grams += item.grams || 0;
      if (!found.pack) found.loose += item.packEuro || 0;
      items.set(key, found);
    }
  return [...items.values()];
}

// The list for the shop: same food added up, in whole packs, and what stays over.
export function shoppingList(plan, supplements = []) {
  const groups = new Map();
  for (const item of mergedIngredients(plan)) {
    const packs = item.pack ? Math.ceil(item.grams / item.pack) : 0;
    const left = packs ? packs * item.pack - item.grams : 0;
    const detail =
      item.category === CHECK_GROUP || !item.grams
        ? 'Für diese Woche nötig'
        : packs
          ? `${PACK_WORD(packs)} à ${amount(item.pack)}${left >= item.pack * 0.25 ? `, ${amount(left)} bleiben übrig` : ''}`
          : amount(item.grams);
    const category = !item.grams ? CHECK_GROUP : (item.category ?? 'Vorrat');
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ id: item.id, name: item.name, detail, left });
  }
  if (supplements.length)
    groups.set(
      SUPPLEMENT_GROUP,
      supplements.map((item) => ({
        id: `supplement-${item.id}`,
        name: item.name,
        detail: 'Reicht der Vorrat noch?',
        left: 0,
      }))
    );
  return [...groups.entries()]
    .sort(([a], [b]) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b))
    .map(([name, entries]) => ({ name, items: entries.sort((a, b) => a.name.localeCompare(b.name, 'de')) }));
}

// A rough sum from Claude's guessed prices, never a promise: supermarkets do not publish theirs.
export function shoppingCost(plan) {
  const total = mergedIngredients(plan).reduce(
    (sum, item) => sum + (item.pack ? Math.ceil(item.grams / item.pack) * item.packEuro : item.loose),
    0
  );
  return Math.round(total);
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

// Before the cook day: how many boxes it takes, and whether the ones at home are enough.
export function boxCheck(plan, date, boxes) {
  const labels = boxLabels(plan, date);
  const total = labels.reduce((sum, label) => sum + label.count, 0);
  const frozen = labels
    .filter((label) => label.storage === 'freezer')
    .reduce((sum, label) => sum + label.count, 0);
  return { total, frozen, short: boxes ? Math.max(0, total - boxes) : 0 };
}

// "Heute nicht": the app decides by what is safe, so this stays one tap. Changes the plan it is given.
export function skipMeal(plan, mealId, { today, freezer = true }) {
  const meal = plan.meals.find((entry) => entry.id === mealId);
  if (!meal) return { outcome: 'none' };
  const recipe = recipeOf(plan, meal.recipeId);
  const tomorrow = addDays(today, 1);
  const moveOn = () => {
    meal.date = tomorrow;
    meal.moved = true;
    return { outcome: 'moved' };
  };
  // A thawed box has one more day in it and must not go back into the freezer.
  if (meal.storage === 'freezer') {
    if (meal.moved) {
      meal.skipped = true;
      return { outcome: 'expired' };
    }
    return moveOn();
  }
  const cooked = plan.cookDays.some((day) => day.done && day.date === recipe?.cookDate);
  if (!cooked) {
    meal.skipped = true;
    return { outcome: 'dropped' };
  }
  if (freezer && recipe?.freezes) {
    meal.skipped = true;
    return { outcome: 'frozen', recipe };
  }
  if (dayNumber(tomorrow) - dayNumber(recipe.cookDate) <= recipe.fridgeDays) return moveOn();
  meal.skipped = true;
  return { outcome: 'expired' };
}
