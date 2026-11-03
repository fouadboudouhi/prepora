// The formula for the daily target is a guess. After a few weeks the real weight curve shows how good it was, and the
// target moves a little. Small steps, seldom, and the limits in nutrition.js always stay in charge.
const DAY = 86400000;
const WINDOW_DAYS = 28;
const MIN_SPAN_DAYS = 14;
const MIN_ENTRIES = 3;
const EVERY_DAYS = 14;
const KCAL_PER_KG_WEEK = 7700 / 7;
const DEAD_BAND = 0.15;
const MAX_STEP = 200;
const MAX_TOTAL = 500;
const KEEP = 90;
const EXPECTED = { muscle: 0.25, lose: -0.5, cut: -0.3, keep: 0, endurance: 0 };

const dayKey = (at) => new Date(at).toISOString().slice(0, 10);
const believable = (weight) => Number.isFinite(weight) && weight >= 35 && weight <= 250;

// One entry per day, the last word of that day: typing "80" passes through "8" on the way.
export function addWeight(list = [], weight, at = Date.now()) {
  if (!believable(weight)) return list;
  const others = list.filter((entry) => dayKey(entry.at) !== dayKey(at));
  return [...others, { at, weight }].sort((a, b) => a.at - b.at).slice(-KEEP);
}

// Null when Volumora has nothing new.
export function mergeWeights(list = [], found = []) {
  const known = new Set(list.map((entry) => dayKey(entry.at)));
  const fresh = found.filter((entry) => !known.has(dayKey(entry.at)) && believable(entry.weight));
  if (!fresh.length) return null;
  return [...list, ...fresh.map(({ at, weight }) => ({ at, weight }))]
    .sort((a, b) => a.at - b.at)
    .slice(-KEEP);
}

// Kilograms per week over the last four weeks as a straight line, or null with too little to go on.
export function weeklyChange(weights = [], now = Date.now()) {
  const recent = weights.filter((entry) => now - entry.at <= WINDOW_DAYS * DAY);
  if (recent.length < MIN_ENTRIES) return null;
  if ((recent.at(-1).at - recent[0].at) / DAY < MIN_SPAN_DAYS) return null;
  const days = recent.map((entry) => (entry.at - recent[0].at) / DAY);
  const meanDay = days.reduce((sum, day) => sum + day, 0) / days.length;
  const meanWeight = recent.reduce((sum, entry) => sum + entry.weight, 0) / recent.length;
  const top = recent.reduce(
    (sum, entry, index) => sum + (days[index] - meanDay) * (entry.weight - meanWeight),
    0
  );
  const bottom = days.reduce((sum, day) => sum + (day - meanDay) ** 2, 0);
  return bottom ? (top / bottom) * 7 : null;
}

const pace = (value) => `${String(Math.abs(Math.round(value * 10) / 10)).replace('.', ',')} kg`;
const direction = (value) => (value >= 0 ? 'zu' : 'ab');

// What changes in the profile, or null: not yet time, too little data, or the curve fits.
export function nextAdjustment(profile, now = Date.now()) {
  if (!(profile.goal in EXPECTED)) return null;
  if (profile.adjustAt && now - profile.adjustAt < EVERY_DAYS * DAY) return null;
  const actual = weeklyChange(profile.weights, now);
  if (actual === null) return null;
  const gap = EXPECTED[profile.goal] - actual;
  if (Math.abs(gap) < DEAD_BAND) return null;
  const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, gap * KCAL_PER_KG_WEEK));
  const total = Math.max(
    -MAX_TOTAL,
    Math.min(MAX_TOTAL, Math.round(((profile.kcalAdjust ?? 0) + step) / 50) * 50)
  );
  if (total === (profile.kcalAdjust ?? 0)) return null;
  const change = total - (profile.kcalAdjust ?? 0);
  return {
    kcalAdjust: total,
    adjustAt: now,
    adjustNote: `Du nimmst ${pace(actual)} pro Woche ${direction(actual)}, deshalb ${change > 0 ? '+' : '−'}${Math.abs(change)} kcal am Tag.`,
  };
}
