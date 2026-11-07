// What the assistant may look at and do. Each tool calls what the screens use too, so the same rules hold: plans come
// from the planner with its checks, numbers from nutrition.js. The note about medicines stays with the supplements.
import {
  addExtra,
  eat,
  getAllExtras,
  getFridge,
  getHistory,
  getPantry,
  changePantry,
  deleteOldPlans,
  PANTRY_PLACES,
  getMyRecipes,
  getPlan,
  getStock,
  getSupplements,
  getTaste,
  newWeek,
  discardPlan,
  dropDays,
  planning,
  repeatBestWeek,
  replaceRecipe,
  saveFridge,
  saveStock,
  saveTaste,
  skip,
  updateBlocks,
} from './actions.js';
import { LOG_SCHEMA, dayIntake, entryFrom, weekIntake } from './foodLog.js';
import { ACTIVITY, GOALS, dailyTargets } from './nutrition.js';
import { DEVICES, DIETS, MEALS, getProfile, saveProfile } from './profile.js';
import { localDay, mealName, recipeOf, shoppingList } from './planner.js';
import { read, write } from './store.js';
import { errorText } from './ui.js';

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const TIME = '^([01]\\d|2[0-3]):[0-5]\\d$';
const weekday = {
  type: 'integer',
  minimum: 0,
  maximum: 6,
  description: '0 = Sonntag, 1 = Montag … 6 = Samstag',
};
const wish = {
  type: 'string',
  description: 'Optional: Wunsch der Person in einem Satz, z. B. "mehr Hähnchen, nichts Scharfes".',
};

// The fields of the profile the assistant may set, with the same choices the profile screen offers.
const PROFILE_FIELDS = {
  goal: { type: 'string', enum: Object.keys(GOALS) },
  activity: { type: 'string', enum: Object.keys(ACTIVITY) },
  sex: { type: 'string', enum: ['male', 'female', ''] },
  age: { type: 'integer', minimum: 18, maximum: 100 },
  height: { type: 'integer', minimum: 120, maximum: 230 },
  weight: { type: 'number', minimum: 35, maximum: 250 },
  cookDays: { type: 'integer', minimum: 1, maximum: 4 },
  cookWeekday: weekday,
  cookTime: { type: 'string', pattern: TIME },
  cookWeekday2: weekday,
  cookTime2: { type: 'string', pattern: TIME },
  shopWeekday: weekday,
  shopTime: { type: 'string', pattern: TIME },
  cookMinutes: { type: 'integer', enum: [60, 90, 120] },
  eatDays: { type: 'integer', minimum: 1, maximum: 14 },
  people: { type: 'integer', minimum: 1, maximum: 4 },
  meals: { type: 'array', items: { type: 'string', enum: MEALS } },
  freezer: { type: 'boolean' },
  devices: { type: 'array', items: { type: 'string', enum: DEVICES } },
  diet: { type: 'array', items: { type: 'string', enum: DIETS } },
  avoid: { type: 'string', maxLength: 300 },
  boxes: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
  budget: { type: ['integer', 'null'], minimum: 0, maximum: 1000 },
};
const TASTE_FIELDS = ['likes', 'dislikes', 'loved', 'never'];
const tasteList = { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 20 };

