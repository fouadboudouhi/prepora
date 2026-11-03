// Everything the app remembers, under names of its own: Volumora lives on the same domain.
const PREFIX = 'prepora-';
const listeners = new Set();

export const read = (name, fallback) => {
  try {
    const text = localStorage.getItem(PREFIX + name);
    return text === null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
};

// Quiet writes come from the server copy and must not start another upload.
export function write(name, value, { quiet = false } = {}) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(PREFIX + name);
    else localStorage.setItem(PREFIX + name, JSON.stringify(value));
  } catch {
    // A full storage shows up as a value that is not kept; the next change tries again.
  }
  if (!quiet) listeners.forEach((listener) => listener(name));
}

export const onChange = (listener) => listeners.add(listener);
