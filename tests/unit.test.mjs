// The daily targets, without a browser. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kept } from '../src/agent.js';
import { entryFromProduct, lookupProduct, productFrom, validCode } from '../src/barcode.js';
import { calendarText } from '../src/calendar.js';
import { dayIntake, entryFrom, recentFoods, weekIntake } from '../src/foodLog.js';
import { assessDish } from '../src/dish.js';
import { adviceRequest, validAdvice } from '../src/goalAdvice.js';
import { nutritionOf } from '../src/foods.js';
import { GOALS, dailyTargets } from '../src/nutrition.js';
import {
  boxCheck,
  boxLabels,
  buildSlots,
  cookDates,
  freshCookDays,
  finishPlan,
  nextStart,
  placeStock,
  repeatPlan,
  shopDate,
  carryOver,
  shoppingCost,
  shoppingList,
  shoppingNotes,
  skipMeal,
} from '../src/planner.js';
import { blockAlarms, planAlarms } from '../src/push.js';
import { addWeight, mergeWeights, nextAdjustment, weeklyChange } from '../src/trend.js';
import { activityFor, mergeVolumora, readVolumora } from '../src/volumora.js';

const person = { goal: 'keep', sex: 'male', age: 30, height: 180, weight: 80, activity: 'medium' };

test('follows Mifflin-St Jeor with the activity factor, rounded to 50 kcal and 5 g', () => {
  // Resting 1780, times 1.55 is 2759.
  assert.deepEqual(dailyTargets(person), { kcal: 2750, protein: 130, limited: null });
});

test('each goal moves the calories its own way', () => {
  const kcal = (goal) => dailyTargets({ ...person, goal }).kcal;
  assert.equal(kcal('muscle'), 3050);
  assert.equal(kcal('lose'), 2250);
  assert.equal(kcal('cut'), 2450);
  assert.equal(kcal('endurance'), 2750);
  for (const goal of Object.keys(GOALS)) assert.ok(dailyTargets({ ...person, goal }).protein >= 125);
});

test('without a stated sex it takes the middle of both formulas', () => {
  const none = dailyTargets({ ...person, sex: '' }).kcal;
  assert.ok(none < dailyTargets(person).kcal);
  assert.ok(none > dailyTargets({ ...person, sex: 'female' }).kcal);
});

test('a deficit stops at the resting need', () => {
  const small = { goal: 'lose', sex: 'female', age: 30, height: 160, weight: 52, activity: 'low' };
  const result = dailyTargets(small);
  // Resting 1209, need 1692, minus 500 is 1192: below the resting need.
  assert.equal(result.limited, 'floor');
  assert.equal(result.kcal, 1250);
});

test('the floor never goes below the fixed minimum', () => {
  const result = dailyTargets({
    goal: 'lose',
    sex: 'female',
    age: 70,
    height: 150,
    weight: 45,
    activity: 'low',
  });
  assert.ok(result.kcal >= 1200);
});

test('no deficit at all with underweight, other goals stay untouched', () => {
  const thin = { sex: 'male', age: 30, height: 180, weight: 58, activity: 'medium' };
  const keep = dailyTargets({ ...thin, goal: 'keep' }).kcal;
  for (const goal of ['lose', 'cut']) {
    const result = dailyTargets({ ...thin, goal });
    assert.equal(result.limited, 'underweight');
    assert.equal(result.kcal, keep);
  }
  assert.equal(dailyTargets({ ...thin, goal: 'muscle' }).limited, null);
});

test('protein does not grow with body fat', () => {
  const heavy = dailyTargets({ ...person, goal: 'lose', weight: 160 });
  assert.equal(heavy.protein, 180);
  assert.ok(heavy.protein < 160 * 2);
});

test('gives nothing until the answers are complete and believable', () => {
  assert.equal(dailyTargets(), null);
  for (const change of [
    { goal: '' },
    { activity: '' },
    { age: null },
    { age: 17 },
    { age: 101 },
    { height: 90 },
    { weight: 20 },
    { weight: 900 },
    { weight: NaN },
  ])
    assert.equal(dailyTargets({ ...person, ...change }), null, JSON.stringify(change));
});

const food = (name, foodId, grams, packGrams = 0, category = 'Vorrat') => ({
  name,
  food: foodId,
  grams,
  category,
  packGrams,
  per100: { kcal: 0, protein: 0, fat: 0, carbs: 0 },
});
const profile = {
  ...person,
  meals: ['Mittagessen', 'Abendessen'],
  eatDays: 7,
  cookDays: 1,
  freezer: true,
  people: 1,
};
const START = '2026-11-08';
const answer = (recipeOf, recipeOptions = {}) => {
  const slots = buildSlots(profile, START);
  return {
    recipes: [
      {
        id: 'a',
        name: 'Eintopf',
        cookDate: START,
        fridgeDays: 4,
        freezes: true,
        reheat: '',
        ingredients: [food('Hack', 'rinderhack_mager', 4000, 500), food('Reis', 'reis', 2400, 1000)],
        ...recipeOptions,
      },
    ],
    assignments: slots.map((slot) => ({ slot: slot.id, recipeId: recipeOf(slot) })),
    cookDays: [
      {
        date: START,
        minutes: 90,
        steps: [{ recipeId: '', title: 'x', detail: '', timerMinutes: 0, timerName: '' }],
      },
    ],
  };
};

