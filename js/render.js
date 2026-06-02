import { state, persist } from './state.js';
import { $, toast, ensureShape } from './utils.js';
import { filtered, removeEmptyTemplates, toggleSelection, copyAndCount, toggleFavorite, togglePin, clearSelection } from './templates.js';
import { pushHistory } from './templates.js';
import { openEditor } from './editor.js';
import { disableHotkeys, initHotkeys } from './hotkeys.js';

let sortableTemplates = null;
let performanceMonitorInterval = null;
let fpsHistory = [];
const FPS_SAMPLE_SIZE = 30;
const FPS_CHECK_INTERVAL = 2000; // 2 сек - более быстрая реакция на лаги
const LAG_THRESHOLD = 30; // FPS ниже этого = лаг (сниженный порог)
const RECOVERY_THRESHOLD = 55; // FPS выше этого = восстановление режима

// Кэш для CSS переменных (обновляется при изменении zoom/resize)
let cachedCSSVars = { tileSize: 220, gap: 10, zoomScale: 1 };

function getCSSVars() {
  const root = document.documentElement;
  return {
    tileSize: parseInt(root.style.getPropertyValue('--tile')) || parseInt(getComputedStyle(root).getPropertyValue('--tile')) || 220,
    gap: parseInt(root.style.getPropertyValue('--gap')) || parseInt(getComputedStyle(root).getPropertyValue('--gap')) || 10,
    zoomScale: parseFloat(root.style.getPropertyValue('--zoom-scale')) || parseFloat(getComputedStyle(root).getPropertyValue('--zoom-scale')) || 1
  };
}

export function updateHistoryButtons() {
  const btnUndo = $('btnUndo');
  const btnRedo = $('btnRedo');
  if (btnUndo) btnUndo.disabled = state.historyStack.length === 0;
  if (btnRedo) btnRedo.disabled = state.redoStack.length === 0;
}

export function syncSelectionUI() {
  const selectAllBtn = $('btnSelectAll');
  const deleteBtn = $('btnDeleteSelected');
  const editSelectedBtn = $('btnEditSelected');
  const cancelBtn = $('btnCancelSelection');
  const btnUndo = $('btnUndo');
  const btnRedo = $('btnRedo');
  if (selectAllBtn) selectAllBtn.style.display = state.editMode ? 'inline-flex' : 'none';
  if (deleteBtn) deleteBtn.style.display = (state.editMode && state.selectedTiles.length) ? 'inline-flex' : 'none';
  if (editSelectedBtn) editSelectedBtn.style.display = (state.editMode && state.selectedTiles.length === 1) ? 'inline-flex' : 'none';
  if (cancelBtn) cancelBtn.style.display = (state.editMode && state.selectedTiles.length) ? 'inline-flex' : 'none';
  if (btnUndo) btnUndo.style.display = state.editMode ? 'inline-flex' : 'none';
  if (btnRedo) btnRedo.style.display = state.editMode ? 'inline-flex' : 'none';
  if (btnUndo) btnUndo.disabled = state.historyStack.length === 0;
  if (btnRedo) btnRedo.disabled = state.redoStack.length === 0;
}

function getTemplateTileBaseHeight(template) {
  const textLength = String(template.title || '').trim().length + String(template.text || '').trim().length;
  const extraHeight = Math.min(240, Math.floor(textLength / 120) * 18);
  return Math.max(140, 140 + extraHeight);
}

