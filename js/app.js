import { state } from './state.js';
import { $, safeOn, toast } from './utils.js';
import { renderCategories, renderTemplateGrid, setDragEnabled, updateLogo, updateCategoryButtonStates, showSettingsModal, hideSettingsModal, initMotionMode, stopPerformanceMonitoring } from './render.js';
import { openEditor, closeEditor, saveTemplate, attachImageFile, deleteCurrentTemplate, resetEditorForm, setPendingEditorImage } from './editor.js';
import { exportTemplatesAsJson, importFile, openImportModal, closeImportModal, previewFiles, confirmImport, importCsvText, previewCsvText, refreshImportPreview } from './importExport.js';
import { initFirebase, loginWithGoogle, handleCloudButton, logoutFirebase, updateAccountUI, saveBackgroundToCloud, loadBackgroundFromCloud, deleteBackgroundFromCloud } from './firebase.js?v=2';
import { initHotkeys, toggleHotkeys } from './hotkeys.js';
import { GRID_MODE_KEY, MOTION_MODE_KEY, UI_TILE_KEY, THEME_KEY } from './constants.js';
import { deleteSelected, selectAllVisible, undoAction, redoAction } from './templates.js';

// IndexedDB для сохранения больших изображений
const DB_NAME = 'SnapReplyDB';
const STORE_NAME = 'backgrounds';

async function getIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function saveToIndexedDB(key, value) {
  try {
    const db = await getIndexedDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  } catch (error) {
    console.warn('IndexedDB save failed:', error);
    return false;
  }
}

async function loadFromIndexedDB(key) {
  try {
    const db = await getIndexedDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  } catch (error) {
    console.warn('IndexedDB load failed:', error);
    return null;
  }
}

async function deleteFromIndexedDB(key) {
  try {
    const db = await getIndexedDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(true);
    });
  } catch (error) {
    console.warn('IndexedDB delete failed:', error);
    return false;
  }
}

function getZoomScale() {
  const stored = localStorage.getItem(UI_TILE_KEY);
  return stored ? Number(stored) : 1;
}

function applyZoom(scale) {
  const clamped = Math.min(1.6, Math.max(0.7, Number(scale) || 1));
  document.documentElement.style.setProperty('--zoom-scale', String(clamped));
  const zoomValue = $('zoomValue');
  if (zoomValue) zoomValue.textContent = `${Math.round(clamped * 100)}%`;
  localStorage.setItem(UI_TILE_KEY, String(clamped));
  renderTemplateGrid();
}

function applyTheme(isDark) {
  const themeButton = $('btnTheme');
  if (isDark) {
    document.body.classList.add('dark');
    document.body.classList.remove('light');
    localStorage.setItem(THEME_KEY, 'dark');
  } else {
    document.body.classList.remove('dark');
    document.body.classList.add('light');
    localStorage.setItem(THEME_KEY, 'light');
  }
  if (themeButton) themeButton.classList.add('active');
  updateLogo();
}

function applySavedTheme() {
  const savedTheme = localStorage.getItem(THEME_KEY) || 'light';
  applyTheme(savedTheme === 'dark');
}

function setGridMode(mode) {
  state.gridDisplayMode = mode;
  localStorage.setItem(GRID_MODE_KEY, mode);
  const gridModeSelect = $('gridMode');
  if (gridModeSelect) gridModeSelect.value = mode;
  renderTemplateGrid();
}

function setMotionMode(mode) {
  state.motionModePreference = mode;
  localStorage.setItem(MOTION_MODE_KEY, mode);
  const animationSelect = $('animationMode');
  if (animationSelect) animationSelect.value = mode;
  
  if (mode === 'auto') {
    initMotionMode();
  } else {
    stopPerformanceMonitoring();
    document.body.dataset.motion = mode;
  }
}

function updateEditModeUI() {
  const editButton = $('btnEditMode');
  if (!editButton) return;
  if (state.editMode) {
    editButton.classList.add('active');
    editButton.textContent = 'Редагування ВКЛ';
  } else {
    editButton.classList.remove('active');
    editButton.textContent = 'Редагування';
    state.selectedTiles = [];
    state.lastSelectedIndex = null;
  }
  renderTemplateGrid();
}