test('the week starts on the next cook day, today when today is the day', () => {
  assert.equal(nextStart(0, '2026-11-03'), '2026-11-08');
  assert.equal(nextStart(0, '2026-11-08'), '2026-11-08');
  assert.equal(nextStart(6, '2026-11-08'), '2026-11-14');
});

test('there is one line per portion, from the day after the cook day', () => {
  const slots = buildSlots(profile, START);
  assert.equal(slots.length, 14);
  assert.deepEqual(slots[0], { id: '1-Mittagessen', date: '2026-11-09', meal: 'Mittagessen' });
  assert.equal(slots.at(-1).date, '2026-11-15');
  assert.equal(buildSlots({ ...profile, eatDays: 5, meals: ['Frühstück'] }, START).length, 5);
  assert.deepEqual(cookDates({ ...profile, cookDays: 2 }, START), [START, '2026-11-12']);
});

test('nothing stands longer than it keeps: the code moves it to the freezer', () => {
  const slots = buildSlots(profile, START);
  const { plan, problems } = finishPlan(
    answer(() => 'a'),
    { profile, slots, start: START }
  );
  assert.deepEqual(problems, []);
  const day = (meal) => Number(meal.id.split('-')[0]);
  assert.ok(plan.meals.filter((meal) => day(meal) <= 4).every((meal) => meal.storage === 'fridge'));
  const frozen = plan.meals.filter((meal) => day(meal) > 4);
  assert.ok(frozen.every((meal) => meal.storage === 'freezer'));
  assert.equal(frozen[0].thawOn, '2026-11-12');
});

test('Claude cannot talk a dish past the limit, and fish keeps what Claude says', () => {
  const slots = buildSlots(profile, START);
  const long = finishPlan(
    answer(() => 'a', { fridgeDays: 30 }),
    { profile, slots, start: START }
  );
  assert.equal(long.plan.recipes[0].fridgeDays, 4);
  const fish = finishPlan(
    answer(() => 'a', { fridgeDays: 2 }),
    { profile, slots, start: START }
  );
  assert.equal(fish.plan.meals.find((meal) => meal.id === '3-Mittagessen').storage, 'freezer');
});

test('without a freezer or with a dish that does not freeze, it goes back to Claude', () => {
  const slots = buildSlots(profile, START);
  const none = finishPlan(
    answer(() => 'a'),
    { profile: { ...profile, freezer: false }, slots, start: START }
  );
  assert.ok(none.problems.some((text) => text.includes('keinen Tiefkühler')));
  const melts = finishPlan(
    answer(() => 'a', { freezes: false }),
    { profile, slots, start: START }
  );
  assert.ok(melts.problems.some((text) => text.includes('nicht einfrieren')));
});

test('a missing meal, an unknown recipe or a cook day without steps goes back to Claude', () => {
  const slots = buildSlots(profile, START);
  const gap = finishPlan(
    answer((slot) => (slot.id === '2-Abendessen' ? 'gibt-es-nicht' : 'a')),
    {
      profile,
      slots,
      start: START,
    }
  );
  assert.ok(gap.problems.some((text) => text.includes('2-Abendessen')));
  const empty = answer(() => 'a');
  empty.cookDays = [];
  assert.ok(finishPlan(empty, { profile, slots, start: START }).problems.length);
});

test('a meal before its cook day is refused', () => {
  const two = { ...profile, cookDays: 2 };
  const slots = buildSlots(two, START);
  const { problems } = finishPlan(
    answer(() => 'a', { cookDate: '2026-11-12' }),
    {
      profile: two,
      slots,
      start: START,
    }
  );
  assert.ok(problems.some((text) => text.includes('erst am')));
});

test('amounts follow the target, within limits, and the app computes the numbers', () => {
  const slots = buildSlots(profile, START);
  const { plan } = finishPlan(
    answer(() => 'a'),
    { profile, slots, start: START }
  );
  const recipe = plan.recipes[0];
  const target = dailyTargets(profile).kcal;
  // Two meals of 40 and 35 % on average make 37.5 % of the day.
  assert.ok(
    Math.abs(recipe.nutrition.kcal - target * 0.375) / (target * 0.375) < 0.05,
    String(recipe.nutrition.kcal)
  );
  assert.equal(recipe.portions, 14);
  assert.equal(recipe.estimated, false);

  const tiny = answer(() => 'a', { ingredients: [food('Reis', 'reis', 100)] });
  const scaled = finishPlan(tiny, { profile, slots, start: START }).plan.recipes[0];
  assert.equal(scaled.ingredients[0].grams, 130, 'a plan far off is not blown up');
});