function getVisibleRange(grid, listLength) {
  const container = grid.parentElement;
  if (!container) return [0, listLength];
  const scrollTop = container.scrollTop;
  const viewportHeight = container.clientHeight;
  const vars = getCSSVars();
  const tileSize = vars.tileSize;
  const gap = vars.gap;
  const zoomScale = vars.zoomScale;
  let tileWidth = tileSize;
  if (state.gridDisplayMode === 'wide') tileWidth = Math.round(tileSize * 1.6);
  let columns = Math.max(1, Math.floor(grid.clientWidth / (tileWidth + gap)));
  if (state.gridDisplayMode === 'text') columns = 1;
  if (columns === 1) {
    const children = Array.from(grid.children);
    let top = 0;
    let start = 0;
    for (let i = 0; i < children.length; i += 1) {
      const height = children[i].clientHeight || Math.round(140 * zoomScale);
      if (top + height + gap > scrollTop) {
        start = i;
        break;
      }
      top += height + gap;
    }
    let end = start;
    const visibleBottom = scrollTop + viewportHeight;
    while (end < children.length && top < visibleBottom) {
      const height = children[end].clientHeight || Math.round(140 * zoomScale);
      top += height + gap;
      end += 1;
    }
    return [Math.max(0, start - 6), Math.min(listLength, end + 6)];
  }
  const rowHeight = Math.round((tileSize * (state.gridDisplayMode === 'wide' ? 1.2 : 1)) + gap);
  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const endRow = Math.min(Math.ceil((scrollTop + viewportHeight) / rowHeight) + 4, Math.ceil(listLength / columns));
  return [startRow * columns, Math.min(listLength, endRow * columns)];
}

export function setDragEnabled(enabled) {
  state.dragEnabled = Boolean(enabled);
  localStorage.setItem('dragLockEnabled', state.dragEnabled ? 'false' : 'true');
  const lockBtn = $('btnLock');
  if (lockBtn) {
    lockBtn.classList.toggle('active', state.dragEnabled);
    lockBtn.setAttribute('aria-pressed', state.dragEnabled ? 'true' : 'false');
  }
  if (!state.dragEnabled && sortableTemplates) {
    try { sortableTemplates.destroy(); } catch (error) { console.warn(error); }
    sortableTemplates = null;
  }
  if (state.dragEnabled) {
    initSortableTemplates();
  }
}

export function initSortableTemplates() {
  const grid = $('grid');
  if (!grid) return;
  if (!state.dragEnabled) {
    if (sortableTemplates) {
      try { sortableTemplates.destroy(); } catch (error) { console.warn(error); }
      sortableTemplates = null;
    }
    return;
  }
  if (!window.Sortable) return;
  
  // Якщо Sortable вже існує - не робимо нічого
  // Перевпорядкування шаблонів вже обробляється через onEnd callback
  if (sortableTemplates) {
    return;
  }
  
  // Першоразова ініціалізація при завантаженні сторінки
  sortableTemplates = Sortable.create(grid, {
    animation: 220,
    easing: 'cubic-bezier(0.22,0.61,0.36,1)',
    draggable: '.tile:not(.pinned)',
    handle: '.tile',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    dragClass: 'sortable-drag',
    dataIdAttr: 'data-id',
    onStart: (evt) => { evt.item.classList.add('dragging'); },
    onEnd: (evt) => {
      evt.item.classList.remove('dragging');
      const ids = Array.from(grid.children).map((child) => child.dataset?.id).filter(Boolean);
      const pinned = state.templates.filter((item) => item.pinned);
      const unpinned = state.templates.filter((item) => !item.pinned);
      const orderedUnpinnedIds = ids.filter((id) => unpinned.some((item) => item.id === id));
      const orderedUnpinned = orderedUnpinnedIds.map((id) => unpinned.find((item) => item.id === id)).filter(Boolean);
      const remainingUnpinned = unpinned.filter((item) => !orderedUnpinnedIds.includes(item.id));
      const newTemplates = [];
      let nextUnpinned = 0;
      state.templates.forEach((item) => {
        if (item.pinned) {
          newTemplates.push(item);
        } else {
          newTemplates.push(orderedUnpinned[nextUnpinned++] || item);
        }
      });
      state.templates = newTemplates;
      pushHistory('Переупорядкування шаблонів');
      persist();
      renderTemplateGrid();
    }
  });
}

export function closeTileContextMenu() {
  const menu = $('tileContextMenu');
  if (!menu) return;
  menu.classList.remove('show');
  menu.setAttribute('aria-hidden', 'true');
  menu.innerHTML = '';
}

