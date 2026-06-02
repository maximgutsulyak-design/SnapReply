import { state, persist } from './state.js';
import { $, sanitizeText, parseTags, normalizeCompareText, normalizeSearch, buildSearchVariants, splitWords, fuzzyMatch, levenshtein, ensureShape, toast, isDataUrl } from './utils.js';

function updateExistingTemplate(existing, item) {
  existing.title = item.title;
  existing.text = item.text;
  existing.category = item.category || existing.category || 'Без категорії';
  existing.tags = item.tags || [];
  existing.emoji = item.emoji || '';
  const incomingImage = String(item.image || '').trim();
  if (incomingImage) {
    if (isDataUrl(incomingImage) && existing.image && !isDataUrl(existing.image)) {
      // preserve existing remote icon path when incoming image is large data URL
    } else {
      existing.image = incomingImage;
    }
  }
  const incomingImageName = String(item.imageName || '').trim();
  if (incomingImageName) {
    existing.imageName = incomingImageName;
  }
  existing.updatedAt = Date.now();
}

export function mergeImportedTemplates(items) {
  let added = 0;
  let updated = 0;
  items.forEach((item) => {
    const shaped = ensureShape(item);
    if (!shaped.title && !shaped.text) return;
    const exact = state.templates.find((existing) => normalizeCompareText(existing.title) === normalizeCompareText(shaped.title) && normalizeCompareText(existing.text) === normalizeCompareText(shaped.text));
    if (exact) {
      updateExistingTemplate(exact, shaped);
      if (shaped.category && !state.categoryOrder.includes(shaped.category)) state.categoryOrder.push(shaped.category);
      updated += 1;
      return;
    }
    const match = state.templates.find((existing) => normalizeCompareText(existing.title) === normalizeCompareText(shaped.title) || normalizeCompareText(existing.text) === normalizeCompareText(shaped.text));
    if (match) {
      updateExistingTemplate(match, shaped);
      if (shaped.category && !state.categoryOrder.includes(shaped.category)) state.categoryOrder.push(shaped.category);
      updated += 1;
      return;
    }
    state.templates.push(shaped);
    if (shaped.category && !state.categoryOrder.includes(shaped.category)) state.categoryOrder.push(shaped.category);
    added += 1;
  });
  pushHistory(`Імпорт: ${added} нових, ${updated} оновлено`);
  persist();
  return { added, updated, skipped: 0 };
}

export function removeEmptyTemplates() {
  const before = state.templates.length;
  state.templates = state.templates.filter((item) => (item.title && item.title.trim()) || (item.text && item.text.trim()));
  if (state.templates.length !== before) {
    persist();
  }
}

export function categoryFilter(item) {
  if (state.currentCategory === 'Усі') return true;
  if (state.currentCategory === '⭐ Обране') return item.favorite;
  if (state.currentCategory.includes('/')) return item.category === state.currentCategory;
  return item.category === state.currentCategory || item.category.startsWith(state.currentCategory + '/');
}

export function scoreItem(item, query) {
  if (!query) return 0;
  const title = normalizeSearch(item.title || '');
  const text = normalizeSearch([item.title, item.text, (item.tags || []).join(' '), item.category, item.emoji].filter(Boolean).join(' '));
  const tags = normalizeSearch((item.tags || []).join(' '));
  const category = normalizeSearch(item.category || '');
  const emoji = normalizeSearch(item.emoji || '');
  let score = 0;
  if (text.includes(query)) score += 30;
  if (title.includes(query)) score += 25;
  if (tags.includes(query)) score += 12;
  if (category.includes(query)) score += 10;
  if (emoji.includes(query)) score += 8;
  const words = splitWords(query);
  words.forEach((word) => {
    if (!word) return;
    if (title.includes(word)) score += 18;
    else if (fuzzyMatch(title, word)) score += 10;
    if (tags.includes(word)) score += 12;
    else if (fuzzyMatch(tags, word)) score += 4;
    if (category.includes(word)) score += 8;
    else if (fuzzyMatch(category, word)) score += 3;
    if (emoji.includes(word)) score += 6;
    if (text.includes(word)) score += 12;
    else if (fuzzyMatch(text, word)) score += 4;
  });
  if (item.pinned) score *= 1.15;
  return score * (item.weight || 1);
}

export function hasPreciseMatch(item, variants) {
  const title = normalizeSearch(item.title || '');
  const tags = normalizeSearch((item.tags || []).join(' '));
  const emoji = normalizeSearch(item.emoji || '');
  const words = Array.from(new Set(variants.flatMap((variant) => splitWords(variant))));
  for (const variant of variants) {
    if (!variant) continue;
    if (title.includes(variant) || tags.includes(variant) || emoji.includes(variant)) return true;
  }
  for (const word of words) {
    if (word.length < 2) continue;
    if (title.includes(word) || tags.includes(word) || emoji.includes(word)) return true;
  }
  return false;
}