function updateCategorySearchUI() {
  const wrap = $('categorySearchWrap');
  const btn = $('btnCatSearch');
  const sidebarActions = document.querySelector('.sidebar-actions');
  const open = wrap?.classList.contains('open');
  if (btn) {
    btn.classList.toggle('active', open);
    btn.setAttribute('aria-expanded', String(open));
  }
  if (sidebarActions) {
    sidebarActions.classList.toggle('hidden', open);
  }
  const clearCatSearchBtn = $('clearCategorySearch');
  const categorySearchInput = $('categorySearch');
  if (clearCatSearchBtn && categorySearchInput) {
    clearCatSearchBtn.style.display = open && categorySearchInput.value.trim() ? 'inline-flex' : 'none';
  }
}

function closeCategorySearch() {
  const wrap = $('categorySearchWrap');
  if (!wrap) return;
  wrap.classList.remove('open');
  const categorySearch = $('categorySearch');
  if (categorySearch) {
    categorySearch.value = '';
    filterCategoryButtons('');
  }
  updateCategorySearchUI();
}

function openCategorySearch() {
  const wrap = $('categorySearchWrap');
  if (!wrap) return;
  wrap.classList.add('open');
  updateCategorySearchUI();
  $('categorySearch')?.focus();
}

function setCategory(category) {
  closeCategorySearch();
  state.currentCategory = category;
  state.selectedTiles = [];
  state.lastSelectedIndex = null;
  const activeAll = $('btnCatAll');
  const activeFav = $('btnCatFav');
  if (activeAll) activeAll.classList.toggle('active', category === 'Усі');
  if (activeFav) activeFav.classList.toggle('active', category === '⭐ Обране');
  updateCategoryButtonStates();
  renderTemplateGrid();
}

function filterCategoryButtons(query) {
  const q = String(query || '').trim().toLowerCase();
  document.querySelectorAll('#categoryList .category-group').forEach((group) => {
    const parentBtn = group.querySelector('.category-btn');
    const childWrap = group.querySelector('.category-child-wrap');
    const childBtns = childWrap ? Array.from(childWrap.querySelectorAll('.category-btn')) : [];
    const parentMatches = parentBtn && parentBtn.textContent.toLowerCase().includes(q);
    let anyChildMatches = false;
    childBtns.forEach((btn) => {
      const match = q && btn.textContent.toLowerCase().includes(q);
      btn.style.display = q && !match ? 'none' : '';
      if (match) anyChildMatches = true;
    });
    const showGroup = !q || parentMatches || anyChildMatches;
    group.style.display = showGroup ? '' : 'none';
    if (childWrap) {
      group.classList.toggle('open', q && (parentMatches || anyChildMatches));
      childWrap.style.height = q && (parentMatches || anyChildMatches) ? 'auto' : '';
    }
  });
}

function updateSearchControls() {
  const mainSearchWrap = $('mainSearchWrap');
  const searchInput = $('search');
  const clearSearchBtn = $('clearSearch');
  const searchToggleBtn = $('btnSearchToggle');
  const open = mainSearchWrap?.classList.contains('open');
  if (clearSearchBtn) {
    clearSearchBtn.style.display = open && searchInput && searchInput.value.trim() ? 'inline-flex' : 'none';
  }
  if (searchToggleBtn) {
    searchToggleBtn.classList.toggle('active', open);
    searchToggleBtn.setAttribute('aria-expanded', String(open));
  }
}

function updatePreviewRows() {
  refreshImportPreview();
}

// Confirmation dialog functions
let pendingDeleteType = null; // 'batch' or 'single'
let pendingDeleteCount = 0;

function openConfirmDeleteDialog(message, deleteType, count = 0) {
  const modal = $('modalConfirmDelete');
  const msgElement = $('confirmDeleteMsg');
  if (!modal || !msgElement) return;
  
  msgElement.textContent = message;
  pendingDeleteType = deleteType;
  pendingDeleteCount = count;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  
  // Focus on delete button
  const deleteBtn = $('btnConfirmDeleteYes');
  if (deleteBtn) deleteBtn.focus();
}