export function openTileContextMenu(event, template) {
  event.preventDefault();
  event.stopPropagation();
  closeTileContextMenu();
  const menu = $('tileContextMenu');
  if (!menu) return;
  const favoriteLabel = template.favorite ? 'Видалити з обраного' : 'Додати до обраного';
  const pinLabel = template.pinned ? 'Відкріпити позицію' : 'Закріпити позицію';
  menu.innerHTML = '';
  const addFav = document.createElement('button');
  addFav.type = 'button';
  addFav.textContent = favoriteLabel;
  addFav.onclick = (e) => { e.stopPropagation(); toggleFavorite(template.id); closeTileContextMenu(); renderTemplateGrid(); };
  menu.appendChild(addFav);
  const addPin = document.createElement('button');
  addPin.type = 'button';
  addPin.textContent = pinLabel;
  addPin.onclick = (e) => { e.stopPropagation(); togglePin(template.id); closeTileContextMenu(); renderTemplateGrid(); };
  menu.appendChild(addPin);
  menu.classList.add('show');
  menu.setAttribute('aria-hidden', 'false');
  const x = Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 12);
  const y = Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 12);
  menu.style.left = `${Math.max(12, x)}px`;
  menu.style.top = `${Math.max(12, y)}px`;
}

function buildTile(template, list) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.id = template.id;
  if (state.gridDisplayMode === 'wide' || state.gridDisplayMode === 'text') {
    const baseHeight = getTemplateTileBaseHeight(template);
    tile.style.minHeight = `calc(${baseHeight}px * var(--zoom-scale))`;
  }
  const content = document.createElement('div');
  content.className = 'contentArea';
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (template.image) {
    const img = document.createElement('img');
    img.src = template.image;
    img.alt = template.title || '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('click', (event) => { event.stopPropagation(); copyAndCount(template.id); });
    thumb.appendChild(img);
  } else {
    const span = document.createElement('div');
    span.style.fontSize = '36px';
    span.textContent = template.emoji || (template.title ? template.title.slice(0, 1).toUpperCase() : 'T');
    thumb.appendChild(span);
  }
  const preview = document.createElement('div');
  preview.className = 'previewText';
  preview.textContent = template.text || '';
  content.appendChild(thumb);
  content.appendChild(preview);
  tile.appendChild(content);
  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = template.title || 'Без назви';
  tile.appendChild(title);
  if (template.favorite) {
    const favBadge = document.createElement('div');
    favBadge.className = 'tile-badge favorite';
    favBadge.textContent = '★';
    tile.appendChild(favBadge);
  }
  if (template.pinned) {
    const pinBadge = document.createElement('div');
    pinBadge.className = 'tile-badge pinned';
    pinBadge.textContent = '📌';
    tile.appendChild(pinBadge);
    tile.classList.add('pinned');
  }
  tile.addEventListener('contextmenu', (event) => openTileContextMenu(event, template));
  tile.addEventListener('dblclick', (event) => {
    if (!state.editMode) return;
    event.preventDefault();
    event.stopPropagation();
    openEditor(template.id);
  });
  tile.addEventListener('click', (event) => {
    if (!state.editMode) {
      const selectedText = window.getSelection ? window.getSelection().toString().trim() : '';
      if (state.gridDisplayMode === 'text' && selectedText) return;
      event.preventDefault();
      event.stopPropagation();
      copyAndCount(template.id);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const idx = list.findIndex((item) => item.id === template.id);
    if (event.shiftKey && state.lastSelectedIndex !== null && state.lastSelectedIndex !== undefined) {
      const start = Math.min(state.lastSelectedIndex, idx);
      const end = Math.max(state.lastSelectedIndex, idx);
      for (let i = start; i <= end; i += 1) {
        const id = list[i].id;
        if (!state.selectedTiles.includes(id)) {
          state.selectedTiles.push(id);
          const el = document.querySelector(`.tile[data-id="${id}"]`);
          if (el) el.classList.add('selected');
        }
      }
    } else if (event.ctrlKey || event.metaKey) {
      const selected = toggleSelection(template.id);
      if (selected) tile.classList.add('selected'); else tile.classList.remove('selected');
    } else {
      const selected = toggleSelection(template.id);
      if (selected) tile.classList.add('selected'); else tile.classList.remove('selected');
    }
    state.lastSelectedIndex = idx;
    syncSelectionUI();
  });
  if (state.selectedTiles.includes(template.id)) tile.classList.add('selected');
  return tile;
}

