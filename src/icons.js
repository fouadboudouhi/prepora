// Inline line icons, drawn for Prepora in the same family as Volumora's: 24px grid, 1.75px round strokes.
const PATHS = {
  // Tabs
  today:
    '<path d="M3.5 12h17a8.5 8 0 0 1-17 0z"/><path d="M9.5 3.5c-1.2 1.3 1.2 2.7 0 4.5M14.5 3.5c-1.2 1.3 1.2 2.7 0 4.5"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  shop: '<path d="M5.5 8h13l-.9 11a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8z"/><path d="M9 10.5V7a3 3 0 0 1 6 0v3.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  // Rows under Mehr
  person: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5a7 7 0 0 1 14 0"/>',
  heart: '<path d="M12 20 4.6 12.8a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5z"/>',
  book: '<path d="M5 18V6.5a2 2 0 0 1 2-2h11.5V16H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h11.5"/><path d="M9 8.5h5.5"/>',
  pill: '<rect x="2.6" y="8.5" width="18.8" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="m9.5 9.5 5 5"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.6 4.6 2.4 2 2.4-2M9.6 19.4l2.4-2 2.4 2"/>',
  // Actions
  camera:
    '<path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5l1.5 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
};

export const icon = (name) =>
  `<svg class="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;