export function filtered() {
  const rawQuery = $('search')?.value || '';
  const query = rawQuery.trim();
  const hasSearch = query.length > 0;
  const list = hasSearch ? state.templates : state.templates.filter(categoryFilter);
  if (!query) return list;
  const variants = buildSearchVariants(query);
  if (!variants.length) return list;
  const minScore = Math.max(12, Math.min(40, query.length * 5));
  const scored = list
    .map((item) => ({ item, score: variants.reduce((sum, variant) => sum + scoreItem(item, variant), 0) }))
    .filter((result) => result.score >= minScore)
    .sort((a, b) => b.score - a.score);
  if (scored.length > 28) {
    const precise = scored.filter((result) => hasPreciseMatch(result.item, variants)).map((result) => result.item);
    if (precise.length) return precise;
  }
  return scored.map((result) => result.item);
}

export function toggleSelection(id) {
  const index = state.selectedTiles.indexOf(id);
  if (index === -1) {
    state.selectedTiles.push(id);
    return true;
  }
  state.selectedTiles.splice(index, 1);
  return false;
}

export function clearSelection() {
  state.selectedTiles = [];
  state.lastSelectedIndex = null;
}

export function selectAllVisible() {
  const list = filtered();
  state.selectedTiles = list.map((item) => item.id);
  return state.selectedTiles.length;
}

export function pushHistory(actionLabel = 'Зміни') {
  state.redoStack = [];
  if (state.historyStack.length >= 40) state.historyStack.shift();
  state.historyStack.push({
    templates: JSON.parse(JSON.stringify(state.templates)),
    categoryOrder: [...state.categoryOrder],
    label: actionLabel
  });
}

export function undoAction() {
  if (!state.historyStack.length) return false;
  const currentState = { templates: JSON.parse(JSON.stringify(state.templates)), categoryOrder: [...state.categoryOrder] };
  state.redoStack.push(currentState);
  const previous = state.historyStack.pop();
  state.templates = previous.templates.map(ensureShape);
  state.categoryOrder = [...previous.categoryOrder];
  persist();
  return true;
}

export function redoAction() {
  if (!state.redoStack.length) return false;
  const nextState = state.redoStack.pop();
  state.historyStack.push({ templates: JSON.parse(JSON.stringify(state.templates)), categoryOrder: [...state.categoryOrder], label: 'Повтор' });
  state.templates = nextState.templates.map(ensureShape);
  state.categoryOrder = [...nextState.categoryOrder];
  persist();
  return true;
}

export function deleteSelected() {
  if (!state.selectedTiles.length) return 0;
  pushHistory('Видалення шаблонів');
  const removed = state.templates.filter((item) => state.selectedTiles.includes(item.id));
  state.templates = state.templates.filter((item) => !state.selectedTiles.includes(item.id));
  state.undoStack = removed.slice();
  clearSelection();
  persist();
  return removed.length;
}

export function startUndoTimer(onExpire) {
  if (state.undoTimer) clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(() => {
    state.undoStack = [];
    state.undoTimer = null;
    if (typeof onExpire === 'function') onExpire();
  }, 9000);
}

export function undoDelete() {
  if (!state.undoStack.length) return 0;
  const restored = state.undoStack.map(ensureShape);
  state.templates = [...restored, ...state.templates];
  state.undoStack = [];
  if (state.undoTimer) clearTimeout(state.undoTimer);
  state.undoTimer = null;
  persist();
  return restored.length;
}

export function copyAndCount(id, silent = false) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;
  const textToCopy = template.text || '';
  const writeText = () => {
    template.usage = (template.usage || 0) + 1;
    persist();
    const tile = document.querySelector(`.tile[data-id="${id}"]`);
    if (tile) {
      tile.classList.add('just-copied');
      setTimeout(() => tile.classList.remove('just-copied'), 320);
    }
    if (!silent) toast(`Скопійовано: «${template.title}»`);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(writeText).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      writeText();
    });
    return;
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = textToCopy;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    writeText();
  } catch (error) {
    alert('Не вдалося скопіювати текст у буфер обміну.');
  }
}

export function toggleFavorite(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return false;
  template.favorite = !template.favorite;
  persist();
  return true;
}

export function togglePin(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return false;
  template.pinned = !template.pinned;
  persist();
  return true;
}

export function updateExistingTemplateFields(existing, item) {
  updateExistingTemplate(existing, item);
}