export function renderTemplateGrid() {
  const totalStart = performance.now();
  
  const t1 = performance.now();
  removeEmptyTemplates();
  
  const grid = $('grid');
  if (!grid) return;
  
  const searchQuery = $('search')?.value.trim() || '';
  
  const t2 = performance.now();
  const list = filtered();
  const filterTime = performance.now() - t2;
  
  grid.classList.remove('display-cards', 'display-wide', 'display-text');
  grid.classList.add(`display-${state.gridDisplayMode}`);
  
  // Використовуємо DocumentFragment для батчинга вставок - значно швидше!
  const t3 = performance.now();
  const fragment = document.createDocumentFragment();
  
  if (!list.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'grid-empty-state';
    emptyState.setAttribute('role', 'status');
    emptyState.innerHTML = searchQuery ? `<strong> </strong><br>За запитом «${searchQuery}» не знайдено шаблонів. Спробуйте інший запит або змініть категорію.` : `Список шаблонів порожній. Додайте шаблон, щоб почати роботу.`;
    fragment.appendChild(emptyState);
  } else {
    list.forEach((item, index) => {
      const rendered = buildTile(item, list);
      rendered.dataset.index = String(index);
      const delayMs = document.body.dataset.motion === 'reduced' ? 0 : Math.min(index * 12, 240);
      rendered.style.animationDelay = `${delayMs}ms`;
      fragment.appendChild(rendered);
    });
  }
  
  const t4 = performance.now();
  // Одна вставка замість багаторазових
  grid.innerHTML = '';
  grid.appendChild(fragment);
  grid.setAttribute('role', 'list');
  grid.setAttribute('aria-label', 'Сітка шаблонів');
  grid.setAttribute('aria-live', 'polite');
  
  const gridStatus = $('gridStatus');
  if (gridStatus) {
    const count = list.length;
    const searchText = searchQuery ? `за запитом «${searchQuery}»` : 'за поточним фільтром';
    gridStatus.textContent = count ? `Показано ${count} шаблон${count === 1 ? '' : 'ів'} ${searchText}.` : `Нічого не знайдено ${searchText}.`;
  }
  syncSelectionUI();
  
  // Відкладаємо ініціалізацію Sortable в наступний frame - дозволяє браузеру спочатку відрисувати сітку
  requestAnimationFrame(() => initSortableTemplates());
}

export function updateCategoryButtonStates() {
  document.querySelectorAll('#categoryList .category-btn').forEach((button) => {
    const category = button.dataset.category;
    if (!category) return;
    if (category.startsWith('__group__:')) {
      const groupName = category.slice('__group__:'.length);
      button.classList.toggle('active', state.currentCategory === groupName || state.currentCategory.startsWith(groupName + '/'));
    } else {
      button.classList.toggle('active', state.currentCategory === category);
    }
  });
  const allButton = $('btnCatAll');
  const favButton = $('btnCatFav');
  if (allButton) allButton.classList.toggle('active', state.currentCategory === 'Усі');
  if (favButton) favButton.classList.toggle('active', state.currentCategory === '⭐ Обране');
}