test('an unknown food uses the estimate and is marked', () => {
  assert.equal(nutritionOf({ food: 'reis', grams: 100 }).kcal, 350);
  assert.equal(nutritionOf({ food: '', grams: 200, per100: { kcal: 100 } }).kcal, 200);
  const slots = buildSlots(profile, START);
  const odd = answer(() => 'a', {
    ingredients: [{ ...food('Exotisch', '', 3000), per100: { kcal: 200, protein: 5, fat: 5, carbs: 30 } }],
  });
  assert.equal(finishPlan(odd, { profile, slots, start: START }).plan.recipes[0].estimated, true);
});

test('the shopping list adds up the same food, in whole packs, and says what stays over', () => {
  const groups = shoppingList({
    recipes: [
      {
        name: 'A',
        ingredients: [
          food('Reis', 'reis', 400, 1000),
          food('Hack', 'rinderhack', 700, 500, 'Fleisch und Fisch'),
        ],
      },
      { name: 'B', ingredients: [food('Basmati', 'reis', 300, 1000), food('Salz', 'gewuerze', 0)] },
    ],
  });
  assert.deepEqual(
    groups.map((group) => group.name),
    ['Fleisch und Fisch', 'Vorrat', 'Prüfen, ob da']
  );
  const [hack] = groups[0].items;
  assert.equal(hack.detail, '2 Packungen à 500 g');
  const reis = groups[1].items;
  assert.equal(reis.length, 1);
  assert.equal(reis[0].detail, '1 Packung à 1 kg');
});

test('what is at home comes off the list, and what the packs leave goes into the next plan', () => {
  const plan = {
    shopOn: '2026-11-07',
    recipes: [
      {
        name: 'A',
        ingredients: [
          food('Reis', 'reis', 400, 1000),
          food('Hack', 'rinderhack', 700, 500, 'Fleisch und Fisch'),
          food('Nudeln', 'nudeln', 300, 500),
        ],
      },
    ],
    pantry: [
      { id: 'reis', name: 'Reis', grams: 600, category: 'Vorrat', since: '2026-10-31' },
      { id: 'nudeln', name: 'Nudeln', grams: 100, category: 'Vorrat', since: '2026-10-31' },
      { id: 'linsen', name: 'Linsen', grams: 250, category: 'Vorrat', since: '2026-10-31' },
      { id: 'pute', name: 'Pute', grams: 300, category: 'Fleisch und Fisch', since: '2026-10-31' },
    ],
  };
  const names = shoppingList(plan).flatMap((group) =>
    group.items.map((item) => `${item.name}: ${item.detail}`)
  );
  // Reis is at home in full, Nudeln partly.
  assert.deepEqual(names, ['Hack: 2 Packungen à 500 g', 'Nudeln: 1 Packung à 500 g, 100 g hast du noch']);
  assert.deepEqual(shoppingNotes(plan), {
    fromHome: [
      { name: 'Reis', grams: 400 },
      { name: 'Nudeln', grams: 100 },
    ],
    left: [
      { name: 'Hack', grams: 300 },
      { name: 'Nudeln', grams: 300 },
    ],
  });
  const next = carryOver(plan, '2026-11-08');
  assert.deepEqual(
    next.map(({ id, grams, since }) => [id, grams, since]),
    [
      ['reis', 200, '2026-10-31'],
      ['rinderhack', 300, '2026-11-07'],
      ['nudeln', 300, '2026-11-07'],
      ['linsen', 250, '2026-10-31'],
    ]
  );
  // Fresh meat from a week before is gone by now; the cupboard stays.
  assert.equal(
    next.some((entry) => entry.id === 'pute'),
    false
  );
  assert.equal(
    carryOver(plan, '2026-11-20').some((entry) => entry.id === 'rinderhack'),
    false
  );
  assert.equal(shoppingCost(plan), 0);
});

test('freezer portions take the last meals of the week', () => {
  const slots = buildSlots(profile, START);
  const stock = [{ id: 's', name: 'Curry', portions: 3, nutrition: null }];
  const placed = placeStock(slots, stock);
  assert.deepEqual(placed.used, ['s']);
  assert.equal(placed.slots.filter((slot) => slot.stock).length, 3);
  assert.equal(placed.slots.at(-1).stock.name, 'Curry');
  assert.equal(placed.slots[0].stock, undefined);
  assert.equal(
    placeStock(slots, [{ id: 'x', name: 'y', portions: 1 }], 2).slots.filter((s) => s.stock).length,
    0
  );
});

test('a stock meal needs no recipe from Claude', () => {
  const placed = placeStock(buildSlots(profile, START), [{ id: 's', name: 'Curry', portions: 2 }]);
  const stockIds = new Set(placed.slots.filter((slot) => slot.stock).map((slot) => slot.id));
  const raw = answer(() => 'a');
  raw.assignments = raw.assignments.filter((entry) => !stockIds.has(entry.slot));
  const { problems, plan } = finishPlan(raw, { profile, slots: placed.slots, start: START });
  assert.deepEqual(problems, []);
  assert.equal(plan.meals.filter((meal) => meal.stock).length, 2);
});

