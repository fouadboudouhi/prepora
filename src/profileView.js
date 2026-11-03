// The profile as one form that saves on every change, with the daily targets above it.
import { ACTIVITY, GOALS, dailyTargets } from './nutrition.js';
import { updateBlocks } from './actions.js';
import { askClaudeJson } from './ai.js';
import { shareCalendar } from './calendar.js';
import { ADVICE_SCHEMA, ADVICE_SYSTEM, adviceRequest, validAdvice } from './goalAdvice.js';
import { DEVICES, DIETS, MEALS, getProfile, saveProfile } from './profile.js';
import { enablePush, pushOn, pushSupported } from './push.js';
import { SessionError } from './session.js';
import { addWeight } from './trend.js';
import { errorText, esc, number, rerender } from './ui.js';

export function targetText(targets) {
  return `ca. ${number(targets.kcal)} kcal, ${number(targets.protein)} g Eiweiß am Tag`;
}

// What a choice does, shown under the choice and updated with every tap.
const GOAL_EFFECT = {
  muscle: '300 kcal über deinem Verbrauch. Erwartet: etwa 1 kg mehr im Monat.',
  lose: '500 kcal unter deinem Verbrauch. Erwartet: etwa 2 kg weniger im Monat.',
  cut: '300 kcal unter deinem Verbrauch und etwas mehr Eiweiß. Erwartet: etwa 1,2 kg weniger im Monat.',
  keep: 'So viel, wie du verbrauchst. Dein Gewicht bleibt etwa gleich.',
  endurance: 'So viel, wie du verbrauchst. Claude weiß, dass du Ausdauersport machst, und plant danach.',
};
const GOAL_FOR = {
  muscle:
    'Du trainierst Kraft mindestens dreimal pro Woche und willst sichtbar mehr Muskeln. Ein Teil der Zunahme ist Fett. Passt am besten, wenn du eher schlank bist.',
  lose: 'Du willst vor allem Gewicht verlieren und hast deutlich Übergewicht. Training ist kein Muss, hilft aber, die Muskeln zu halten.',
  cut: 'Du trainierst Kraft und willst Fett verlieren, ohne Muskeln zu verlieren. Passt, wenn du nicht mehr weit von deinem Wunschgewicht weg bist.',
  keep: 'Nach einer Diät, oder wenn du trainierst und langsam zugleich Fett ab- und Muskeln aufbauen willst. Das klappt vor allem bei Einsteigern und nach einer Pause gut.',
  endurance:
    'Du machst vor allem Laufen, Radfahren, Schwimmen oder Ähnliches und willst dein Gewicht halten.',
};
const ACTIVITY_FOR = {
  low: 'Sitzender Alltag und höchstens einmal Training pro Woche.',
  medium:
    'Sitzender Alltag und zwei- bis fünfmal Training pro Woche, oder viel auf den Beinen ohne Training.',
  high: 'Körperlich schwere Arbeit, auf den Beinen und dazu Training, oder fast täglich hartes Training.',
};
// Rows: the working day. Columns: trainings a week of about 45 to 90 minutes.
const ACTIVITY_TABLE = [
  ['Sitzend: Büro, Homeoffice, Studium, Auto', 'low', 'medium', 'high'],
  ['Viel auf den Beinen: Verkauf, Pflege, Gastro, Kita', 'medium', 'high', 'high'],
  ['Körperlich schwer: Bau, Handwerk, Lager', 'high', 'high', 'high'],
];

const goalGuide = `
  <details class="guide">
    <summary>Welches Ziel passt zu mir?</summary>
    <div>
      <dl>${Object.entries(GOALS)
        .map(([key, goal]) => `<dt>${goal.label}</dt><dd>${GOAL_FOR[key]}</dd>`)
        .join('')}</dl>
      <p>Unsicher? Stört dich Fett am Bauch, nimm Definition, bei viel Übergewicht Abnehmen. Bist du eher schlank und willst größer werden, nimm Muskelaufbau. Liegst du dazwischen, nimm Gewicht halten.</p>
    </div>
  </details>`;
