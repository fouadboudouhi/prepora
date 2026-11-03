// Daily targets from the profile: Mifflin-St Jeor for the resting need, an activity factor, a step per goal. Rough on
// purpose, the app only ever shows them as "ca.". The floor keeps a diet from going below the resting need.
export const GOALS = {
  muscle: { label: 'Muskelaufbau', kcal: 300, proteinPerKg: 2 },
  lose: { label: 'Abnehmen', kcal: -500, proteinPerKg: 2 },
  cut: { label: 'Definition', kcal: -300, proteinPerKg: 2.2 },
  keep: { label: 'Gewicht halten', kcal: 0, proteinPerKg: 1.6 },
  endurance: { label: 'Ausdauer', kcal: 0, proteinPerKg: 1.6 },
};
export const ACTIVITY = {
  low: { label: 'Wenig', factor: 1.4 },
  medium: { label: 'Mittel', factor: 1.55 },
  high: { label: 'Viel', factor: 1.75 },
};
const SEX = { male: { offset: 5, floor: 1500 }, female: { offset: -161, floor: 1200 } };
const ANY_SEX = { offset: -78, floor: 1350 };
const LIMITS = { age: [18, 100], height: [120, 230], weight: [35, 250] };
const UNDERWEIGHT = 18.5;
// Above this the protein target follows this weight, so it does not grow with body fat.
const REFERENCE_BMI = 27.5;

const inRange = (value, [min, max]) => Number.isFinite(value) && value >= min && value <= max;
const roundTo = (value, step) => Math.round(value / step) * step;

// Null until goal and body are complete and believable. `limited` names why the plan differs from the plain goal.
export function dailyTargets({ goal, sex, age, height, weight, activity } = {}) {
  const chosen = GOALS[goal];
  const moving = ACTIVITY[activity];
  if (!chosen || !moving) return null;
  if (
    ![
      ['age', age],
      ['height', height],
      ['weight', weight],
    ].every(([key, value]) => inRange(value, LIMITS[key]))
  )
    return null;

  const { offset, floor } = SEX[sex] ?? ANY_SEX;
  const resting = 10 * weight + 6.25 * height - 5 * age + offset;
  const need = resting * moving.factor;
  const bmi = weight / (height / 100) ** 2;
  const deficit = chosen.kcal < 0;
  let limited = null;
  let kcal = need + chosen.kcal;
  if (deficit && bmi < UNDERWEIGHT) {
    kcal = need;
    limited = 'underweight';
  } else if (deficit && kcal < Math.max(resting, floor)) {
    // Rounded up, so the rounding cannot take it below the limit again.
    kcal = Math.ceil(Math.max(resting, floor) / 50) * 50;
    limited = 'floor';
  }
  const reference = Math.min(weight, REFERENCE_BMI * (height / 100) ** 2);
  return { kcal: roundTo(kcal, 50), protein: roundTo(reference * chosen.proteinPerKg, 5), limited };
}
