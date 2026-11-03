// What the person tells the app about themselves. It stays on this device until Prepora has its own place on the server.
const KEY = 'prepora-profile';

export const DIETS = ['Vegetarisch', 'Vegan', 'Kein Schwein', 'Laktosefrei', 'Glutenfrei', 'Ohne Nüsse'];
export const MEALS = ['Frühstück', 'Mittagessen', 'Abendessen'];
export const DEVICES = ['Herd', 'Ofen', 'Mikrowelle', 'Airfryer', 'Slow Cooker'];

const DEFAULTS = {
  goal: '',
  sex: '',
  age: null,
  height: null,
  weight: null,
  activity: '',
  people: 1,
  cookDays: 1,
  cookMinutes: 90,
  meals: ['Mittagessen', 'Abendessen'],
  freezer: true,
  diet: [],
  avoid: '',
  devices: ['Herd', 'Ofen', 'Mikrowelle'],
};

export function getProfile() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // A full storage keeps the answers on screen; the next change tries again.
  }
}