export const TOOLS = [
  {
    name: 'get_overview',
    description:
      'Alles Wichtige auf einmal: heutiges Datum, Profil, Tagesziel, aktueller Wochenplan mit allen Mahlzeiten (id, Datum, Gericht, recipeId, gegessen, Bewertung), Tiefkühler, Kühlschrank, Geschmack, eigene Rezepte und Supplements. Rufe das zuerst auf, bevor du etwas über Plan oder Profil sagst.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_recipe',
    description:
      'Ein Rezept aus dem aktuellen Plan: Zutaten mit Mengen in Gramm für alle Portionen, Kochtag, Haltbarkeit, Aufwärmen und Nährwerte pro Portion.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['recipeId'],
      properties: { recipeId: { type: 'string' } },
    },
  },
  {
    name: 'get_cook_day',
    description: 'Der Kochablauf der Woche: pro Kochtag Datum, Minuten und die Schritte in Reihenfolge.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_shopping_list',
    description: 'Die Einkaufsliste der aktuellen Woche nach Bereichen, mit dem, was schon im Wagen ist.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'create_plan',
    description:
      'Erstellt einen neuen Plan mit Rezepten, Kochablauf und Einkaufsliste. Zeitraum frei wählbar: days = Tage, an denen aus den Boxen gegessen wird (1 bis 14), cookDays = Anzahl Kochtage (1 bis 4), start = Kochtag "today", "tomorrow", ein Datum JJJJ-MM-TT oder weglassen für den nächsten Kochtag aus dem Profil. Gegessen wird ab dem Tag nach dem ersten Kochtag. Was nicht angegeben ist, kommt aus dem Profil; das Profil selbst bleibt unverändert. Der bisherige Plan wird ersetzt, schon Gegessenes bleibt gezählt. Die App achtet selbst auf Haltbarkeit: ohne Tiefkühler plant sie genug Kochtage, sonst kommt, was zu lange stünde, in den Tiefkühler. Dauert ein bis zwei Minuten und kostet etwas Budget.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        wish,
        days: { type: 'integer', minimum: 1, maximum: 14 },
        cookDays: { type: 'integer', minimum: 1, maximum: 4 },
        start: {
          type: 'string',
          description: '"today", "tomorrow" oder JJJJ-MM-TT, höchstens 14 Tage voraus',
        },
      },
    },
  },
  {
    name: 'discard_plan',
    description:
      'Verwirft den aktuellen Plan ohne neuen. Schon Gegessenes bleibt gezählt, Erinnerungen und Einkaufshaken fallen weg. Für "verwerfen und neu machen" reicht create_plan allein.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'remove_days',
    description:
      'Nimmt einzelne Tage aus dem aktuellen Plan, der Rest bleibt. Daten als JJJJ-MM-TT, nur heute oder später. Noch nicht Gekochtes wird kleiner, Einkaufsliste und Kosten passen sich an. Schon gekochte Boxen kommen in den Tiefkühler, wenn das Gericht das verträgt (toFreezer), sonst bald essen (eatSoon). Schon Gekauftes, das nicht mehr gebraucht wird, landet im Vorrat.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['dates'],
      properties: {
        dates: { type: 'array', minItems: 1, maxItems: 14, items: { type: 'string', maxLength: 10 } },
      },
    },
  },
  {
    name: 'replace_dish',
    description:
      'Tauscht ein Gericht im aktuellen Plan gegen ein anderes, der Rest bleibt. Das alte Gericht kommt auf "Nie wieder".',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['recipeId'],
      properties: { recipeId: { type: 'string' }, wish },
    },
  },
  {
    name: 'repeat_best_week',
    description:
      'Wiederholt die bisher am besten bewertete Woche ab dem nächsten Kochtag. Kostenlos, ohne Claude.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'update_profile',
    description:
      'Ändert Angaben im Profil. Nur die Felder angeben, die sich ändern. goal: muscle Muskelaufbau, lose Abnehmen, cut Definition, keep Gewicht halten, endurance Ausdauer. activity: low Wenig, medium Mittel, high Viel.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['changes'],
      properties: {
        changes: {
          type: 'object',
          additionalProperties: false,
          properties: PROFILE_FIELDS,
          minProperties: 1,
        },
      },
    },
  },
  {
    name: 'update_taste',
    description:
      'Merkt sich Geschmack für die nächsten Pläne. likes: mag die Person, dislikes: lieber nicht, loved: Gericht gerne wieder, never: Gericht nie wieder. add fügt hinzu, remove entfernt.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        add: {
          type: 'object',
          additionalProperties: false,
          properties: Object.fromEntries(TASTE_FIELDS.map((f) => [f, tasteList])),
        },
        remove: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'set_fridge',
    description:
      'Ersetzt die Liste, was noch im Kühlschrank ist. Der nächste Plan verbraucht es. Leere Liste löscht sie.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['items'],
      properties: { items: { type: 'array', items: { type: 'string', maxLength: 80 }, maxItems: 30 } },
    },
  },
  {
    name: 'update_pantry',
    description:
      'Korrigiert den Vorrat zu Hause (atHome in get_overview): was die Person da hat, in Gramm. Jede Änderung nennt name und grams; grams 0 nimmt es heraus. Neues kommt dazu. place ist optional: Vorrat (Schrank), Kühlregal, Gemüse und Obst, Fleisch und Fisch oder Tiefkühl (rohe Ware, keine fertigen Gerichte). Einkaufsliste und nächster Plan richten sich danach. Stück schätzt du in Gramm, z. B. ein Ei 60 g.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['changes'],
      properties: {
        changes: {
          type: 'array',
          maxItems: 40,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'grams'],
            properties: {
              name: { type: 'string', maxLength: 80 },
              grams: { type: 'number', minimum: 0, maximum: 50000 },
              place: { type: 'string', enum: PANTRY_PLACES },
            },
          },
        },
      },
    },
  },
  {
    name: 'delete_old_plans',
    description:
      'Löscht alle früheren Pläne. Der aktuelle Plan bleibt. Was aus ihnen gegessen wurde, bleibt in den Tageswerten. Danach geht "Beste Woche wiederholen" erst wieder mit neuen Bewertungen.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'update_freezer',
    description:
      'Ändert die Portionen eines Gerichts im Tiefkühler. portions ist die neue Zahl, 0 nimmt es heraus.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'portions'],
      properties: {
        name: { type: 'string', maxLength: 80 },
        portions: { type: 'integer', minimum: 0, maximum: 50 },
      },
    },
  },
  {
    name: 'mark_meal',
    description:
      'eaten: als gegessen abhaken. skip: heute nicht essen, die App friert es ein oder schiebt es, je nachdem was sicher ist.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['mealId', 'action'],
      properties: { mealId: { type: 'string' }, action: { type: 'string', enum: ['eaten', 'skip'] } },
    },
  },
  {
    name: 'log_food',
    description:
      'Trägt ein, was die Person außer ihren Boxen gegessen hat. Boxen aus dem Plan hakst du mit mark_meal ab, nicht hier. Für jedes Lebensmittel oder Gericht: name mit Menge, food = passende id aus der Liste oder "", grams, und deine Schätzung für kcal, protein, fat, carbs genau dieser Menge. Für bekannte ids rechnet die App selbst. date nur, wenn es nicht heute war (höchstens 7 Tage zurück).',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['foods'],
      properties: {
        foods: { ...LOG_SCHEMA.properties.foods, maxItems: 20 },
        date: { type: 'string', description: 'YYYY-MM-DD, Standard heute' },
      },
    },
  },
  {
    name: 'get_food_log',
    description:
      'Was die Person an den letzten Tagen gegessen hat, Boxen und Eingetragenes, mit Summen pro Tag, dem Schnitt der abgeschlossenen Tage und ihrem Tagesziel. days: 1 bis 14, Standard 7.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: { days: { type: 'integer', minimum: 1, maximum: 14 } },
    },
  },
];

