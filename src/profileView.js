// The profile as one form that saves on every change, with the daily targets above it.
import { ACTIVITY, GOALS, dailyTargets } from './nutrition.js';
import { updateBlocks } from './actions.js';
import { shareCalendar } from './calendar.js';
import { DEVICES, DIETS, MEALS, getProfile, saveProfile } from './profile.js';
import { enablePush, pushOn, pushSupported } from './push.js';
import { addWeight } from './trend.js';
import { esc, number, rerender } from './ui.js';

export function targetText(targets) {
  return `ca. ${number(targets.kcal)} kcal, ${number(targets.protein)} g Eiweiß am Tag`;
}

const NOTES = {
  floor: 'Das ist deine Untergrenze. Weniger plant Prepora nicht.',
  underweight: 'Dein Gewicht liegt im Untergewicht. Prepora plant deshalb kein Kaloriendefizit.',
};

const pills = (name, options, selected, type = 'radio') => `
  <div class="pills${options.length === 7 ? ' week' : ''}">
    ${options
      .map(([value, label]) => {
        const on = type === 'radio' ? String(selected) === String(value) : selected.includes(value);
        return `<label class="pill"><input type="${type}" name="${name}" value="${esc(value)}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
      })
      .join('')}
  </div>`;
const same = (values) => values.map((value) => [value, value]);
const WEEK = [
  [1, 'Mo'],
  [2, 'Di'],
  [3, 'Mi'],
  [4, 'Do'],
  [5, 'Fr'],
  [6, 'Sa'],
  [0, 'So'],
];
const timeField = (name, label, value) => `
  <label class="field">${label}
    <span class="with-unit"><input type="time" name="${name}" value="${esc(value)}"></span>
  </label>`;
const optionalNumber = (name, label, value, unit) => `
  <label class="field">${label}
    <span class="with-unit"><input type="number" inputmode="numeric" name="${name}" value="${value ?? ''}"><span class="muted">${unit}</span></span>
  </label>`;
const field = (name, label, value, unit) => `
  <label class="field">${label}
    <span class="with-unit"><input type="number" inputmode="numeric" name="${name}" value="${value ?? ''}"><span class="muted">${unit}</span></span>
  </label>`;

export function profileView() {
  const profile = getProfile();
  return `
    <button type="button" class="back" data-tab="more">Mehr</button>
    <h1>Profil</h1>
    <div class="target" id="targets" role="status"></div>
    <form id="profile" class="stack" novalidate>
      <fieldset><legend>Dein Ziel</legend>
        ${pills(
          'goal',
          Object.entries(GOALS).map(([value, goal]) => [value, goal.label]),
          profile.goal
        )}
      </fieldset>
      <fieldset><legend>Dein Körper</legend>
        <div class="fields">
          ${field('age', 'Alter', profile.age, 'Jahre')}
          ${field('height', 'Größe', profile.height, 'cm')}
          ${field('weight', 'Gewicht', profile.weight, 'kg')}
        </div>
        ${profile.weightFrom === 'volumora' ? '<p class="caption">Gewicht kommt aus Volumora</p>' : ''}
        <p class="caption">Für die Kalorienformel</p>
        ${pills(
          'sex',
          [
            ['male', 'Männlich'],
            ['female', 'Weiblich'],
            ['', 'Keine Angabe'],
          ],
          profile.sex
        )}
        <p class="caption">Bewegung inklusive Training</p>
        ${pills(
          'activity',
          Object.entries(ACTIVITY).map(([value, level]) => [value, level.label]),
          profile.activity
        )}
        <p class="note">Mittel heißt: Bürojob und zwei- bis fünfmal Training pro Woche. Viel nur bei körperlicher Arbeit oder fast täglich hartem Training.</p>
      </fieldset>
      <fieldset><legend>Dein Kochen</legend>
        <p class="caption">Kochtage pro Woche</p>
        ${pills(
          'cookDays',
          [
            [1, 'Einer'],
            [2, 'Zwei'],
          ],
          profile.cookDays
        )}
        <p class="caption">${profile.cookDays === 2 ? 'Erster Kochtag' : 'Kochtag'}</p>
        ${pills('cookWeekday', WEEK, profile.cookWeekday)}
        ${timeField('cookTime', 'Um', profile.cookTime)}
        ${
          profile.cookDays === 2
            ? `<p class="caption">Zweiter Kochtag</p>
               ${pills('cookWeekday2', WEEK, profile.cookWeekday2)}
               ${timeField('cookTime2', 'Um', profile.cookTime2)}`
            : ''
        }
        <p class="caption">Einkauf, einmal pro Woche</p>
        ${pills('shopWeekday', WEEK, profile.shopWeekday)}
        ${timeField('shopTime', 'Um', profile.shopTime)}
        <button type="button" class="secondary" data-action="addCalendar">In den Kalender eintragen</button>
        ${
          pushSupported() && !pushOn()
            ? '<button type="button" class="secondary" data-action="enableReminders">Erinnerungen einschalten</button>'
            : ''
        }
        <p class="note" id="blockNote" role="status"></p>
        <p class="caption">Gegessen wird an</p>
        ${pills(
          'eatDays',
          [
            [5, '5 Tagen'],
            [7, '7 Tagen'],
          ],
          profile.eatDays
        )}
        <p class="caption">Zeit pro Kochtag</p>
        ${pills(
          'cookMinutes',
          [
            [60, '60 Min.'],
            [90, '90 Min.'],
            [120, '120 Min.'],
          ],
          profile.cookMinutes
        )}
        <p class="caption">Personen</p>
        ${pills(
          'people',
          [1, 2, 3, 4].map((value) => [value, String(value)]),
          profile.people
        )}
        <p class="caption">Vorkochen für</p>
        ${pills('meals', same(MEALS), profile.meals, 'checkbox')}
        <p class="caption">Tiefkühler</p>
        ${pills(
          'freezer',
          [
            ['yes', 'Vorhanden'],
            ['no', 'Keiner'],
          ],
          profile.freezer ? 'yes' : 'no'
        )}
        <p class="caption">Geräte</p>
        ${pills('devices', same(DEVICES), profile.devices, 'checkbox')}
        <div class="fields two">
          ${optionalNumber('boxes', 'Boxen zu Hause', profile.boxes, 'Stück')}
          ${optionalNumber('budget', 'Einkauf pro Woche', profile.budget, '€')}
        </div>
      </fieldset>
      <fieldset><legend>Dein Essen</legend>
        ${pills('diet', same(DIETS), profile.diet, 'checkbox')}
        <label class="field">Das magst du nicht oder verträgst es nicht
          <textarea name="avoid" rows="2" maxlength="300">${esc(profile.avoid)}</textarea>
        </label>
        <label class="field">Medikamente oder Erkrankungen, nur für die Supplement-Beratung und freiwillig
          <textarea name="health" rows="2" maxlength="300">${esc(profile.health)}</textarea>
        </label>
      </fieldset>
    </form>`;
}

function readForm(form, before) {
  const data = new FormData(form);
  const numeric = (name) => {
    const text = String(data.get(name) ?? '').trim();
    return text === '' ? null : Number(text);
  };
  const weight = numeric('weight');
  const activity = data.get('activity') ?? '';
  return {
    ...before,
    // Typed in by hand it counts as new, until Volumora has something newer.
    ...(weight !== before.weight
      ? { weightAt: Date.now(), weightFrom: '', weights: addWeight(before.weights, weight) }
      : {}),
    ...(activity !== before.activity ? { activityFrom: '' } : {}),
    goal: data.get('goal') ?? '',
    sex: data.get('sex') ?? '',
    age: numeric('age'),
    height: numeric('height'),
    weight,
    activity,
    cookWeekday: numeric('cookWeekday') ?? 0,
    cookTime: data.get('cookTime') || before.cookTime,
    cookWeekday2: numeric('cookWeekday2') ?? before.cookWeekday2,
    cookTime2: data.get('cookTime2') || before.cookTime2,
    shopWeekday: numeric('shopWeekday') ?? before.shopWeekday,
    shopTime: data.get('shopTime') || before.shopTime,
    boxes: numeric('boxes'),
    budget: numeric('budget'),
    health: String(data.get('health') ?? '').trim(),
    eatDays: numeric('eatDays') ?? 7,
    people: numeric('people') ?? 1,
    cookDays: numeric('cookDays') ?? 1,
    cookMinutes: numeric('cookMinutes') ?? 90,
    meals: data.getAll('meals'),
    freezer: data.get('freezer') !== 'no',
    diet: data.getAll('diet'),
    avoid: String(data.get('avoid') ?? '').trim(),
    devices: data.getAll('devices'),
  };
}

export function showTargets() {
  const box = document.getElementById('targets');
  if (!box) return;
  const targets = dailyTargets(getProfile());
  const profile = getProfile();
  const adjusted = profile.kcalAdjust && profile.adjustNote ? profile.adjustNote : '';
  box.innerHTML = targets
    ? `<strong>${targetText(targets)}</strong>${targets.limited ? `<span class="muted">${NOTES[targets.limited]}</span>` : ''}${adjusted ? `<span class="muted" id="adjustNote">${esc(adjusted)}</span>` : ''}`
    : '<span class="muted">Ziel, Alter ab 18, Größe, Gewicht und Bewegung ergeben deine Tageswerte.</span>';
}

export function saveFromForm(form) {
  saveProfile(readForm(form, getProfile()));
  showTargets();
}

export const profileActions = {
  addCalendar: async () => {
    const note = document.getElementById('blockNote');
    const done = await shareCalendar(getProfile());
    if (note) note.textContent = done ? '' : 'Das hat auf diesem Gerät nicht geklappt.';
  },
  enableReminders: async () => {
    if (await enablePush()) {
      updateBlocks();
      rerender();
    } else {
      const note = document.getElementById('blockNote');
      if (note)
        note.textContent = 'Auf dem iPhone geht das nur in der installierten App, und du musst es erlauben.';
    }
  },
};
