// What the person tells the app about themselves.
import { read, write } from './store.js';

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
  cookWeekday: 0,
  eatDays: 7,
  cookMinutes: 90,
  meals: ['Mittagessen', 'Abendessen'],
  freezer: true,
  diet: [],
  avoid: '',
  devices: ['Herd', 'Ofen', 'Mikrowelle'],
};

export const getProfile = () => ({ ...DEFAULTS, ...read('profile', {}) });
export const saveProfile = (profile) => write('profile', profile);
