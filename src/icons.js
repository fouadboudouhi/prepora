// Inline line icons, drawn for Prepora in the same family as Volumora's: 24px grid, 1.75px round strokes.
const PATHS = {
  // Tabs
  today:
    '<path d="M3.5 12h17a8.5 8 0 0 1-17 0z"/><path d="M9.5 3.5c-1.2 1.3 1.2 2.7 0 4.5M14.5 3.5c-1.2 1.3 1.2 2.7 0 4.5"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  shop: '<path d="M5.5 8h13l-.9 11a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  chat: '<path d="M12 3.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5z"/><path d="M18.5 15.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5z"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  // Rows under Mehr
  person: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5a7 7 0 0 1 14 0"/>',
  heart: '<path d="M12 20 4.6 12.8a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5z"/>',
  book: '<path d="M5 18V6.5a2 2 0 0 1 2-2h11.5V16H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h11.5"/><path d="M9 8.5h5.5"/>',
  pill: '<rect x="2.6" y="8.5" width="18.8" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.6 4.6 2.4 2 2.4-2M9.6 19.4l2.4-2 2.4 2"/>',
  // Actions
  compose:
    '<path d="M11 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V13"/><path d="M17.6 3.9a1.9 1.9 0 0 1 2.7 2.7L12.5 14.4 9 15l.6-3.5z"/>',
  barcode:
    '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M8 8v8M11 8v8M14 8v8M16.5 8v8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  camera:
    '<path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
};

export const icon = (name) =>
  `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;