export const TOOL_STATUS = {
  get_overview: 'Schaut in deine Daten …',
  get_recipe: 'Liest das Rezept …',
  get_cook_day: 'Schaut in den Kochablauf …',
  get_shopping_list: 'Schaut in die Einkaufsliste …',
  create_plan: 'Erstellt den Plan, das dauert ein bis zwei Minuten …',
  discard_plan: 'Verwirft den Plan …',
  remove_days: 'Nimmt die Tage raus …',
  replace_dish: 'Tauscht das Gericht …',
  repeat_best_week: 'Wiederholt die beste Woche …',
  update_profile: 'Ändert das Profil …',
  update_taste: 'Merkt sich das …',
  set_fridge: 'Trägt den Kühlschrank ein …',
  update_pantry: 'Korrigiert deinen Vorrat …',
  delete_old_plans: 'Löscht frühere Pläne …',
  update_freezer: 'Ändert den Tiefkühler …',
  mark_meal: 'Hakt die Mahlzeit ab …',
  log_food: 'Trägt das Essen ein …',
  get_food_log: 'Schaut, was du gegessen hast …',
};

const without = ({ health, goalText, weights, adjustNote, ...rest }) => rest;

// The schema is only a guide for Claude, so the code checks every value itself before it is saved.
function fits(rule, value) {
  if (value === null) return [rule.type].flat().includes('null');
  if (rule.enum) return rule.enum.includes(value);
  const types = [rule.type].flat();
  if (types.includes('array')) return Array.isArray(value) && value.every((entry) => fits(rule.items, entry));
  if (types.includes('boolean')) return typeof value === 'boolean';
  if (types.includes('string'))
    return (
      typeof value === 'string' &&
      value.length <= (rule.maxLength ?? 300) &&
      (!rule.pattern || new RegExp(rule.pattern).test(value))
    );
  const whole = types.includes('integer') && !types.includes('number');
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!whole || Number.isInteger(value)) &&
    value >= (rule.minimum ?? -Infinity) &&
    value <= (rule.maximum ?? Infinity)
  );
}