export function renderCategories() {
  const wrap = $('categoryList');
  if (!wrap) return;
  const allCategories = Array.from(new Set(state.templates.map((item) => item.category))).sort((a, b) => a.localeCompare(b, 'uk', { sensitivity: 'base', numeric: true }));
  allCategories.forEach((category) => { if (!state.categoryOrder.includes(category)) state.categoryOrder.push(category); });
  state.categoryOrder = state.categoryOrder.filter((category) => allCategories.includes(category) || category.startsWith('__group__:'));
  const parentOrder = [];
  state.categoryOrder.forEach((category) => {
    const parent = category.startsWith('__group__:') ? category.slice('__group__:'.length) : category.split('/')[0].trim();
    if (parent && !parentOrder.includes(parent)) parentOrder.push(parent);
  });
  allCategories.forEach((category) => {
    const parent = category.split('/')[0].trim();
    if (parent && !parentOrder.includes(parent)) parentOrder.push(parent);
  });
  wrap.innerHTML = '';
  const nestedCategories = {};
  allCategories.forEach((category) => {
    const parts = category.split('/').map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const parent = parts[0];
    const child = parts.slice(1).join('/');
    nestedCategories[parent] = nestedCategories[parent] || { children: new Set(), hasSelf: false };
    if (child) nestedCategories[parent].children.add(child);
    else nestedCategories[parent].hasSelf = true;
  });
  parentOrder.forEach((parent) => {
    const groupInfo = nestedCategories[parent];
    if (!groupInfo) return;
    const children = Array.from(groupInfo.children).sort((a, b) => a.localeCompare(b, 'uk', { sensitivity: 'base', numeric: true }));
    const isOpen = state.openCategories.has(parent) || state.currentCategory.startsWith(parent + '/');
    if (!children.length) {
      const leafGroup = document.createElement('div');
      leafGroup.className = 'category-group leaf-group';
      const leafBtn = document.createElement('button');
      leafBtn.className = `category-btn leaf-btn${parent === state.currentCategory ? ' active' : ''}`;
      leafBtn.textContent = parent;
      leafBtn.dataset.category = parent;
      leafBtn.type = 'button';
      leafBtn.onclick = () => {
        state.openCategories.clear();
        state.currentCategory = parent;
        clearSelection();
        renderTemplateGrid();
        updateCategoryButtonStates();
      };
      leafGroup.appendChild(leafBtn);
      wrap.appendChild(leafGroup);
      return;
    }
    if (isOpen) state.openCategories.add(parent);
    const group = document.createElement('div');
    group.className = `category-group${isOpen ? ' open' : ''}`;
    const parentBtn = document.createElement('button');
    parentBtn.type = 'button';
    parentBtn.className = `category-btn group-toggle${(parent === state.currentCategory || state.currentCategory.startsWith(parent + '/')) ? ' active' : ''}`;
    parentBtn.setAttribute('aria-expanded', String(isOpen));
    parentBtn.setAttribute('aria-pressed', String(parent === state.currentCategory || state.currentCategory.startsWith(parent + '/')));
    parentBtn.textContent = parent;
    parentBtn.dataset.category = `__group__:${parent}`;
    const childWrap = document.createElement('div');
    childWrap.className = 'category-child-wrap';
    if (isOpen) childWrap.style.height = 'auto';
    const childDelay = Math.max(0.008, Math.min(0.03, 0.14 / Math.max(children.length, 1)));
    parentBtn.onclick = () => {
      const wasOpen = group.classList.contains('open');
      if (wasOpen) {
        group.classList.remove('open');
        childWrap.style.height = '0px';
        state.openCategories.delete(parent);
      } else {
        closeAllCategoryGroups(group);
        group.classList.add('open');
        childWrap.style.height = `${childWrap.scrollHeight}px`;
        state.openCategories.clear();
        state.openCategories.add(parent);
      }
      state.currentCategory = parent;
      clearSelection();
      renderTemplateGrid();
      updateCategoryButtonStates();
    };
    group.appendChild(parentBtn);
    children.forEach((child) => {
      const childItem = document.createElement('div');
      childItem.className = 'category-child';
      if (isOpen) {
        childItem.style.opacity = '1';
        childItem.style.transform = 'translateY(0)';
      }
      const childBtn = document.createElement('button');
      const fullName = `${parent}/${child}`;
      childBtn.type = 'button';
      childBtn.className = `category-btn child-btn${fullName === state.currentCategory ? ' active' : ''}`;
      childBtn.setAttribute('aria-pressed', String(fullName === state.currentCategory));
      childBtn.textContent = `• ${child}`;
      childBtn.dataset.category = fullName;
      childBtn.onclick = () => {
        state.openCategories.clear();
        state.openCategories.add(parent);
        state.currentCategory = fullName;
        clearSelection();
        renderTemplateGrid();
        updateCategoryButtonStates();
      };
      childItem.appendChild(childBtn);
      childWrap.appendChild(childItem);
    });
    group.appendChild(childWrap);
    wrap.appendChild(group);
  });
  if (window.Sortable) {
    try { if (window._sortableCats) window._sortableCats.destroy(); } catch (error) { console.warn(error); }
    window._sortableCats = Sortable.create(wrap, {
      animation: 150,
      draggable: '.category-group',
      handle: '.category-btn.group-toggle, .category-btn.leaf-btn',
      onEnd: (evt) => {
        if (evt.oldIndex === evt.newIndex) return;
        const newOrder = Array.from(wrap.querySelectorAll(':scope > .category-group'))
          .map((node) => node.querySelector(':scope > .category-btn.group-toggle, :scope > .category-btn.leaf-btn'))
          .map((btn) => btn?.dataset.category)
          .filter(Boolean);
        state.categoryOrder = newOrder;
        persist();
        renderCategories();
      }
    });
  }
}

