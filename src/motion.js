// Movement like the iPhone's own: a screen slides in from the right and back out, the chat rises like a sheet, tabs
// fade over, numbers count to their new value and a new entry slides into its list. A redraw on the same screen
// stays still, so only a real change moves. Nothing moves at all when the phone asks for less motion.
import { number } from './ui.js';

const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
const root = document.documentElement;
const ARRIVE_TIME = 900;
const COUNT_TIME = 650;

let entering = false;
let arriveTimer = null;
const counts = new Map();
let seen = null;

function arrive(direction) {
  root.classList.remove('arrive');
  void root.offsetWidth;
  root.dataset.arrive = direction;
  root.classList.add('arrive');
  clearTimeout(arriveTimer);
  arriveTimer = setTimeout(() => root.classList.remove('arrive'), ARRIVE_TIME);
}

// direction: push (deeper), pop (back), tab, sheet (chat opens) or close (chat closes).
export function navigate(direction, update) {
  const run = () => {
    entering = true;
    try {
      update();
    } finally {
      entering = false;
    }
    if (!still()) arrive(direction);
  };
  if (still() || !document.startViewTransition) return run();
  root.dataset.nav = direction;
  const transition = document.startViewTransition(run);
  transition.finished.finally(() => {
    if (root.dataset.nav === direction) delete root.dataset.nav;
  });
}

const easeOut = (t) => 1 - (1 - t) ** 3;
const valueOf = (text) => Number(String(text).replace(/\./g, '').replace(',', '.'));

function countTo(element, from, to) {
  const start = performance.now();
  const step = (time) => {
    if (!element.isConnected) return;
    const t = Math.min(1, (time - start) / COUNT_TIME);
    element.textContent = number(Math.round(from + (to - from) * easeOut(t)));
    if (t < 1) requestAnimationFrame(step);
  };
  element.textContent = number(from);
  requestAnimationFrame(step);
}

// After every draw: numbers that changed count over, rows that are new slide in. Right after a screen change
// everything is only noted, so arriving somewhere does not set things moving.
export function settle(container) {
  const quiet = entering || still();
  container.querySelectorAll('[data-count]').forEach((element) => {
    const key = element.dataset.count;
    const to = valueOf(element.textContent);
    const from = counts.get(key);
    counts.set(key, to);
    if (!quiet && from !== undefined && from !== to && Number.isFinite(to)) countTo(element, from, to);
  });
  const rows = [...container.querySelectorAll('[data-key]')];
  const keys = new Set(rows.map((row) => row.dataset.key));
  if (!quiet && seen)
    rows.filter((row) => !seen.has(row.dataset.key)).forEach((row) => row.classList.add('fresh'));
  seen = keys;
  const bar = container.querySelector('.topbar span');
  if (bar) bar.textContent = container.querySelector('.page h1')?.textContent ?? '';
}

// The small title on top shows once the large one has scrolled away, like in the phone's own apps.
export function watchScroll() {
  let ticking = false;
  window.addEventListener(
    'scroll',
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        root.classList.toggle('scrolled', window.scrollY > 44);
      });
    },
    { passive: true }
  );
}