test('boxes per cook day name the place and the days', () => {
  const slots = buildSlots(profile, START);
  const { plan } = finishPlan(
    answer(() => 'a'),
    { profile, slots, start: START }
  );
  const labels = boxLabels(plan, START);
  assert.deepEqual(
    labels.map((label) => [label.storage, label.count]),
    [
      ['fridge', 8],
      ['freezer', 6],
    ]
  );
  assert.ok(labels[0].days.includes('Mo'));
});

test('a repeated week has new dates, nothing eaten and no cost', () => {
  const slots = buildSlots(profile, START);
  const { plan } = finishPlan(
    answer(() => 'a'),
    { profile, slots, start: START }
  );
  plan.meals[0].eaten = '2026-11-09';
  plan.meals[0].rating = 'love';
  plan.cookDays[0].done = true;
  const next = repeatPlan(plan, '2026-11-15');
  assert.equal(next.start, '2026-11-15');
  assert.equal(next.recipes[0].cookDate, '2026-11-15');
  assert.equal(next.meals[0].date, '2026-11-16');
  assert.equal(next.meals[0].eaten, undefined);
  assert.equal(next.cookDays[0].done, undefined);
  assert.equal(next.cookDays[0].date, '2026-11-15');
});

test('reminders cover thawing, never the past', () => {
  const slots = buildSlots(profile, START);
  const { plan } = finishPlan(
    answer(() => 'a'),
    { profile, slots, start: START }
  );
  const alarms = planAlarms(plan, () => 'Eintopf', Date.parse('2026-11-01T00:00:00'));
  const thaw = alarms.filter((alarm) => alarm.id.startsWith('thaw-'));
  assert.equal(thaw.length, 6);
  assert.match(thaw[0].body, /Eintopf/);
  assert.equal(planAlarms(plan, () => '', Date.parse('2027-01-01T00:00:00')).length, 0);
});

test('Volumora data becomes weight and activity', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const found = readVolumora(
    {
      body: [
        { date: '2026-10-01T10:00:00Z', weight: 80 },
        { date: '2026-10-30T10:00:00Z', weight: 82 },
        { date: '2026-11-01T10:00:00Z', weight: '' },
      ],
      history: [
        ...Array.from({ length: 12 }, () => ({ finishedAt: '2026-10-20T10:00:00Z' })),
        { finishedAt: '2026-01-20T10:00:00Z' },
      ],
    },
    now
  );
  assert.equal(found.weight, 82);
  assert.equal(found.sessionsPerWeek, 3);
  assert.equal(activityFor(found.sessionsPerWeek), 'medium');
  assert.equal(activityFor(5), 'medium', 'training five times a week beside a desk job');
  assert.equal(activityFor(6), 'high');
  assert.equal(activityFor(0), 'low');
  assert.equal(activityFor(null), null);
  assert.equal(readVolumora(undefined, now).weight, null);
});

test('Volumora does not overwrite a newer entry or a chosen activity', () => {
  const found = { weight: 82, weightAt: 1000, sessionsPerWeek: 6 };
  assert.deepEqual(mergeVolumora({ weight: null, activity: '' }, found), {
    weight: 82,
    weightAt: 1000,
    weightFrom: 'volumora',
    activity: 'high',
    activityFrom: 'volumora',
    trainingsPerWeek: 6,
  });
  assert.equal(
    mergeVolumora({ weight: 80, weightAt: 2000, activity: 'low', trainingsPerWeek: 6 }, found),
    null
  );
  assert.equal(
    mergeVolumora(
      { weight: 82, weightAt: 1000, activity: 'high', activityFrom: 'volumora', trainingsPerWeek: 6 },
      found
    ),
    null
  );
});

test('the goal advice gets the wish, the body, the training and every possible target, never the health note', () => {
  const profile = {
    goal: 'muscle',
    sex: 'male',
    age: 31,
    height: 184,
    weight: 89,
    activity: 'high',
    trainingsPerWeek: 3,
    health: 'Nimmt Blutverdünner',
    weights: [],
  };
  const text = adviceRequest('Bauch weg, Muskeln behalten', profile);
  assert.match(text, /^Was ich will: Bauch weg, Muskeln behalten/);
  assert.match(text, /Alter 31, Größe 184 cm, Gewicht 89 kg, Geschlecht männlich, BMI 26,3/);
  assert.match(text, /im Schnitt 3 pro Woche/);
  assert.match(text, /Jetzt eingestellt: Muskelaufbau, Bewegung Viel/);
  assert.match(
    text,
    /Muskelaufbau: Wenig 2\.950 kcal \/ 180 g Eiweiß, Mittel 3\.250 kcal \/ 180 g Eiweiß, Viel 3\.600 kcal/
  );
  assert.match(text, /Definition: Wenig 2\.350 kcal \/ 195 g Eiweiß/);
  assert.doesNotMatch(text, /Blutverdünner/);
  assert.match(adviceRequest('Abnehmen', { sex: '', weights: [] }), /noch keine Kalorien/);

  assert.deepEqual(validAdvice({ goal: 'cut', activity: 'medium', reason: '', assumption: '' })?.goal, 'cut');
  assert.equal(validAdvice({ goal: 'bulk', activity: 'medium' }), null);
  assert.equal(validAdvice({ goal: 'cut', activity: 'extreme' }), null);
});