function closeAllCategoryGroups(exceptGroup) {
  document.querySelectorAll('#categoryList .category-group.open').forEach((group) => {
    if (group === exceptGroup) return;
    group.classList.remove('open');
    const wrap = group.querySelector('.category-child-wrap');
    if (wrap) wrap.style.height = '0px';
  });
}

export function updateLogo() {
  const logo = $('logo');
  if (!logo) return;
  const isDark = document.body.classList.contains('dark');
  logo.src = isDark ? 'dark_theme.svg' : 'light_theme.svg';
}

export function showSettingsModal() {
  disableHotkeys();
  const modal = $('modalSettings');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  modal.addEventListener('keydown', handleModalKeydown);
  const closeButton = $('btnCloseSettings');
  if (closeButton) closeButton.focus();
}

export function hideSettingsModal() {
  const modal = $('modalSettings');
  if (!modal) return;
  modal.removeEventListener('keydown', handleModalKeydown);
  const activeElement = document.activeElement;
  if (activeElement && modal.contains(activeElement)) {
    activeElement.blur();
    const settingsButton = $('btnSettings');
    if (settingsButton && document.contains(settingsButton)) {
      settingsButton.focus();
    }
  }
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  const btn = $('btnSettings');
  if (btn) btn.classList.remove('active');
  initHotkeys();
}

function handleModalKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    hideSettingsModal();
  }
  if (event.key === 'Tab') {
    const modal = event.currentTarget;
    if (!(modal instanceof HTMLElement)) return;
    const focusables = modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const firstFocusable = focusables[0];
    const lastFocusable = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === firstFocusable) {
      event.preventDefault();
      lastFocusable.focus();
    } else if (!event.shiftKey && document.activeElement === lastFocusable) {
      event.preventDefault();
      firstFocusable.focus();
    }
  }
}

export function applyCloudTemplates(data) {
  if (!Array.isArray(data)) return;
  state.templates = data.map(ensureShape);
  state.categoryOrder = Array.from(new Set(state.templates.map((item) => item.category)));
  if (!state.categoryOrder.length) state.categoryOrder = ['Без категорії'];
  renderCategories();
  renderTemplateGrid();
}

function getCurrentFPS() {
  return new Promise((resolve) => {
    const samples = [];
    let lastTime = performance.now();
    let count = 0;
    function step(now) {
      const delta = now - lastTime;
      lastTime = now;
      if (delta > 0) samples.push(1000 / delta);
      count += 1;
      if (count < 12) requestAnimationFrame(step);
      else resolve(Math.round(samples.reduce((sum, v) => sum + v, 0) / Math.max(samples.length, 1)));
    }
    requestAnimationFrame(step);
  });
}