function closeConfirmDeleteDialog() {
  const modal = $('modalConfirmDelete');
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  pendingDeleteType = null;
  pendingDeleteCount = 0;
}

function initEventListeners() {
  safeOn($('btnAdd'), 'click', () => {
    resetEditorForm();
    openEditor(null);
  });
  safeOn($('btnEditMode'), 'click', () => {
    state.editMode = !state.editMode;
    updateEditModeUI();
  });
  safeOn($('btnSelectAll'), 'click', () => {
    selectAllVisible();
    renderTemplateGrid();
  });
  safeOn($('btnDeleteSelected'), 'click', () => {
    const count = state.selectedTiles.length;
    if (!count) return;
    // Правильна українська граматика: 1 шаблон, 2-4 шаблони, 5+ шаблонів
    const pluralForm = count === 1 ? 'шаблон' : (count % 10 < 5 && count % 10 > 1) ? 'шаблони' : 'шаблонів';
    openConfirmDeleteDialog(
      `Ви впевнені? Будуть видалені ${count} ${pluralForm}. Це можна скасувати.`,
      'batch',
      count
    );
  });
  safeOn($('btnEditSelected'), 'click', () => {
    if (state.selectedTiles.length !== 1) return;
    openEditor(state.selectedTiles[0]);
  });
  safeOn($('btnCancelSelection'), 'click', () => {
    state.selectedTiles = [];
    state.lastSelectedIndex = null;
    renderTemplateGrid();
  });
  safeOn($('btnUndo'), 'click', () => {
    if (undoAction()) renderTemplateGrid();
  });
  safeOn($('btnRedo'), 'click', () => {
    if (redoAction()) renderTemplateGrid();
  });
  safeOn($('btnLock'), 'click', () => {
    setDragEnabled(!state.dragEnabled);
  });
  safeOn($('btnTheme'), 'click', (event) => {
    const btn = event.currentTarget;
    if (btn instanceof HTMLElement) {
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
      ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    }
    applyTheme(!document.body.classList.contains('dark'));
  });
  safeOn($('btnSettings'), 'click', () => showSettingsModal());
  safeOn($('btnCloseSettings'), 'click', () => hideSettingsModal());
  safeOn($('btnImportExport'), 'click', () => openImportModal());
  safeOn($('btnImportClose'), 'click', () => closeImportModal());
  safeOn($('btnLoadFilePreview'), 'click', async () => {
    const fileInput = $('importFile');
    const file = fileInput?.files?.[0];
    if (!file) return alert('Оберіть файл для перегляду.');
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      await importFile(file);
    } else {
      previewFiles({ target: { files: [file] } });
    }
  });
  safeOn($('btnLoadCsvPreview'), 'click', async () => {
    const url = String($('gsCsvLink')?.value || '').trim();
    if (!url) return alert('Введіть посилання на CSV.');
    try {
      const response = await fetch(url);
      const text = await response.text();
      previewCsvText(text, url.endsWith('.tsv'));
    } catch (error) {
      console.warn(error);
      alert('Не вдалося завантажити CSV за посиланням.');
    }
  });
  safeOn($('btnAutoImport'), 'click', async () => {
    const url = String($('gsCsvLink')?.value || '').trim();
    if (!url) return alert('Введіть посилання на CSV.');
    try {
      const response = await fetch(url);
      const text = await response.text();
      importCsvText(text, url.endsWith('.tsv'));
    } catch (error) {
      console.warn(error);
      alert('Не вдалося виконати автоімпорт.');
    }
  });
  safeOn($('btnExportJson'), 'click', () => exportTemplatesAsJson());
  safeOn($('btnConfirmImport'), 'click', () => {
    confirmImport();
  });
  safeOn($('btnCancelPreview'), 'click', () => closeImportModal());
  safeOn($('auth_btn'), 'click', () => loginWithGoogle());
  safeOn($('sync_btn'), 'click', () => handleCloudButton());
  safeOn($('btnGoogleSignOut'), 'click', () => logoutFirebase());
  safeOn($('btnCloseEditor'), 'click', () => {
    closeEditor();
    resetEditorForm();
  });
  safeOn($('eSave'), 'click', async () => {
    const saved = await saveTemplate();
    if (saved) {
      renderCategories();
      renderTemplateGrid();
    }
  });
  safeOn($('eDelete'), 'click', () => {
    openConfirmDeleteDialog(
      'Видалити цей шаблон? Це можна скасувати.',
      'single',
      1
    );
  });
  safeOn($('eImage'), 'change', async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    await attachImageFile(file);
  });
  safeOn($('eImageUrl'), 'change', () => {
    const value = String($('eImageUrl')?.value || '').trim();
    setPendingEditorImage(value);
  });
  safeOn($('search'), 'input', () => {
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(() => {
      renderTemplateGrid();
      updateSearchControls();
    }, 150);
  });
  safeOn($('search'), 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      const mainSearchWrap = $('mainSearchWrap');
      if (mainSearchWrap?.classList.contains('open')) {
        mainSearchWrap.classList.remove('open');
        const searchToggleBtn = $('btnSearchToggle');
        if (searchToggleBtn) searchToggleBtn.setAttribute('aria-expanded', 'false');
        const search = $('search');
        if (search) search.value = '';
        renderTemplateGrid();
        updateSearchControls();
      }
    }
  });
  safeOn($('clearSearch'), 'click', () => {
    const search = $('search');
    if (search) search.value = '';
    const mainSearchWrap = $('mainSearchWrap');
    if (mainSearchWrap) mainSearchWrap.classList.remove('open');
    const searchToggleBtn = $('btnSearchToggle');
    if (searchToggleBtn) searchToggleBtn.setAttribute('aria-expanded', 'false');
    renderTemplateGrid();
    updateSearchControls();
  });
  safeOn($('btnSearchToggle'), 'click', () => {
    const mainSearchWrap = $('mainSearchWrap');
    if (!mainSearchWrap) return;
    const open = mainSearchWrap.classList.toggle('open');
    if (open) {
      $('search')?.focus();
    } else {
      const search = $('search');
      if (search) search.value = '';
      renderTemplateGrid();
    }
    updateSearchControls();
  });
  safeOn($('btnCatSearch'), 'click', () => {
    const wrap = $('categorySearchWrap');
    if (!wrap) return;
    const isOpen = wrap.classList.toggle('open');
    if (isOpen) {
      $('categorySearch')?.focus();
    } else {
      const categorySearch = $('categorySearch');
      if (categorySearch) {
        categorySearch.value = '';
        filterCategoryButtons('');
      }
    }
    updateCategorySearchUI();
  });
  safeOn($('clearCategorySearch'), 'click', () => {
    const categorySearch = $('categorySearch');
    if (categorySearch) categorySearch.value = '';
    filterCategoryButtons('');
    const wrap = $('categorySearchWrap');
    if (wrap) wrap.classList.remove('open');
    updateCategorySearchUI();
  });
  safeOn($('categorySearch'), 'input', (event) => {
    filterCategoryButtons(event.target?.value);
    updateCategorySearchUI();
  });
  safeOn($('categorySearch'), 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      const wrap = $('categorySearchWrap');
      if (wrap?.classList.contains('open')) {
        closeCategorySearch();
      }
    }
  });
  safeOn($('btnCatAll'), 'click', () => setCategory('Усі'));
  safeOn($('btnCatFav'), 'click', () => setCategory('⭐ Обране'));
  safeOn($('zoomRange'), 'input', (event) => {
    const value = event.target?.value;
    if (value !== undefined && value !== null) {
      applyZoom(parseFloat(value));
    }
  });
  safeOn($('gridMode'), 'change', (event) => setGridMode(event.target?.value));
  safeOn($('animationMode'), 'change', (event) => setMotionMode(event.target?.value));
  safeOn($('btnHotkeys'), 'click', () => toggleHotkeys());
  safeOn($('previewRows'), 'change', updatePreviewRows);
  safeOn($('bgApply'), 'click', async () => {
    const file = $('bgFile')?.files?.[0];
    if (!file) return alert('Оберіть файл фону.');
    
    const url = await attachImageFile(file);
    if (!url) {
      $('bgStatus').textContent = 'Помилка при завантаженні файлу';
      return;
    }
    
    const mainArea = $('mainArea');
    if (mainArea) mainArea.style.backgroundImage = `url(${url})`;
    
    // Спробувати зберегти в IndexedDB (для локального сховища)
    try {
      await saveToIndexedDB('backgroundImage', url);
      console.log('✅ Фон збережено в локальному сховищі');
    } catch (error) {
      console.warn('❌ Помилка при збереженні в IndexedDB:', error);
    }
    
    // Якщо користувач авторизований - також зберегти в хмару
    if (window.currentUser) {
      const saved = await saveBackgroundToCloud(url);
      $('bgStatus').textContent = saved ? 'Фон застосовано (локальний + хмура)' : 'Фон застосовано (лише локальний)';
    } else {
      $('bgStatus').textContent = 'Фон застосовано (локальний)';
    }
  });
  safeOn($('bgClear'), 'click', async () => {
    const mainArea = $('mainArea');
    if (mainArea) mainArea.style.backgroundImage = '';
    
    // Удалить из IndexedDB
    await deleteFromIndexedDB('backgroundImage');
    
    // Удалить из хмари если авторизован
    if (window.currentUser) {
      await deleteBackgroundFromCloud();
      $('bgStatus').textContent = 'Фон очищено (локальний + хмура)';
    } else {
      $('bgStatus').textContent = 'Фон очищено';
    }
  });  
  // Confirmation delete dialog handlers
  safeOn($('btnConfirmDeleteYes'), 'click', () => {
    // Сохраняємо значення ДО закриття (closeConfirmDeleteDialog() їх скидає)
    const deleteType = pendingDeleteType;
    const count = pendingDeleteCount;
    
    closeConfirmDeleteDialog();
    
    if (deleteType === 'batch') {
      deleteSelected();
      // Правильна українська граматика: 1 шаблон, 2-4 шаблони, 5+ шаблонів
      const pluralForm = count === 1 ? 'шаблон' : (count % 10 < 5 && count % 10 > 1) ? 'шаблони' : 'шаблонів';
      toast(`Видалено ${count} ${pluralForm}.`);
      renderCategories();
      renderTemplateGrid();
    } else if (deleteType === 'single') {
      if (deleteCurrentTemplate()) {
        renderCategories();
        renderTemplateGrid();
      }
    }
  });
  
  safeOn($('btnConfirmDeleteNo'), 'click', () => {
    closeConfirmDeleteDialog();
  });
  
  // Close dialog on Escape key
  safeOn($('modalConfirmDelete'), 'keydown', (event) => {
    if (event.key === 'Escape') {
      closeConfirmDeleteDialog();
    }
  });}