function planSummary(plan) {
  if (!plan) return null;
  return {
    start: plan.start,
    days: plan.days ?? null,
    note: plan.note ?? null,
    cookDays: (plan.cookDays ?? []).map((day) => day.date ?? day),
    shopOn: plan.shopOn ?? null,
    estimatedCostEuro: plan.cost ?? null,
    recipes: plan.recipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      perPortion: recipe.nutrition,
    })),
    meals: plan.meals.map((meal) => ({
      id: meal.id,
      date: `${meal.date} (${WEEKDAYS[new Date(`${meal.date}T12:00:00`).getDay()]})`,
      meal: meal.meal,
      dish: mealName(plan, meal),
      ...(meal.recipeId ? { recipeId: meal.recipeId } : {}),
      ...(meal.storage ? { storage: meal.storage } : {}),
      ...(meal.eaten ? { eaten: meal.eaten } : {}),
      ...(meal.skipped ? { skipped: true } : {}),
      ...(meal.rating ? { rating: meal.rating } : {}),
    })),
  };
}

function overview() {
  const profile = getProfile();
  const today = localDay();
  return {
    today: `${today} (${WEEKDAYS[new Date(`${today}T12:00:00`).getDay()]})`,
    profile: without(profile),
    dailyTarget: dailyTargets(profile),
    planning: planning.busy ? 'Ein Plan wird gerade erstellt.' : null,
    plan: planSummary(getPlan()),
    freezer: getStock().map(({ name, portions, frozenAt }) => ({ name, portions, frozenAt })),
    fridge: getFridge(),
    atHome: getPantry().map(({ name, grams, category, since }) => ({ name, grams, place: category, since })),
    earlierPlans: getHistory().length,
    taste: getTaste(),
    ownRecipes: getMyRecipes().map(({ name, wanted }) => ({ name, ...(wanted ? { nextPlan: true } : {}) })),
    supplements: (getSupplements().mine ?? []).map(({ name, dose }) => ({ name, dose })),
  };
}

// The plan screen shows the same error the tool reports.
async function plan(work) {
  if (planning.busy) return { error: 'Es wird schon ein Plan erstellt. Warte, bis er fertig ist.' };
  await work();
  if (planning.error) return { error: errorText(planning.error) };
  return { done: true, plan: planSummary(getPlan()) };
}

function updateProfile({ changes }) {
  const before = getProfile();
  const next = { ...before };
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (!(key in PROFILE_FIELDS)) return { error: `Unbekanntes Feld: ${key}` };
    if (!fits(PROFILE_FIELDS[key], value))
      return { error: `Ungültiger Wert für ${key}: ${JSON.stringify(value)}` };
    next[key] = typeof value === 'string' ? value.trim() : value;
  }
  if (changes.activity) next.activityFrom = '';
  if (changes.weight !== undefined && changes.weight !== before.weight) {
    next.weightAt = Date.now();
    next.weightFrom = '';
  }
  saveProfile(next);
  updateBlocks();
  return { done: true, dailyTarget: dailyTargets(next) };
}

