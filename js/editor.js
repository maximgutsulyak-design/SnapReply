import { state, persist } from './state.js';
import { $, fileToDataURL, sanitizeText, parseTags, ensureShape } from './utils.js';
import { pushHistory } from './templates.js';
import { disableHotkeys, initHotkeys } from './hotkeys.js';

let pendingEditorImage = '';

export function openEditor(id) {
  pendingEditorImage = '';
  disableHotkeys();
  const titleInput = $('eTitle');
  const textInput = $('eText');
  const categoryInput = $('eCategory');
  const tagsInput = $('eTags');
  const emojiInput = $('eEmoji');
  const imageUrlInput = $('eImageUrl');
  const modal = $('modalEditor');
  if (!titleInput || !textInput || !categoryInput || !tagsInput || !emojiInput || !modal) return;
  let template = state.templates.find((item) => item.id === id);
  if (!template) {
    template = {
      id: `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: '',
      text: '',
      category: state.currentCategory === 'Усі' ? '' : state.currentCategory,
      tags: [],
      emoji: '',
      image: '',
      imageName: '',
      favorite: false,
      pinned: false,
      usage: 0,
      weight: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }
  state.editingId = template.id;
  titleInput.value = template.title || '';
  textInput.value = template.text || '';
  categoryInput.value = template.category || '';
  tagsInput.value = (template.tags || []).join(', ');
  emojiInput.value = template.emoji || '';
  if (imageUrlInput) imageUrlInput.value = template.image || '';
  pendingEditorImage = template.image || '';
  
  // Update character counter
  const updateCharCounter = () => {
    const counter = $('charCounter');
    if (counter) {
      const len = textInput.value.length;
      counter.textContent = `${len} символ${len === 1 ? '' : 'ів'}`;
    }
  };
  updateCharCounter();
  textInput.removeEventListener('input', updateCharCounter);
  textInput.addEventListener('input', updateCharCounter);
  
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  const closeButton = $('btnCloseEditor');
  if (closeButton) closeButton.focus();
}

export function closeEditor() {
  const modal = $('modalEditor');
  if (!modal) return;
  const activeElement = document.activeElement;
  if (activeElement && modal.contains(activeElement)) {
    activeElement.blur();
    const addButton = $('btnAdd');
    if (addButton) {
      addButton.focus();
    }
  }
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  initHotkeys();
}

function getEditorValues() {
  const currentTemplate = state.templates.find((item) => item.id === state.editingId);
  return {
    title: sanitizeText($('eTitle')?.value || ''),
    text: sanitizeText($('eText')?.value || ''),
    category: sanitizeText($('eCategory')?.value || ''),
    tags: parseTags($('eTags')?.value || ''),
    emoji: sanitizeText($('eEmoji')?.value || ''),
    image: pendingEditorImage,
    imageName: currentTemplate?.imageName || '',
  };
}

export async function saveTemplate() {
  const values = getEditorValues();
  if (!values.title && !values.text) {
    alert('Потрібно ввести заголовок або текст шаблону.');
    return false;
  }
  let existing = state.templates.find((item) => item.id === state.editingId);
  if (!existing) {
    existing = {
      id: state.editingId || `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      favorite: false,
      pinned: false,
      usage: 0,
      weight: 1,
      createdAt: Date.now(),
    };
    state.templates.unshift(existing);
  }
  pushHistory('Редагування шаблону');
  existing.title = values.title;
  existing.text = values.text;
  existing.category = values.category || existing.category || 'Без категорії';
  existing.tags = values.tags;
  existing.emoji = values.emoji;
  existing.image = values.image;
  existing.imageName = values.imageName;
  existing.updatedAt = Date.now();
  persist();
  closeEditor();
  return true;
}

export async function attachImageFile(file) {
  if (!file) return null;
  const dataUrl = await fileToDataURL(file);
  pendingEditorImage = dataUrl;
  return dataUrl;
}

export function setPendingEditorImage(value) {
  pendingEditorImage = String(value || '');
}

export function deleteCurrentTemplate() {
  if (!state.editingId) return false;
  const index = state.templates.findIndex((item) => item.id === state.editingId);
  if (index === -1) return false;
  const removed = state.templates.splice(index, 1);
  persist();
  closeEditor();
  return removed.length > 0;
}

export function resetEditorForm() {
  const titleInput = $('eTitle');
  const textInput = $('eText');
  const categoryInput = $('eCategory');
  const tagsInput = $('eTags');
  const emojiInput = $('eEmoji');
  const imageUrlInput = $('eImageUrl');
  if (titleInput) titleInput.value = '';
  if (textInput) textInput.value = '';
  if (categoryInput) categoryInput.value = ''; 
  if (tagsInput) tagsInput.value = '';
  if (emojiInput) emojiInput.value = '';
  if (imageUrlInput) imageUrlInput.value = '';
  pendingEditorImage = '';
  state.editingId = null;
}
