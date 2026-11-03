// What the person tells the app about themselves.
import { read, write } from './store.js';

export const DIETS = ['Vegetarisch', 'Vegan', 'Kein Schwein', 'Laktosefrei', 'Glutenfrei', 'Ohne Nüsse'];
export const MEALS = ['Frühstück', 'Mittagessen', 'Abendessen'];
export const DEVICES = ['Herd', 'Ofen', 'Mikrowelle', 'Airfryer', 'Slow Cooker'];

const DEFAULTS = {
  goal: '',
  goalText: '',
  sex: '',
  age: null,
  height: null,
  weight: null,
  activity: '',
  people: 1,
  cookDays: 1,
  cookWeekday: 0,
  cookTime: '10:00',
  cookWeekday2: 3,
  cookTime2: '18:00',
  shopWeekday: 6,
  shopTime: '17:00',
  eatDays: 7,
  cookMinutes: 90,
  meals: ['Mittagessen', 'Abendessen'],
  freezer: true,
  diet: [],
  avoid: '',
  health: '',
  budget: null,
  boxes: null,
  weights: [],
  kcalAdjust: 0,
  devices: ['Herd', 'Ofen', 'Mikrowelle'],
};

export const getProfile = () => ({ ...DEFAULTS, ...read('profile', {}) });
export const saveProfile = (profile) => write('profile', profile);