function initializeFromStorage() {
  applySavedTheme();
  const gridMode = localStorage.getItem(GRID_MODE_KEY) || state.gridDisplayMode;
  const animationMode = localStorage.getItem(MOTION_MODE_KEY) || state.motionModePreference;
  const zoom = getZoomScale();
  const settingsGridMode = $('gridMode');
  const settingsAnimation = $('animationMode');
  const zoomRange = $('zoomRange');
  if (settingsGridMode) settingsGridMode.value = gridMode;
  if (settingsAnimation) settingsAnimation.value = animationMode;
  if (zoomRange) zoomRange.value = String(zoom);
  setGridMode(gridMode);
  setMotionMode(animationMode);
  applyZoom(zoom);
  setDragEnabled(state.dragEnabled);
  
  // Загрузити фон з IndexedDB
  loadFromIndexedDB('backgroundImage').then(savedBg => {
    if (savedBg) {
      const mainArea = $('mainArea');
      if (mainArea) mainArea.style.backgroundImage = `url(${savedBg})`;
    }
  }).catch(error => {
    console.warn('Помилка при завантаженні фону з IndexedDB:', error);
  });
}

async function init() {
  await initFirebase();
  updateAccountUI();
  initEventListeners();
  initHotkeys();
  initializeFromStorage();
  renderCategories();
  setCategory(state.currentCategory);
  updateEditModeUI();
  renderTemplateGrid();
}

window.addEventListener('DOMContentLoaded', init);