function updateTaste({ add = {}, remove = [] }) {
  const lists = [remove, ...Object.values(add)];
  if (!lists.every((list) => Array.isArray(list) && list.every((value) => typeof value === 'string')))
    return { error: 'add und remove brauchen Listen aus Text.' };
  const taste = getTaste();
  const gone = new Set(remove.map((value) => value.toLowerCase()));
  for (const field of TASTE_FIELDS) {
    const list = (taste[field] ?? []).filter((value) => !gone.has(value.toLowerCase()));
    taste[field] = [...new Set([...list, ...(add[field] ?? [])])];
  }
  saveTaste(taste);
  return { done: true, taste };
}

function updateFreezer({ name, portions }) {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    !Number.isInteger(portions) ||
    portions < 0 ||
    portions > 50
  )
    return { error: 'name braucht Text und portions eine ganze Zahl von 0 bis 50.' };
  const stock = getStock();
  const found = stock.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
  if (found) found.portions = portions;
  else if (portions)
    stock.push({ id: `s-${Date.now()}`, name: name.trim(), portions, frozenAt: localDay(), nutrition: null });
  saveStock(stock.filter((item) => item.portions > 0));
  return { done: true };
}

function markMeal({ mealId, action }) {
  const meal = getPlan()?.meals.find((entry) => entry.id === mealId);
  if (!meal) return { error: 'Diese Mahlzeit gibt es im aktuellen Plan nicht.' };
  if (action === 'eaten') {
    eat(mealId);
    return { done: true };
  }
  return { done: true, outcome: skip(mealId) };
}

const shiftDay = (date, days) => {
  const at = new Date(`${date}T12:00:00`);
  at.setDate(at.getDate() + days);
  return localDay(at);
};
const plans = () => [getPlan(), ...getHistory()];

function logFood({ foods, date }) {
  const today = localDay();
  const day = date ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today || day < shiftDay(today, -7))
    return { error: 'date muss ein Tag der letzten sieben Tage sein, im Format YYYY-MM-DD.' };
  if (
    !Array.isArray(foods) ||
    !foods.length ||
    foods.length > 20 ||
    !foods.every((item) => item && typeof item === 'object')
  )
    return { error: 'foods braucht eine Liste mit 1 bis 20 Einträgen.' };
  const entries = foods.map((item) => entryFrom(item));
  entries.forEach((entry) => addExtra(day, entry));
  return { done: true, date: day, logged: entries, dayTotal: dayIntake(day, plans(), getAllExtras()).total };
}

function foodLog({ days = 7 }) {
  const count = Number.isInteger(days) ? Math.min(14, Math.max(1, days)) : 7;
  const today = localDay();
  const extras = getAllExtras();
  const list = Array.from({ length: count }, (_, index) =>
    dayIntake(shiftDay(today, index - count + 1), plans(), extras)
  );
  return {
    today,
    dailyTarget: dailyTargets(getProfile()),
    lastSevenDays: (({ average, counted }) => ({ average, completeDaysCounted: counted }))(
      weekIntake(today, plans(), extras)
    ),
    days: list.map(({ date, total, entries }) => ({
      date,
      total,
      entries: entries.map(({ name, kcal, protein, fat, carbs, estimated }) => ({
        name,
        kcal,
        protein,
        fat,
        carbs,
        ...(estimated ? { estimated: true } : {}),
      })),
    })),
  };
}

