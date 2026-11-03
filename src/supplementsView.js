// Supplements: the person's own list, and Claude's judgement of what is worth taking for them, including "nothing".
import { getPlan, getSupplements, saveSupplements } from './actions.js';
import { askClaudeJson } from './ai.js';
import { dailyTargets, GOALS } from './nutrition.js';
import { getProfile } from './profile.js';
import { errorText, esc, rerender } from './ui.js';

const state = { busy: false, error: null };

const ADVICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recommended', 'notNeeded', 'note'],
  properties: {
    recommended: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'dose', 'when', 'why', 'evidence', 'caution'],
        properties: {
          name: { type: 'string' },
          dose: { type: 'string' },
          when: { type: 'string' },
          why: { type: 'string' },
          evidence: { type: 'string', enum: ['stark', 'mittel', 'schwach'] },
          caution: { type: 'string' },
        },
      },
    },
    notNeeded: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'why'],
        properties: { name: { type: 'string' }, why: { type: 'string' } },
      },
    },
    note: { type: 'string' },
  },
};

const ADVICE_SYSTEM = `Du beurteilst, welche Nahrungsergänzungsmittel für einen Menschen sinnvoll sind.

Regeln:
- Essen zuerst. Empfiehl nur, was für dieses Ziel und diese Ernährung einen belegten Nutzen hat. Eine kurze Liste ist besser als eine lange, auch eine leere ist in Ordnung.
- "evidence" sagt ehrlich, wie gut die Studienlage ist. Schwach Belegtes empfiehlst du nur, wenn es dafür einen konkreten Grund gibt.
- Dosierungen im üblichen, sicheren Bereich, nie Megadosen. Fettlösliche Vitamine und Eisen nur nach Bluttest und mit diesem Hinweis in "caution".
- Vegane oder vegetarische Ernährung: an B12 denken.
- Nennt der Mensch Medikamente oder Erkrankungen, prüfe Wechselwirkungen. Bist du unsicher, gehört es nicht in "recommended", sondern mit dem Hinweis auf ärztlichen Rat in "notNeeded".
- Keine Abnehm-Booster, Fatburner oder Testosteron-Mittel.
- "notNeeded" nennt die häufig beworbenen Mittel, die sich hier nicht lohnen, mit kurzem Grund.
- Deutsch, kurz. "note" ist ein Satz zum Gesamtbild.`;

