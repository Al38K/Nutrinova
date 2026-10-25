// Icônes SVG maison (trait 1,8 px, grille 24×24), colorées via currentColor.

const wrap = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  journal: wrap('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  foods: wrap('<path d="M12 7.5c-2-1.6-6.2-1.4-7 2.2-.8 3.7 1.4 9.3 4.3 10.1 1 .3 1.9 0 2.7-.4.8.4 1.7.7 2.7.4 2.9-.8 5.1-6.4 4.3-10.1-.8-3.6-5-3.8-7-2.2z"/><path d="M12 7.5c0-2 .9-3.6 3-4.5"/>'),
  recipes: wrap('<path d="M4 11h16v4.5A4.5 4.5 0 0 1 15.5 20h-7A4.5 4.5 0 0 1 4 15.5z"/><path d="M2.5 11h19"/><path d="M9 7.5c0-1 1-1.4 1-2.5M14 7.5c0-1 1-1.4 1-2.5"/>'),
  weight: wrap('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><path d="M8.3 10a5 5 0 0 1 7.4 0"/><path d="M12 10.2l1.4-2.2"/>'),
  settings: wrap('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  chevronRight: wrap('<path d="M9 5l7 7-7 7"/>', 'stroke-width="2.4"'),
  chevronLeft: wrap('<path d="M15 5l-7 7 7 7"/>', 'stroke-width="2.4"'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.2"'),
  close: wrap('<path d="M6 6l12 12M18 6L6 18"/>', 'stroke-width="2.2"'),
  check: wrap('<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16.2 9.5"/>'),
  cross: wrap('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  info: wrap('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.01" stroke-width="2.6"/>'),
  warning: wrap('<path d="M10.3 4.3L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5"/><path d="M12 17.2v.01" stroke-width="2.6"/>'),
  share: wrap('<path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5v9h14v-9h-1"/>'),
  addSquare: wrap('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>'),
  palette: wrap('<path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.1-.9-1.5-.9-2.5 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7.3" r="1.2"/><circle cx="15" cy="7.8" r="1.2"/>'),
  database: wrap('<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'),
  shield: wrap('<path d="M12 3l7 3v5.5c0 4.4-3 7.8-7 9.5-4-1.7-7-5.1-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>'),
  sparkle: wrap('<path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z"/>'),
  target: wrap('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/>'),
  calendar: wrap('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  trash: wrap('<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6 7l1 12.3A1.9 1.9 0 0 0 8.9 21h6.2a1.9 1.9 0 0 0 1.9-1.7L18 7"/><path d="M10 11v6M14 11v6"/>'),
  download: wrap('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  upload: wrap('<path d="M12 15V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M5 19.5h14"/>'),
  chart: wrap('<path d="M5 20V11M11 20V5M17 20v-7M3 20h18"/>'),
  refresh: wrap('<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>')
};

export function icon(name) {
  return ICONS[name] || '';
}
