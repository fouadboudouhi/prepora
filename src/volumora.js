// Weight and training from Volumora flow into the targets. Only ever a read: Prepora never writes to that data.
import { call } from './session.js';
import { getProfile, saveProfile } from './profile.js';
import { mergeWeights } from './trend.js';

const DAY = 86400000;
const WEEKS = 4;

// The newest weight and the trainings per week of the last four weeks.
export function readVolumora(backup, now = Date.now()) {
  const weights = (backup?.body ?? [])
    .filter((entry) => Number(entry.weight) > 0)
    .map((entry) => ({ weight: Number(entry.weight), at: Date.parse(entry.date ?? entry.day) || 0 }))
    .sort((a, b) => a.at - b.at);
  const since = now - WEEKS * 7 * DAY;
  const sessions = (backup?.history ?? []).filter(
    (session) => Date.parse(session.finishedAt ?? session.day) >= since
  ).length;
  return {
    weight: weights.at(-1)?.weight ?? null,
    weightAt: weights.at(-1)?.at ?? 0,
    weights,
    sessionsPerWeek: backup?.history ? sessions / WEEKS : null,
  };
}

export function activityFor(sessionsPerWeek) {
  if (sessionsPerWeek === null) return null;
  if (sessionsPerWeek >= 4) return 'high';
  if (sessionsPerWeek >= 2) return 'medium';
  return 'low';
}

// Takes what is new. A weight typed in later wins until Volumora has a newer one; a chosen activity stays.
export function mergeVolumora(profile, found) {
  const next = { ...profile };
  let changed = false;
  if (found.weight && found.weightAt > (profile.weightAt ?? 0)) {
    next.weight = found.weight;
    next.weightAt = found.weightAt;
    next.weightFrom = 'volumora';
    changed = true;
  }
  const merged = mergeWeights(profile.weights, found.weights);
  if (merged) {
    next.weights = merged;
    changed = true;
  }
  const activity = activityFor(found.sessionsPerWeek);
  if (
    activity &&
    (!profile.activity || profile.activityFrom === 'volumora') &&
    profile.activity !== activity
  ) {
    next.activity = activity;
    next.activityFrom = 'volumora';
    changed = true;
  }
  return changed ? next : null;
}

export async function updateFromVolumora() {
  const response = await call('/v1/snapshot');
  if (response.status === 404) return false;
  const snapshot = await response.json();
  const next = mergeVolumora(getProfile(), readVolumora(snapshot?.backup));
  if (!next) return false;
  saveProfile(next);
  return true;
}