const newId = () => `m-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

export function addSupplement(name, dose) {
  const text = name.trim();
  if (!text) return;
  const data = getSupplements();
  data.mine = [...(data.mine ?? []), { id: newId(), name: text, dose: dose.trim() }];
  saveSupplements(data);
  rerender();
}

async function askAdvice() {
  if (state.busy) return;
  state.busy = true;
  state.error = null;
  rerender();
  try {
    const profile = getProfile();
    const targets = dailyTargets(profile);
    const plan = getPlan();
    const data = getSupplements();
    const lines = [
      `Ziel: ${GOALS[profile.goal]?.label ?? 'gesund essen'}.`,
      `Alter ${profile.age ?? 'unbekannt'}, Gewicht ${profile.weight ?? 'unbekannt'} kg, Bewegung ${profile.activity || 'unbekannt'}.`,
      profile.sex ? `Geschlecht: ${profile.sex === 'male' ? 'männlich' : 'weiblich'}.` : '',
      targets ? `Tagesziel: ca. ${targets.kcal} kcal, ${targets.protein} g Eiweiß.` : '',
      profile.diet?.length ? `Ernährung: ${profile.diet.join(', ')}.` : 'Ernährung: ohne besondere Form.',
      profile.avoid ? `Mag oder verträgt nicht: ${profile.avoid}.` : '',
      profile.health
        ? `Medikamente oder Erkrankungen: ${profile.health}.`
        : 'Medikamente oder Erkrankungen: keine genannt.',
      plan ? `Gerichte dieser Woche: ${plan.recipes.map((recipe) => recipe.name).join(', ')}.` : '',
      data.mine?.length
        ? `Nimmt bereits: ${data.mine.map((item) => `${item.name} ${item.dose}`).join(', ')}. Sag auch dazu, ob sich das lohnt.`
        : 'Nimmt bisher nichts.',
    ];
    const advice = await askClaudeJson({
      system: ADVICE_SYSTEM,
      maxTokens: 8000,
      effort: 'medium',
      format: ADVICE_SCHEMA,
      messages: [{ role: 'user', content: lines.filter(Boolean).join('\n') }],
    });
    saveSupplements({ ...getSupplements(), advice: { ...advice, at: new Date().toISOString() } });
  } catch (err) {
    state.error = err;
  }
  state.busy = false;
  rerender();
}

export function supplementsView() {
  const { mine = [], advice } = getSupplements();
  const have = new Set(mine.map((item) => item.name.toLowerCase()));
  return `
    <button type="button" class="back" data-tab="more">Mehr</button>
    <h1>Supplements</h1>
    ${
      mine.length
        ? `<div class="list" id="supplementList">${mine
            .map(
              (item) => `
              <div class="row">
                <span class="grow"><span class="block">${esc(item.name)}</span><span class="muted small">${esc(item.dose)}</span></span>
                <button type="button" class="text-button" data-action="dropSupplement" data-id="${esc(item.id)}" aria-label="${esc(item.name)} entfernen">Entfernen</button>
              </div>`
            )
            .join('')}</div>`
        : ''
    }
    <form id="supplementAdd" class="inline-form" novalidate>
      <div class="fields two">
        <label class="field">Name<input name="name" type="text" maxlength="60" placeholder="Kreatin"></label>
        <label class="field">Menge<input name="dose" type="text" maxlength="40" placeholder="3 g"></label>
      </div>
      <button type="submit" class="secondary">Eintragen</button>
    </form>
    <button type="button" class="primary spaced" data-action="askAdvice"${state.busy ? ' disabled' : ''}>${state.busy ? 'Claude überlegt …' : 'Was passt zu mir?'}</button>
    ${state.error ? `<p class="error" role="alert">${esc(errorText(state.error))}</p>` : ''}
    ${
      advice
        ? `<section id="advice" class="advice">
            <p class="note">${esc(advice.note)}</p>
            ${
              advice.recommended.length
                ? `<h2 class="section">Lohnt sich für dich</h2><div class="list">${advice.recommended
                    .map(
                      (item, index) => `
                      <div class="row">
                        <span class="grow">
                          <span class="block">${esc(item.name)}, ${esc(item.dose)}</span>
                          <span class="muted small block">${esc(item.when)}. ${esc(item.why)} Studienlage: ${esc(item.evidence)}.</span>
                          ${item.caution ? `<span class="warn block">${esc(item.caution)}</span>` : ''}
                        </span>
                        ${
                          have.has(item.name.toLowerCase())
                            ? '<span class="muted small">Dabei</span>'
                            : `<button type="button" class="text-button" data-action="adoptSupplement" data-index="${index}" aria-label="${esc(item.name)} übernehmen">Übernehmen</button>`
                        }
                      </div>`
                    )
                    .join('')}</div>`
                : ''
            }
            ${
              advice.notNeeded.length
                ? `<h2 class="section">Brauchst du nicht</h2><div class="list">${advice.notNeeded
                    .map(
                      (item) =>
                        `<div class="row stacked"><span>${esc(item.name)}</span><span class="muted">${esc(item.why)}</span></div>`
                    )
                    .join('')}</div>`
                : ''
            }
            <p class="note">Das ersetzt keinen ärztlichen Rat. Bei Schwangerschaft, Medikamenten oder Erkrankungen vorher abklären.</p>
          </section>`
        : ''
    }`;
}

export const supplementActions = {
  askAdvice: () => askAdvice(),
  dropSupplement: (el) => {
    const data = getSupplements();
    data.mine = data.mine.filter((item) => item.id !== el.dataset.id);
    saveSupplements(data);
    rerender();
  },
  adoptSupplement: (el) => {
    const data = getSupplements();
    const item = data.advice?.recommended?.[Number(el.dataset.index)];
    if (!item) return;
    data.mine = [...(data.mine ?? []), { id: newId(), name: item.name, dose: item.dose }];
    saveSupplements(data);
    rerender();
  },
};
