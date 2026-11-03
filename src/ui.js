// What the screens share. A screen is a function that returns HTML; taps reach it through data-action.
export const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const number = (value) => Number(value).toLocaleString('de-DE');

const SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const dayLabel = (date) => {
  const at = new Date(`${date}T12:00:00`);
  return `${SHORT[at.getDay()]}, ${at.getDate()}.${at.getMonth() + 1}.`;
};

const ERRORS = {
  user: 'Benutzername oder Passwort stimmt nicht.',
  network: 'Der Server ist gerade nicht erreichbar.',
  blocked: 'Zu viele Versuche. Bitte in zehn Minuten nochmal.',
  budget: 'Das Claude-Budget für diesen Monat ist aufgebraucht.',
  noai: 'Auf dem Server ist kein Claude-Schlüssel hinterlegt.',
  refused: 'Claude hat diese Anfrage abgelehnt.',
  toolong: 'Die Antwort wurde zu lang. Bitte nochmal versuchen.',
  badplan: 'Der Plan passte auch im zweiten Anlauf nicht.',
  norecipe: 'Daraus ließ sich kein Rezept lesen.',
  nowish: 'Schreib erst kurz, was du erreichen willst.',
  server: 'Beim Server ist etwas schiefgelaufen.',
};
export const errorText = (err) => {
  const text = ERRORS[err?.code] ?? ERRORS.server;
  return err?.detail ? `${text} (${err.detail})` : text;
};

let redraw = () => {};
export const setRedraw = (fn) => {
  redraw = fn;
};
export const rerender = () => redraw();

let opener = () => {};
export const setOpener = (fn) => {
  opener = fn;
};
export const openView = (id) => opener(id);
