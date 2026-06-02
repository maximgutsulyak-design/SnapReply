import { CATEGORY_ORDER_KEY, ACCOUNT_USER_KEY, ACCOUNT_DATA_KEY, GRID_MODE_KEY, MOTION_MODE_KEY, DRAG_LOCK_KEY, STORAGE_KEY } from './constants.js';
import { ensureShape } from './utils.js';

const storedTemplates = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
const defaultTemplates = [
  { id: 's1', title: 'Привітання', category: 'Basic', text: 'Вітаю! Зараз допоможу вам.', tags: ['вітання'], emoji: '💬', favorite: true, usage: 8 },
  { id: 's2', title: 'eSIM QR', category: 'SIM', text: 'Надсилаю QR-код.', tags: ['esim', 'qr'], emoji: '📱', favorite: false, usage: 3 }
];

const initialTemplates = Array.isArray(storedTemplates) ? storedTemplates : defaultTemplates;
const categoryOrder = JSON.parse(localStorage.getItem(CATEGORY_ORDER_KEY) || 'null') || Array.from(new Set(initialTemplates.map((item) => item.category)));

export const state = {
  templates: initialTemplates.map(ensureShape),
  categoryOrder,
  currentCategory: 'Усі',
  editMode: false,
  openCategories: new Set(),
  selectedTiles: [],
  lastSelectedIndex: null,
  editingId: null,
  searchDebounceTimer: null,
  gridDisplayMode: localStorage.getItem(GRID_MODE_KEY) || 'cards',
  motionModePreference: localStorage.getItem(MOTION_MODE_KEY) || 'auto',
  accountUser: JSON.parse(localStorage.getItem(ACCOUNT_USER_KEY) || 'null'),
  accountData: JSON.parse(localStorage.getItem(ACCOUNT_DATA_KEY) || 'null'),
  historyStack: [],
  redoStack: [],
  undoStack: [],
  undoTimer: null,
  previewRowsData: [],
  currentPreviewSource: null,
  currentPreviewFormat: '',
  currentPreviewMapping: null,
  previewFileName: '',
  dragEnabled: localStorage.getItem(DRAG_LOCK_KEY) === null ? true : localStorage.getItem(DRAG_LOCK_KEY) !== 'true'
};

export function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.templates));
  localStorage.setItem(CATEGORY_ORDER_KEY, JSON.stringify(state.categoryOrder));
}

export function getAppSiteContext() {
  const origin = window.location.origin.toLowerCase();
  const path = window.location.pathname.replace(/\/$/, '').toLowerCase();
  if (origin === 'https://maximgutsulyak-design.github.io' && path.startsWith('/snapreply')) {
    return 'snapreply';
  }
  if (origin === 'https://maximgutsulyak-design.github.io' && path.startsWith('/template-platform-v3')) {
    return 'template-platform-v3';
  }
  if (origin.startsWith('http://localhost') || origin.startsWith('https://localhost')) {
    return 'localhost';
  }
  return 'unknown';
}
