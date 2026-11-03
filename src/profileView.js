// The profile as one form that saves on every change, with the daily targets above it.
import { ACTIVITY, GOALS, dailyTargets } from './nutrition.js';
import { DEVICES, DIETS, MEALS, getProfile, saveProfile } from './profile.js';

const esc = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const number = (value) => value.toLocaleString('de-DE');

export function targetText(targets) {
  return `ca. ${number(targets.kcal)} kcal, ${number(targets.protein)} g Eiweiß am Tag`;
}

const NOTES = {
  floor: 'Das ist deine Untergrenze. Weniger plant Prepora nicht.',
  underweight: 'Dein Gewicht liegt im Untergewicht. Prepora plant deshalb kein Kaloriendefizit.',
};

const pills = (name, options, selected, type = 'radio') => `
  <div class="pills">
    ${options
      .map(([value, label]) => {
        const on = type === 'radio' ? String(selected) === String(value) : selected.includes(value);
        return `<label class="pill"><input type="${type}" name="${name}" value="${esc(value)}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;
      })
      .join('')}
  </div>`;
const same = (values) => values.map((value) => [value, value]);
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
      </fieldset>
      <fieldset><legend>Dein Essen</legend>
        ${pills('diet', same(DIETS), profile.diet, 'checkbox')}
        <label class="field">Das magst du nicht oder verträgst es nicht
          <textarea name="avoid" rows="2" maxlength="300">${esc(profile.avoid)}</textarea>
        </label>
      </fieldset>
    </form>`;
}

function readForm(form) {
  const data = new FormData(form);
  const numeric = (name) => {
    const text = String(data.get(name) ?? '').trim();
    return text === '' ? null : Number(text);
  };
  return {
    goal: data.get('goal') ?? '',
    sex: data.get('sex') ?? '',
    age: numeric('age'),
    height: numeric('height'),
    weight: numeric('weight'),
    activity: data.get('activity') ?? '',
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
  box.innerHTML = targets
    ? `<strong>${targetText(targets)}</strong>${targets.limited ? `<span class="muted">${NOTES[targets.limited]}</span>` : ''}`
    : '<span class="muted">Ziel, Alter ab 18, Größe, Gewicht und Bewegung ergeben deine Tageswerte.</span>';
}

export function saveFromForm(form) {
  saveProfile(readForm(form));
  showTargets();
}
