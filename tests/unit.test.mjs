// The daily targets, without a browser. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nutritionOf } from '../src/foods.js';
import { GOALS, dailyTargets } from '../src/nutrition.js';
import {
  boxLabels,
  buildSlots,
  cookDates,
  finishPlan,
  nextStart,
  placeStock,
  repeatPlan,
  shoppingList,
} from '../src/planner.js';
import { planAlarms } from '../src/push.js';
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
    ['Fleisch und Fisch', 'Vorrat']
  );
  const [hack] = groups[0].items;
  assert.equal(hack.detail, '2 Packungen à 500 g, 300 g bleiben übrig');
  const reis = groups[1].items;
  assert.equal(reis.length, 1);
  assert.equal(reis[0].detail, '1 Packung à 1 kg, 300 g bleiben übrig');
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

test('reminders cover thawing and cook days, never the past', () => {
  const slots = buildSlots(profile, START);
  const { plan } = finishPlan(
    answer(() => 'a'),
    { profile, slots, start: START }
  );
  const alarms = planAlarms(plan, () => 'Eintopf', Date.parse('2026-11-01T00:00:00'));
  assert.ok(alarms.some((alarm) => alarm.id === `cook-${START}`));
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
  assert.equal(activityFor(5), 'high');
  assert.equal(activityFor(0), 'low');
  assert.equal(activityFor(null), null);
  assert.equal(readVolumora(undefined, now).weight, null);
});

test('Volumora does not overwrite a newer entry or a chosen activity', () => {
  const found = { weight: 82, weightAt: 1000, sessionsPerWeek: 5 };
  assert.deepEqual(mergeVolumora({ weight: null, activity: '' }, found), {
    weight: 82,
    weightAt: 1000,
    weightFrom: 'volumora',
    activity: 'high',
    activityFrom: 'volumora',
  });
  assert.equal(mergeVolumora({ weight: 80, weightAt: 2000, activity: 'low' }, found), null);
  assert.equal(
    mergeVolumora({ weight: 82, weightAt: 1000, activity: 'high', activityFrom: 'volumora' }, found),
    null
  );
});