const DAY_MS = 86400000;
const NOW = Date.parse('2026-11-03T12:00:00Z');
const curve = (perWeek, days = 21) =>
  Array.from({ length: days / 3 + 1 }, (_, index) => ({
    at: NOW - days * DAY_MS + index * 3 * DAY_MS,
    weight: 80 + (perWeek / 7) * index * 3,
  }));

test('weight trend: a straight line in kilograms per week, not from too little data', () => {
  assert.ok(Math.abs(weeklyChange(curve(0.5), NOW) - 0.5) < 0.001);
  assert.equal(weeklyChange(curve(0.5).slice(-2), NOW), null, 'two entries say nothing');
  assert.equal(weeklyChange(curve(0.5, 9), NOW), null, 'nine days say nothing');
});

test('weight entries: one per day, the last word counts, nonsense stays out', () => {
  let list = addWeight([], 8, NOW);
  assert.deepEqual(list, []);
  list = addWeight(list, 80, NOW);
  list = addWeight(list, 80.5, NOW + 1000);
  assert.deepEqual(list, [{ at: NOW + 1000, weight: 80.5 }]);
  assert.equal(mergeWeights(list, []), null);
  assert.equal(mergeWeights(list, [{ at: NOW, weight: 90 }]), null, 'the same day is not news');
  assert.equal(mergeWeights(list, [{ at: NOW - DAY_MS, weight: 79 }]).length, 2);
});

test('the target follows the real curve: small steps, seldom, inside the limits', () => {
  const base = { goal: 'muscle', weights: curve(0), kcalAdjust: 0 };
  const change = nextAdjustment(base, NOW);
  // Expected +0.25 kg, actual 0: about 275 kcal short, one step is at most 200.
  assert.equal(change.kcalAdjust, 200);
  assert.match(change.adjustNote, /\+200 kcal/);

  assert.equal(nextAdjustment({ ...base, adjustAt: NOW - 3 * DAY_MS }, NOW), null, 'not again so soon');
  assert.equal(nextAdjustment({ ...base, weights: curve(0.25) }, NOW), null, 'the curve fits');
  assert.equal(nextAdjustment({ ...base, weights: [] }, NOW), null);
  assert.equal(nextAdjustment({ ...base, kcalAdjust: 500 }, NOW), null, 'never past the total limit');

  const dieting = nextAdjustment({ goal: 'lose', weights: curve(-1.2) }, NOW);
  assert.ok(dieting.kcalAdjust > 0, 'losing too fast means more food');
});

test('an adjustment cannot push a diet through the floor', () => {
  const small = { goal: 'lose', sex: 'female', age: 30, height: 160, weight: 52, activity: 'low' };
  assert.equal(dailyTargets({ ...small, kcalAdjust: -500 }).kcal, 1250);
  assert.equal(dailyTargets({ ...small, kcalAdjust: -500 }).limited, 'floor');
  const plain = dailyTargets(person).kcal;
  assert.equal(dailyTargets({ ...person, kcalAdjust: 200 }).kcal, plain + 200);
  const thin = { goal: 'lose', sex: 'male', age: 30, height: 180, weight: 58, activity: 'medium' };
  assert.equal(dailyTargets({ ...thin, kcalAdjust: -300 }).kcal, dailyTargets(thin).kcal);
});

test('a dish photo only gives a number when it is worth one', () => {
  const dish = {
    isFood: true,
    dish: 'Lasagne',
    confidence: 'mittel',
    reason: '',
    portion: 'normal',
    kcalLow: 604,
    kcalHigh: 796,
    protein: 30.4,
    components: ['Nudeln'],
  };
  assert.deepEqual(assessDish(dish), {
    kind: 'estimate',
    dish: 'Lasagne',
    low: 600,
    high: 800,
    middle: 700,
    protein: 30,
    confidence: 'mittel',
    portion: 'normal',
    components: ['Nudeln'],
  });
  assert.equal(assessDish({ ...dish, confidence: 'niedrig' }).kind, 'unsure');
  assert.equal(
    assessDish({ ...dish, kcalLow: 300, kcalHigh: 900 }).kind,
    'unsure',
    'too wide to be an estimate'
  );
  assert.equal(assessDish({ ...dish, kcalLow: 0 }).kind, 'unsure');
  assert.equal(assessDish({ ...dish, kcalHigh: 100 }).kind, 'unsure');
  assert.equal(assessDish({ ...dish, isFood: false }).kind, 'notfood');
  assert.equal(assessDish(null).kind, 'notfood');
});

const skipPlan = (overrides = {}, mealOverrides = {}) => ({
  people: 1,
  recipes: [{ id: 'a', name: 'Chili', cookDate: '2026-11-08', fridgeDays: 4, freezes: true, ...overrides }],
  meals: [
    { id: 'm', date: '2026-11-10', meal: 'Mittagessen', recipeId: 'a', storage: 'fridge', ...mealOverrides },
  ],
  cookDays: [{ date: '2026-11-08', done: true }],
});
const on = { today: '2026-11-10', freezer: true };

