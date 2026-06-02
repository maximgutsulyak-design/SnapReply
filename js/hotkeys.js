import { state } from './state.js';
import { $, toast } from './utils.js';
import { filtered, copyAndCount, selectAllVisible, clearSelection } from './templates.js';
import { renderTemplateGrid } from './render.js';

let hotkeysEnabled = false;

function getCurrentTileIndex() {
  const visible = filtered();
  if (!visible.length) return -1;
  const selected = state.selectedTiles[0];
  if (!selected) return 0;
  return visible.findIndex((item) => item.id === selected);
}

function moveSelection(offset) {
  const visible = filtered();
  if (!visible.length) return;
  const currentIndex = getCurrentTileIndex();
  let next = currentIndex + offset;
  if (next < 0) next = visible.length - 1;
  if (next >= visible.length) next = 0;
  clearSelection();
  state.selectedTiles = [visible[next].id];
  renderTemplateGrid();
  const tile = document.querySelector(`.tile[data-id="${visible[next].id}"]`);
  if (tile && visible[next]) tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function handleKeyDown(event) {
  if (!hotkeysEnabled) return;
  if (event.defaultPrevented) return;
  if (event.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (/^[1-9]$/.test(event.key) || event.key === '0') {
    const visible = filtered();
    const desiredIndex = event.key === '0' ? 9 : Number(event.key) - 1;
    const template = visible[desiredIndex];
    if (template) {
      clearSelection();
      state.selectedTiles = [template.id];
      renderTemplateGrid();
      copyAndCount(template.id);
      setTimeout(() => {
        clearSelection();
        renderTemplateGrid();
      }, 400);
      event.preventDefault();
    }
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'j') {
    moveSelection(1);
    event.preventDefault();
    return;
  }
  if (event.key === 'ArrowUp' || event.key === 'k') {
    moveSelection(-1);
    event.preventDefault();
    return;
  }
  if (event.key === 'c' || event.key === 'Enter') {
    const id = state.selectedTiles[0];
    if (id) {
      copyAndCount(id);
      event.preventDefault();
    }
    return;
  }
  if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
    selectAllVisible();
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape') {
    clearSelection();
    event.preventDefault();
  }
}

export function toggleHotkeys() {
  hotkeysEnabled = !hotkeysEnabled;
  if (hotkeysEnabled) {
    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keydown', handleKeyDown);
  } else {
    window.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('keydown', handleKeyDown);
  }
  const hotkeysButton = $('btnHotkeys');
  if (hotkeysButton) hotkeysButton.classList.toggle('active', hotkeysEnabled);
  const hotkeysInfo = $('hotkeysInfo');
  if (hotkeysInfo) {
    hotkeysInfo.textContent = hotkeysEnabled ? 'Гарячі клавіші увімкнено' : 'Гарячі клавіші вимкнено';
  }
  toast(hotkeysEnabled ? 'Гарячі клавіші увімкнено' : 'Гарячі клавіші вимкнено');
}

export function initHotkeys() {
  if (hotkeysEnabled) return;
  hotkeysEnabled = true;
  window.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('keydown', handleKeyDown);
  const hotkeysButton = $('btnHotkeys');
  if (hotkeysButton) hotkeysButton.classList.add('active');
  const hotkeysInfo = $('hotkeysInfo');
  if (hotkeysInfo) hotkeysInfo.textContent = 'Гарячі клавіші увімкнено';
}

export function disableHotkeys() {
  hotkeysEnabled = false;
  window.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('keydown', handleKeyDown);
}
