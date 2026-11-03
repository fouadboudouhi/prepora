// The daily targets, without a browser. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GOALS, dailyTargets } from '../src/nutrition.js';

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