test('"Heute nicht": freezer when it freezes, tomorrow when it keeps, a clear word when neither', () => {
  let plan = skipPlan();
  assert.equal(skipMeal(plan, 'm', on).outcome, 'frozen');
  assert.equal(plan.meals[0].skipped, true);

  plan = skipPlan({ freezes: false });
  assert.equal(skipMeal(plan, 'm', on).outcome, 'moved');
  assert.equal(plan.meals[0].date, '2026-11-11');

  plan = skipPlan({ freezes: false, fridgeDays: 2 });
  assert.equal(skipMeal(plan, 'm', on).outcome, 'expired');
  assert.equal(plan.meals[0].skipped, true);

  plan = skipPlan();
  assert.equal(skipMeal(plan, 'm', { ...on, freezer: false }).outcome, 'moved', 'no freezer at home');

  plan = skipPlan();
  plan.cookDays[0].done = false;
  assert.equal(skipMeal(plan, 'm', on).outcome, 'dropped', 'not cooked yet');
});

test('"Heute nicht": a thawed box never goes back into the freezer and only moves once', () => {
  const plan = skipPlan({}, { storage: 'freezer' });
  assert.equal(skipMeal(plan, 'm', on).outcome, 'moved');
  assert.equal(skipMeal(plan, 'm', { ...on, today: '2026-11-11' }).outcome, 'expired');
});

test('one shop a week: last shop day before cooking, with fillers, staples and supplements', () => {
  assert.equal(shopDate({ shopWeekday: 6 }, START), '2026-11-07');
  assert.equal(shopDate({ shopWeekday: 0 }, START), START, 'on the cook day itself');
  const plan = {
    recipes: [
      {
        name: 'A',
        ingredients: [food('Salz', 'gewuerze', 5), { ...food('Reis', 'reis', 400, 1000), packEuro: 2 }],
      },
    ],
    fillers: [
      {
        name: 'F',
        ingredients: [
          { ...food('Skyr', 'skyr', 1200, 500, 'Kühlregal'), packEuro: 1.5 },
          { ...food('Banane', 'banane', 700), packEuro: 2 },
        ],
      },
    ],
  };
  const groups = shoppingList(plan, [{ id: 'k', name: 'Kreatin' }]);
  const names = groups.map((group) => group.name);
  assert.deepEqual(names, ['Kühlregal', 'Vorrat', 'Prüfen, ob da', 'Supplements']);
  assert.equal(groups[0].items[0].detail, '3 Packungen à 500 g');
  assert.equal(groups[2].items[0].name, 'Salz');
  assert.equal(groups[3].items[0].id, 'supplement-k');
  assert.equal(shoppingCost(plan), Math.round(2 + 4.5 + 2));
});

test('the budget goes back to Claude only when it is clearly missed', () => {
  const slots = buildSlots(profile, START);
  const dear = answer(() => 'a', {
    ingredients: [
      { ...food('Hack', 'rinderhack_mager', 4000, 500), packEuro: 5 },
      food('Reis', 'reis', 2400, 1000),
    ],
  });
  const over = finishPlan(dear, { profile: { ...profile, budget: 20 }, slots, start: START });
  assert.ok(over.plan.cost > 24);
  assert.ok(over.problems.some((text) => text.includes('Budget')));
  assert.deepEqual(
    finishPlan(dear, { profile: { ...profile, budget: 500 }, slots, start: START }).problems,
    []
  );
  assert.deepEqual(finishPlan(dear, { profile, slots, start: START }).problems, []);
});

test('each box of a dish gets its turn with a twist, and fillers get numbers per serving', () => {
  const slots = buildSlots(profile, START);
  const raw = answer(() => 'a', { twists: ['Mit Limette', 'Mit Joghurt'] });
  raw.fillers = [
    { id: 'f', name: 'Skyr', when: 'Frühstück', servings: 7, ingredients: [food('Skyr', 'skyr', 1400, 500)] },
  ];
  const { plan } = finishPlan(raw, { profile, slots, start: START });
  assert.equal(plan.meals[0].twist, 'Mit Limette');
  assert.equal(plan.meals[1].twist, 'Mit Joghurt');
  assert.equal(plan.meals[2].twist, 'Mit Limette');
  assert.deepEqual(plan.fillers[0].nutrition, { kcal: 130, protein: 22, fat: 0, carbs: 8 });
});

test('the boxes are counted before the cook day, and a shortage is named', () => {
  const slots = buildSlots(profile, START);
  const { plan } = finishPlan(
    answer(() => 'a'),
    { profile, slots, start: START }
  );
  assert.deepEqual(boxCheck(plan, START, 10), { total: 14, frozen: 6, short: 4 });
  assert.equal(boxCheck(plan, START, null).short, 0);
  assert.equal(boxCheck(plan, START, 0).short, 14);
});

test('a second cook day follows the chosen weekday', () => {
  assert.deepEqual(cookDates({ cookDays: 2, cookWeekday2: 3 }, START), [START, '2026-11-11']);
  assert.deepEqual(cookDates({ cookDays: 2, cookWeekday2: 0 }, START), [START, '2026-11-15']);
});