export async function runTool(name, input = {}) {
  switch (name) {
    case 'get_overview':
      return overview();
    case 'get_recipe': {
      const recipe = recipeOf(getPlan(), input.recipeId);
      if (!recipe) return { error: 'Dieses Rezept gibt es im aktuellen Plan nicht.' };
      const { name: title, cookDate, fridgeDays, freezes, reheat, twists, nutrition, portions } = recipe;
      return {
        name: title,
        cookDate,
        portions,
        fridgeDays,
        freezes,
        reheat,
        twists,
        perPortion: nutrition,
        ingredients: recipe.ingredients.map(({ name: item, grams }) => ({ name: item, grams })),
      };
    }
    case 'get_cook_day': {
      const current = getPlan();
      if (!current) return { error: 'Es gibt noch keinen Plan.' };
      return { cookDays: current.cookDays };
    }
    case 'get_shopping_list': {
      const current = getPlan();
      if (!current) return { error: 'Es gibt noch keinen Plan.' };
      const checked = read('shop', {});
      return {
        shopOn: current.shopOn ?? null,
        groups: shoppingList(current, getSupplements().mine ?? []).map((group) => ({
          name: group.name,
          items: group.items.map((item) => ({
            name: item.name,
            detail: item.detail,
            inCart: !!checked[item.id],
          })),
        })),
      };
    }
    case 'create_plan':
      return plan(() =>
        newWeek(input.wish ?? '', { days: input.days, cookDays: input.cookDays, start: input.start })
      );
    case 'discard_plan':
      return discardPlan() ? { ok: true, plan: null } : { error: 'Es gibt gerade keinen Plan.' };
    case 'remove_days': {
      const result = dropDays(input.dates);
      return result.error ? result : { done: true, ...result, plan: planSummary(getPlan()) };
    }
    case 'replace_dish':
      if (!recipeOf(getPlan(), input.recipeId))
        return { error: 'Dieses Rezept gibt es im aktuellen Plan nicht.' };
      return plan(() => replaceRecipe(input.recipeId, input.wish ?? ''));
    case 'repeat_best_week': {
      const before = getPlan()?.id;
      repeatBestWeek();
      return getPlan()?.id === before
        ? { error: 'Es gibt noch keine Woche zum Wiederholen.' }
        : { done: true, plan: planSummary(getPlan()) };
    }
    case 'update_profile':
      return updateProfile(input);
    case 'update_taste':
      return updateTaste(input);
    case 'set_fridge':
      if (!Array.isArray(input.items) || !input.items.every((item) => typeof item === 'string'))
        return { error: 'items braucht eine Liste aus Text.' };
      saveFridge(
        input.items
          .map((item) => item.trim().slice(0, 80))
          .filter(Boolean)
          .slice(0, 30)
      );
      return { done: true };
    case 'update_freezer':
      return updateFreezer(input);
    case 'update_pantry': {
      if (!Array.isArray(input.changes)) return { error: 'changes braucht eine Liste.' };
      const bad = input.changes.find(
        (change) => typeof change?.name !== 'string' || !change.name.trim() || !(Number(change.grams) >= 0)
      );
      if (bad) return { error: `Ungültige Änderung: ${JSON.stringify(bad)}` };
      const list = changePantry(
        input.changes
          .slice(0, 40)
          .map((change) => ({ name: change.name, grams: change.grams, category: change.place }))
      );
      return {
        done: true,
        atHome: list.map(({ name, grams, category }) => ({ name, grams, place: category })),
      };
    }
    case 'delete_old_plans':
      return { done: true, deleted: deleteOldPlans() };
    case 'mark_meal':
      return markMeal(input);
    case 'log_food':
      return logFood(input);
    case 'get_food_log':
      return foodLog(input);
    default:
      return { error: `Unbekanntes Werkzeug: ${name}` };
  }
}

// What a turn changed, so one tap can take it back. Kept while the app is open.
export const KEYS = ['profile', 'plan', 'history', 'shop', 'stock', 'taste', 'fridge', 'extras', 'pantry'];
export const snapshot = () => Object.fromEntries(KEYS.map((key) => [key, JSON.stringify(read(key, null))]));

const NAMES = {
  profile: 'Profil',
  plan: 'Plan',
  history: 'Frühere Pläne',
  pantry: 'Vorrat',
  taste: 'Geschmack',
  fridge: 'Kühlschrank',
  stock: 'Tiefkühler',
  extras: 'Gegessen',
};
export function changesBetween(before, after) {
  const changed = KEYS.filter((key) => before[key] !== after[key]);
  return { changed, label: [...new Set(changed.map((key) => NAMES[key]).filter(Boolean))].join(', ') };
}

export function undo(before, after, changed, restorePlan) {
  const now = snapshot();
  if (changed.some((key) => now[key] !== after[key])) return false;
  for (const key of changed) {
    const value = JSON.parse(before[key]);
    if (key === 'plan') restorePlan(value);
    else write(key, value);
  }
  updateBlocks();
  return true;
}