const activityGuide = `
  <details class="guide">
    <summary>Welche Stufe passt zu mir?</summary>
    <div>
      <table>
        <thead><tr><th scope="col">Dein Alltag</th><th scope="col">0–1× Training</th><th scope="col">2–5×</th><th scope="col">6–7×</th></tr></thead>
        <tbody>${ACTIVITY_TABLE.map(
          ([day, ...levels]) =>
            `<tr><th scope="row">${day}</th>${levels.map((level) => `<td>${ACTIVITY[level].label}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
      <p>Training heißt: etwa 45 bis 90 Minuten Kraft- oder Ausdauersport. Spaziergänge zählen nicht. Gehst du jeden Tag mehr als 10.000 Schritte, etwa mit dem Rad zur Arbeit, nimm eine Stufe höher.</p>
      <p>Im Zweifel die niedrigere Stufe. Den Verbrauch schätzen die meisten zu hoch ein, und nach zwei Wochen mit Gewicht passt Prepora das Ziel an deinen echten Verlauf an.</p>
    </div>
  </details>`;

function showHints(profile) {
  const goal = document.getElementById('goalHint');
  if (goal) goal.textContent = GOAL_EFFECT[profile.goal] ?? '';
  const activity = document.getElementById('activityHint');
  if (activity) activity.textContent = ACTIVITY_FOR[profile.activity] ?? '';
}

const advice = { busy: false, error: null, result: null };

function adviceBlock(profile) {
  if (advice.busy) return '<p class="note" role="status">Claude überlegt …</p>';
  if (advice.error) return `<p class="note error" role="alert">${esc(errorText(advice.error))}</p>`;
  const result = advice.result;
  if (!result) return '';
  const targets = dailyTargets({ ...profile, goal: result.goal, activity: result.activity });
  const chosen = result.goal === profile.goal && result.activity === profile.activity;
  return `
    <section class="card" id="goalAdvice">
      <span class="eyebrow">Claude empfiehlt</span>
      <h2>${GOALS[result.goal].label}, Bewegung ${ACTIVITY[result.activity].label}</h2>
      ${targets ? `<p class="plain">${targetText(targets)}</p>` : ''}
      <p>${esc(result.reason)}</p>
      ${result.assumption ? `<p class="small">${esc(result.assumption)} Stimmt das nicht, schreib es oben dazu und frag nochmal.</p>` : ''}
      ${chosen ? '<p class="plain">Ist so eingestellt.</p>' : '<button type="button" class="primary" data-action="applyAdvice">Übernehmen</button>'}
    </section>`;
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
        <label class="field">Sag Claude, was du willst
          <textarea name="goalText" rows="3" maxlength="600" placeholder="Zum Beispiel: Ich will etwas Bauch verlieren, sitze im Büro und trainiere dreimal die Woche.">${esc(profile.goalText)}</textarea>
        </label>
        <button type="button" class="secondary" data-action="adviseGoal"${advice.busy ? ' disabled' : ''}>Einstellung empfehlen lassen</button>
        ${adviceBlock(profile)}
        <p class="caption">Oder selbst wählen</p>
        ${pills(
          'goal',
          Object.entries(GOALS).map(([value, goal]) => [value, goal.label]),
          profile.goal
        )}
        <p class="note" id="goalHint">${GOAL_EFFECT[profile.goal] ?? ''}</p>
        ${goalGuide}
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
        <p class="note" id="activityHint">${ACTIVITY_FOR[profile.activity] ?? ''}</p>
        ${activityGuide}
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
    goalText: String(data.get('goalText') ?? '').trim(),
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
  showHints(getProfile());
}

export const profileActions = {
  adviseGoal: async () => {
    document.activeElement?.blur?.();
    const profile = getProfile();
    advice.result = null;
    advice.error = profile.goalText ? null : new SessionError('nowish');
    if (advice.error) return rerender();
    advice.busy = true;
    rerender();
    try {
      const answer = await askClaudeJson({
        system: ADVICE_SYSTEM,
        format: ADVICE_SCHEMA,
        effort: 'low',
        maxTokens: 2000,
        messages: [{ role: 'user', content: adviceRequest(profile.goalText, profile) }],
      });
      advice.result = validAdvice(answer);
      if (!advice.result) throw new SessionError('server', 'Die Empfehlung passte zu keiner Einstellung.');
    } catch (err) {
      advice.error = err;
    }
    advice.busy = false;
    rerender();
  },
  // Chosen by the person, so Volumora leaves the level alone from here on.
  applyAdvice: () => {
    if (!advice.result) return;
    const { goal, activity } = advice.result;
    saveProfile({ ...getProfile(), goal, activity, activityFrom: '' });
    rerender();
  },
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