test('cook days spread over a plan of any length, and without a freezer there are enough of them', () => {
  assert.deepEqual(cookDates({ cookDays: 1, eatDays: 4 }, START), [START]);
  assert.deepEqual(cookDates({ cookDays: 3, eatDays: 9 }, START), [START, '2026-11-11', '2026-11-14']);
  assert.deepEqual(cookDates({ cookDays: 4, eatDays: 2 }, START), [START, '2026-11-09']);
  assert.deepEqual(cookDates({ cookDays: 2, cookWeekday2: 3, eatDays: 2 }, START), [START, '2026-11-09']);
  assert.equal(freshCookDays({ freezer: false }, 10, 1), 3);
  assert.equal(freshCookDays({ freezer: false }, 4, 1), 1);
  assert.equal(freshCookDays({ freezer: true }, 10, 1), 1);
});

test('while a plan runs its own cook and shop days remind, not the weekdays', () => {
  const at = new Date('2026-11-03T08:00:00').getTime();
  const plan = {
    start: '2026-11-04',
    shopOn: '2026-11-03',
    cookDays: [{ date: '2026-11-04' }, { date: '2026-11-06' }],
    meals: [{ date: '2026-11-05' }, { date: '2026-11-08' }],
  };
  const alarms = blockAlarms({ cookWeekday: 0, shopWeekday: 6, cookTime: '10:00' }, at, plan);
  const ids = alarms.map((alarm) => alarm.id);
  assert.ok(
    ids.includes('cook-2026-11-04') && ids.includes('cook-2026-11-06') && ids.includes('shop-2026-11-03')
  );
  assert.ok(!ids.includes('cook-2026-11-08') && !ids.includes('shop-2026-11-07'));
  assert.ok(ids.includes('cook-2026-11-15'));
});

test('fixed times become reminders for the coming weeks, at the chosen time', () => {
  const at = new Date('2026-11-03T12:00:00').getTime();
  const alarms = blockAlarms(
    {
      cookDays: 2,
      cookWeekday: 0,
      cookTime: '09:30',
      cookWeekday2: 3,
      cookTime2: '18:00',
      shopWeekday: 6,
      shopTime: '17:00',
    },
    at
  );
  assert.ok(alarms.every((alarm) => alarm.at > at));
  const first = alarms.find((alarm) => alarm.id === 'cook-2026-11-08');
  assert.equal(first.at, new Date('2026-11-08T09:30:00').getTime());
  assert.ok(alarms.some((alarm) => alarm.id === 'cook-2026-11-04'));
  assert.ok(alarms.some((alarm) => alarm.id === 'shop-2026-11-07'));
  assert.equal(new Set(alarms.map((alarm) => alarm.id)).size, alarms.length);
  assert.ok(alarms.length <= 24);
  const one = blockAlarms({ cookDays: 1, cookWeekday: 0, cookWeekday2: 3, shopWeekday: 6 }, at);
  assert.equal(
    one.some((alarm) => alarm.id === 'cook-2026-11-04'),
    false
  );
});

test('the calendar file blocks each time every week', () => {
  const text = calendarText(
    {
      cookDays: 2,
      cookWeekday: 0,
      cookTime: '09:30',
      cookWeekday2: 3,
      cookTime2: '18:00',
      shopWeekday: 6,
      shopTime: '17:00',
      cookMinutes: 90,
    },
    new Date('2026-11-03T12:00:00')
  );
  assert.equal(text.match(/BEGIN:VEVENT/g).length, 3);
  assert.ok(text.includes('DTSTART:20261108T093000'));
  assert.ok(text.includes('RRULE:FREQ=WEEKLY;BYDAY=SU'));
  assert.ok(text.includes('DTSTART:20261104T180000'));
  assert.ok(text.includes('DTSTART:20261107T170000'));
  assert.ok(text.includes('DURATION:PT90M'));
  assert.ok(text.includes('\r\n'));
  assert.equal(calendarText({ cookDays: 1 }).match(/BEGIN:VEVENT/g).length, 2);
});

test('after a fallback mid-answer only the earlier text goes back, with all that follows', () => {
  const content = [
    { type: 'thinking', thinking: 'a', signature: 's' },
    { type: 'text', text: 'Moment' },
    { type: 'tool_use', id: 'x', name: 'get_overview', input: {} },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'text', text: ', gleich.' },
    { type: 'tool_use', id: 'y', name: 'get_overview', input: {} },
  ];
  assert.deepEqual(
    kept(content).map((block) => block.id ?? block.text),
    ['Moment', ', gleich.', 'y']
  );
  assert.equal(kept(content.slice(0, 3)).length, 3);
});

test('a known food is counted by the app, anything else keeps the estimate within limits', () => {
  assert.deepEqual(
    entryFrom({ name: 'Skyr', food: 'skyr', grams: 200, kcal: 5, protein: 0, fat: 0, carbs: 0 }, 'a'),
    {
      id: 'a',
      name: 'Skyr',
      kcal: 130,
      protein: 22,
      fat: 0,
      carbs: 8,
    }
  );
  const guessed = entryFrom({
    name: '',
    food: 'quatsch',
    grams: -3,
    kcal: 99999,
    protein: -5,
    fat: '12',
    carbs: null,
  });
  assert.deepEqual(guessed, {
    id: undefined,
    name: 'Essen',
    kcal: 4000,
    protein: 0,
    fat: 12,
    carbs: 0,
    estimated: true,
  });
});