function startPerformanceMonitoring() {
  // Мониторинг ТОЛЬКО для автоматического режима!
  if (state.motionModePreference !== 'auto') {
    stopPerformanceMonitoring();
    return;
  }
  
  const currentMode = document.body.dataset.motion;
  // Не мониторим режимы reduced/none - нечего улучшать
  if (currentMode === 'reduced' || currentMode === 'none') return;
  if (performanceMonitorInterval) clearInterval(performanceMonitorInterval);
  
  performanceMonitorInterval = setInterval(async () => {
    try {
      // Проверить, что режим все еще AUTO
      if (state.motionModePreference !== 'auto') {
        stopPerformanceMonitoring();
        return;
      }
      
      const currentFps = await getCurrentFPS();
      fpsHistory.push(currentFps);
      if (fpsHistory.length > FPS_SAMPLE_SIZE) fpsHistory.shift();
      
      const avgFps = fpsHistory.reduce((sum, fps) => sum + fps, 0) / fpsHistory.length;
      const mode = document.body.dataset.motion;
      
      // Если лаги - переключиться на более легкий режим НЕМЕДЛЕННО
      if (avgFps < LAG_THRESHOLD && mode !== 'none') {
        const nextMode = mode === 'fast' ? 'normal' : 
                         mode === 'normal' ? 'low' : 
                         mode === 'low' ? 'reduced' : 'reduced';
        console.warn(`⚠️ Лаги (${avgFps.toFixed(0)} FPS) @ CPU 90%+ → режим: ${nextMode}`);
        document.body.dataset.motion = nextMode;
        fpsHistory = [];
      }
      // Если производительность улучшилась - попробовать повысить режим
      else if (avgFps > RECOVERY_THRESHOLD && mode !== 'fast' && fpsHistory.length === FPS_SAMPLE_SIZE) {
        const upgradedMode = mode === 'reduced' ? 'low' : 
                             mode === 'low' ? 'normal' : 
                             mode === 'normal' ? 'fast' : 'fast';
        if (upgradedMode !== mode) {
          console.info(`✅ Восстановление (${avgFps.toFixed(0)} FPS) → режим: ${upgradedMode}`);
          document.body.dataset.motion = upgradedMode;
          fpsHistory = [];
        }
      }
    } catch (error) {
      console.warn('Performance monitoring error:', error);
    }
  }, FPS_CHECK_INTERVAL);
}

export function stopPerformanceMonitoring() {
  if (performanceMonitorInterval) {
    clearInterval(performanceMonitorInterval);
    performanceMonitorInterval = null;
  }
}

export function initMotionMode(isAuto = false) {
  stopPerformanceMonitoring();
  fpsHistory = [];
  
  if (!isAuto && state.motionModePreference !== 'auto') {
    document.body.dataset.motion = state.motionModePreference;
    return;
  }
  
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) {
    document.body.dataset.motion = 'reduced';
    return;
  }
  
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effectiveType = connection?.effectiveType || '';
  const saveData = connection?.saveData;
  const slowNetwork = /(2g|slow-2g)/.test(effectiveType);
  
  // Для критически слабого железа - сразу none (1 ядро ИЛИ ≤2GB)
  if (saveData || slowNetwork || cores === 1 || memory <= 2) {
    document.body.dataset.motion = 'none';
  } else if (cores <= 3 || memory <= 4) {
    // Для очень слабого железа - reduced (2-3 ядра ИЛИ 4GB)
    document.body.dataset.motion = 'reduced';
  } else if (cores >= 8 && memory >= 8) {
    document.body.dataset.motion = 'fast';
  } else if (cores >= 4 && memory >= 4) {
    document.body.dataset.motion = 'normal';
  } else {
    // Средние характеристики - начнём с low
    document.body.dataset.motion = 'low';
  }
  
  // Уточнить по реальному FPS только для fast/normal режимов
  const initialMode = document.body.dataset.motion;
  if (initialMode === 'fast' || initialMode === 'normal') {
    measureFrameRate().then((fps) => {
      if (state.motionModePreference !== 'auto') return;
      if (fps < 28) document.body.dataset.motion = 'reduced';
      else if (fps < 45) document.body.dataset.motion = 'low';
      else if (fps < 70) document.body.dataset.motion = 'normal';
      else document.body.dataset.motion = 'fast';
      
      // Начать мониторинг только для fast/normal режимов
      if (document.body.dataset.motion === 'fast' || document.body.dataset.motion === 'normal') {
        startPerformanceMonitoring();
      }
    }).catch(() => {
      // При ошибке - использовать определенный выше режим
      if (state.motionModePreference === 'auto' && (initialMode === 'fast' || initialMode === 'normal')) {
        startPerformanceMonitoring();
      }
    });
  }
}

export function measureFrameRate() {
  return new Promise((resolve, reject) => {
    if (!window.requestAnimationFrame) return reject(new Error('no raf'));
    const samples = [];
    let lastTime = performance.now();
    let count = 0;
    function step(now) {
      const delta = now - lastTime;
      lastTime = now;
      if (delta > 0) samples.push(1000 / delta);
      count += 1;
      if (count < 20) requestAnimationFrame(step);
      else resolve(Math.round(samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1)));
    }
    requestAnimationFrame(step);
  });
}

window.addEventListener('click', closeTileContextMenu);
window.addEventListener('scroll', closeTileContextMenu, true);
