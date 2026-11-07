// Deine Woche: the last seven days against the daily target, and the average of the days that are over.
import { getAllExtras, getHistory, getPlan } from './actions.js';
import { weekIntake } from './foodLog.js';
import { dailyTargets } from './nutrition.js';
import { getProfile } from './profile.js';
import { localDay } from './planner.js';
import { dayLabel, esc, number } from './ui.js';

const bar = (value, goal) =>
  `<span class="bar"><span style="width:${Math.min(100, Math.round((value / goal) * 100))}%"></span></span>`;

export function weekView() {
  const today = localDay();
  const targets = dailyTargets(getProfile());
  const week = weekIntake(today, [getPlan(), ...getHistory()], getAllExtras());
  const head = '<button type="button" class="back" data-tab="today">Heute</button><h1>Deine Woche</h1>';
  if (!targets)
    return `${head}<p class="sub">Mit Ziel, Alter, Größe und Gewicht im Profil siehst du hier jeden Tag gegen dein Ziel.</p>`;
  const average = week.average;
  return `
    ${head}
    <section class="card" id="weekAverage">
      ${
        average
          ? `<span class="eyebrow">Schnitt aus ${week.counted} ${week.counted === 1 ? 'Tag' : 'Tagen'}</span>
             <h2>ca. ${number(Math.round(average.kcal / 10) * 10)} kcal, ${number(average.protein)} g Eiweiß</h2>
             <p>Ziel: ${number(targets.kcal)} kcal und ${number(targets.protein)} g Eiweiß. ${verdict(average, targets)}</p>
             <p class="small">Fett ${number(average.fat)} g · Kohlenhydrate ${number(average.carbs)} g am Tag</p>`
          : '<h2>Noch kein ganzer Tag</h2><p>Sobald ein Tag mit Einträgen vorbei ist, steht hier dein Schnitt.</p>'
      }
    </section>
    <div class="list" id="weekDays">
      ${week.days
        .slice()
        .reverse()
        .map(
          (day) => `
          <div class="row stacked week-day">
            <span>${day.date === today ? 'Heute' : esc(dayLabel(day.date))}</span>
            ${
              day.entries.length
                ? `<span class="week-values">
                     <span><strong>${number(day.total.kcal)}</strong> <span class="muted">kcal</span>${bar(day.total.kcal, targets.kcal)}</span>
                     <span><strong>${number(day.total.protein)} g</strong> <span class="muted">Eiweiß</span>${bar(day.total.protein, targets.protein)}</span>
                   </span>`
                : '<span class="muted">Nichts eingetragen</span>'
            }
          </div>`
        )
        .join('')}
    </div>
    <button type="button" class="secondary" data-action="rateHabits" id="rateHabits">Von Claude bewerten lassen</button>
    <p class="note">Alle Werte sind ungefähr. Heute zählt erst im Schnitt, wenn der Tag vorbei ist. Tage ohne Einträge zählen nicht mit.</p>`;
}

// A plain word on the average, with room for the usual day-to-day swing.
function verdict(average, targets) {
  const kcal = average.kcal - targets.kcal;
  const kcalWord =
    Math.abs(kcal) <= targets.kcal * 0.07
      ? 'Bei den Kalorien liegst du im Ziel'
      : kcal > 0
        ? `Du liegst etwa ${number(Math.round(kcal / 50) * 50)} kcal drüber`
        : `Du liegst etwa ${number(Math.round(-kcal / 50) * 50)} kcal drunter`;
  const proteinWord =
    average.protein >= targets.protein * 0.9 ? 'beim Eiweiß passt es.' : 'beim Eiweiß fehlt noch etwas.';
  return `${kcalWord}, ${proteinWord}`;
}