test('a day counts boxes by the day they were eaten and entries with their amount', () => {
  const plan = {
    id: 'p',
    recipes: [{ id: 'r', name: 'Chili', nutrition: { kcal: 600, protein: 40, fat: 20, carbs: 50 } }],
    meals: [
      { id: '1', date: '2026-11-05', meal: 'Mittagessen', recipeId: 'r', eaten: '2026-11-06' },
      { id: '2', date: '2026-11-06', meal: 'Abendessen', recipeId: 'r' },
    ],
  };
  const extras = {
    '2026-11-06': [{ name: 'Riegel', kcal: 200, protein: 20, fat: 8, carbs: 20, factor: 1.5 }],
  };
  const day = dayIntake('2026-11-06', [plan, plan], extras, '2026-11-06');
  assert.deepEqual(day.total, { kcal: 900, protein: 70, fat: 32, carbs: 80 });
  assert.equal(day.entries[0].name, 'Mittagessen: Chili');
  assert.equal(day.entries[1].id, 'x-0');
});

test('the week leaves out today and empty days; often eaten comes first and not twice a day', () => {
  const extras = {
    '2026-11-03': [{ name: 'Riegel', kcal: 1000, protein: 50 }],
    '2026-11-04': [
      { name: 'Riegel', kcal: 2000, protein: 100 },
      { name: 'Apfel', kcal: 50, protein: 0 },
    ],
    '2026-11-06': [{ name: 'Apfel', kcal: 3000, protein: 0 }],
  };
  const week = weekIntake('2026-11-06', [], extras);
  assert.equal(week.days.length, 7);
  assert.equal(week.counted, 2);
  assert.equal(week.average.kcal, 1525);
  assert.deepEqual(
    recentFoods(extras, '2026-11-06').map((entry) => entry.name),
    ['Riegel']
  );
});

test('a barcode passes only with the right check digit', () => {
  assert.equal(validCode('3017620422003'), true);
  assert.equal(validCode('3017620422004'), false);
  assert.equal(validCode('96385074'), true);
  assert.equal(validCode('036000291452'), true);
  assert.equal(validCode('12345'), false);
  assert.equal(validCode('30176204220x3'), false);
});

test('Open Food Facts answers become a product, energy in kJ only is turned into kcal', () => {
  const answer = {
    status: 1,
    product: {
      product_name: 'Nutella',
      brands: 'Nutella, Ferrero',
      quantity: '400 g',
      serving_size: '15 g (1 portion)',
      nutriments: { 'energy-kj_100g': 2252, proteins_100g: 6.3, fat_100g: 30.9, carbohydrates_100g: 57.5 },
    },
  };
  assert.deepEqual(productFrom('3017620422003', answer), {
    code: '3017620422003',
    name: 'Nutella',
    brand: 'Ferrero',
    per100: { kcal: 538, protein: 6.3, fat: 30.9, carbs: 57.5 },
    serving: 15,
    pack: 400,
  });
  assert.equal(productFrom('1', { status: 0 }), null);
  assert.equal(
    productFrom('1', { status: 1, product: { product_name: 'Wasser', nutriments: {} } }).per100,
    null
  );
  assert.deepEqual(entryFromProduct(productFrom('3017620422003', answer), 15), {
    name: 'Nutella, 15 g',
    kcal: 81,
    protein: 1,
    fat: 5,
    carbs: 9,
    barcode: '3017620422003',
  });
});

test('an unknown barcode is no product, and only the number goes out', async () => {
  let asked = '';
  const fetcher = async (url) => {
    asked = url;
    return { status: 404, ok: false };
  };
  assert.equal(await lookupProduct('4006381333931', fetcher), null);
  assert.match(
    asked,
    /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/4006381333931\.json\?fields=[a-z_,0-9]+$/
  );
});

test('a box of a day that is over counts as eaten, unless it was marked as not eaten', () => {
  const plan = {
    id: 'p',
    recipes: [{ id: 'r', name: 'Chili', nutrition: { kcal: 600, protein: 40, fat: 20, carbs: 50 } }],
    meals: [
      { id: '1', date: '2026-11-05', meal: 'Mittagessen', recipeId: 'r' },
      { id: '2', date: '2026-11-05', meal: 'Abendessen', recipeId: 'r', missed: true },
      { id: '3', date: '2026-11-06', meal: 'Mittagessen', recipeId: 'r' },
    ],
  };
  const past = dayIntake('2026-11-05', [plan], {}, '2026-11-06');
  assert.equal(past.total.kcal, 600);
  assert.equal(past.entries[0].assumed, true);
  assert.equal(dayIntake('2026-11-06', [plan], {}, '2026-11-06').total.kcal, 0);
});
