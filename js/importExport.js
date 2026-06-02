import { state, persist } from './state.js';
import { $, parseTags, sanitizeText, toast } from './utils.js';
import { mergeImportedTemplates } from './templates.js';
import { renderCategories, renderTemplateGrid } from './render.js';
import { disableHotkeys, initHotkeys } from './hotkeys.js';

function resetImportPreview() {
  state.previewRowsData = [];
  state.currentPreviewFormat = '';
  state.currentPreviewSource = null;
  state.currentPreviewMapping = null;
  const previewTable = $('previewTable');
  const previewArea = $('previewArea');
  const previewCount = $('previewCount');
  const mappingWrap = $('mappingControls');
  if (previewTable) previewTable.innerHTML = '';
  if (previewArea) previewArea.style.display = 'none';
  if (previewCount) previewCount.textContent = '0';
  if (mappingWrap) mappingWrap.innerHTML = '';
}

function parseDelimitedText(rawText, isTsv = false) {
  if (!window.Papa) {
    alert('Бібліотека CSV не доступна.');
    return [];
  }
  const result = window.Papa.parse(String(rawText), {
    skipEmptyLines: true,
    dynamicTyping: false,
    delimiter: isTsv ? '\t' : ',',
  });
  if (result.errors && result.errors.length) {
    const filtered = result.errors.filter((error) => error.code !== 'UndetectableDelimiter');
    if (filtered.length) {
      console.warn('CSV parse errors', filtered);
    }
  }
  return result.data || [];
}

export function previewCsvText(rawText, isTsv = false) {
  const rows = parseDelimitedText(rawText, isTsv).slice(0, 200);
  state.previewRowsData = rows;
  state.currentPreviewSource = 'csv';
  state.currentPreviewFormat = isTsv ? 'tsv' : 'csv';
  state.currentPreviewMapping = { title: 0, text: 1, tags: 2, emoji: 3, image: 4, category: 5 };
  showImportPreview(rows, state.currentPreviewFormat);
}

export function refreshImportPreview() {
  if (!state.previewRowsData || !state.previewRowsData.length) return;
  showImportPreview(state.previewRowsData, state.currentPreviewFormat);
}


function findImageNameColumn(headerRow) {
  if (!Array.isArray(headerRow)) return -1;
  for (let i = 0; i < headerRow.length; i += 1) {
    const cell = headerRow[i];
    if (!cell) continue;
    const v = String(cell).toLowerCase();
    if (v.includes('image name') || v.includes('image_name') || v.includes('filename') || v.includes('file name') || v.includes('file_name')) return i;
  }
  return -1;
}

function isHeaderRow(row) {
  if (!Array.isArray(row) || row.length < 3) return false;
  const text = row.join(' ').toLowerCase();
  const headers = ['title', 'text', 'category', 'tags', 'emoji', 'image'];
  return headers.filter((h) => text.includes(h)).length >= 2;
}

function renderPreviewTable(rows) {
  const table = $('previewTable');
  if (!table) return;
  table.innerHTML = '';
  if (!rows || rows.length === 0) return;
  const rowCount = Number($('previewRows')?.value || 10);
  const sample = rows.slice(0, rowCount);
  if (Array.isArray(rows[0])) {
    const cols = Math.max(...rows.map((r) => Array.isArray(r) ? r.length : 0));
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    for (let c = 0; c < cols; c += 1) {
      const th = document.createElement('th');
      th.textContent = 'Col ' + (c + 1);
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    sample.forEach((row) => {
      const tr = document.createElement('tr');
      const dataRow = Array.isArray(row) ? row : [];
      for (let c = 0; c < cols; c += 1) {
        const td = document.createElement('td');
        td.textContent = dataRow[c] !== undefined ? String(dataRow[c]) : '';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  } else {
    const columns = Array.from(new Set(rows.flatMap((item) => Object.keys(item || {}))));
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    columns.forEach((name) => {
      const th = document.createElement('th');
      th.textContent = name;
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    sample.forEach((item) => {
      const tr = document.createElement('tr');
      columns.forEach((name) => {
        const td = document.createElement('td');
        const value = item?.[name];
        td.textContent = Array.isArray(value) ? value.join(', ') : String(value || '');
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }
  const previewCount = $('previewCount');
  if (previewCount) previewCount.textContent = String(Math.min(rowCount, rows.length));
}

function buildMappingControls(cols) {
  const wrap = $('mappingControls');
  if (!wrap) return;
  wrap.innerHTML = '';
  const fields = [
    { key: 'title', label: 'Title' },
    { key: 'category', label: 'Category' },
    { key: 'text', label: 'Text' },
    { key: 'tags', label: 'Tags' },
    { key: 'emoji', label: 'Emoji' },
    { key: 'image', label: 'Image URL' },
  ];
  fields.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'mappingRow';
    const lbl = document.createElement('div');
    lbl.textContent = f.label;
    lbl.style.minWidth = '90px';
    const sel = document.createElement('select');
    sel.className = 'input';
    sel.style.width = '160px';
    const noneOpt = document.createElement('option');
    noneOpt.value = '-1';
    noneOpt.textContent = '— none —';
    sel.appendChild(noneOpt);
    for (let i = 0; i < cols; i += 1) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = 'Col ' + (i + 1);
      sel.appendChild(opt);
    }
    if (state.currentPreviewMapping && typeof state.currentPreviewMapping[f.key] !== 'undefined') {
      sel.value = String(state.currentPreviewMapping[f.key] >= 0 ? state.currentPreviewMapping[f.key] : -1);
    } else {
      sel.value = '-1';
    }
    sel.onchange = () => {
      const value = parseInt(sel.value, 10);
      state.currentPreviewMapping = state.currentPreviewMapping || { category: -1, title: -1, text: -1, tags: -1, emoji: -1, image: -1 };
      state.currentPreviewMapping[f.key] = Number.isNaN(value) ? -1 : value;
    };
    row.appendChild(lbl);
    row.appendChild(sel);
    wrap.appendChild(row);
  });
}

export async function importFile(file) {
  if (!file) return;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    alert('Файл занадто великий. Максимальний розмір: 5 МБ.');
    return;
  }
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    if (!window.XLSX) {
      alert('Бібліотека XLSX не доступна.');
      return;
    }
    const arrayBuffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    state.previewRowsData = rows.slice(0, 200);
    state.currentPreviewSource = 'xlsx';
    state.currentPreviewFormat = 'xlsx';
    state.currentPreviewMapping = { title: 0, text: 1, tags: 2, emoji: 3, image: 4, category: 5 };
    showImportPreview(state.previewRowsData, 'xlsx');
    return;
  }
  const data = await file.text();
  if (file.type.includes('json') || file.name.endsWith('.json')) {
    try {
      const parsed = JSON.parse(data);
      let templates = [];
      let categoryOrder = [];
      
      // Проверяем структуру: может быть как массив, так и объект с templates
      if (Array.isArray(parsed)) {
        templates = parsed;
      } else if (parsed && typeof parsed === 'object' && parsed.templates) {
        templates = Array.isArray(parsed.templates) ? parsed.templates : [];
        categoryOrder = Array.isArray(parsed.categoryOrder) ? parsed.categoryOrder : [];
      } else if (parsed && typeof parsed === 'object') {
        templates = [parsed];
      }
      
      if (!templates.length) {
        alert('JSON файл не містить шаблонів.');
        return;
      }
      
      const merged = mergeImportedTemplates(templates);
      
      // Якщо в файлі був порядок категорій - використовуємо його
      if (categoryOrder.length) {
        state.categoryOrder = categoryOrder;
        persist();
      }
      
      renderCategories();
      renderTemplateGrid();
      toast(`Імпортовано ${merged.added} нових та оновлено ${merged.updated} шаблонів.`);
    } catch (error) {
      console.error('JSON import error:', error);
      alert('Не вдалося прочитати JSON-файл. Перевірте формат файлу.\n\nОшибка: ' + error.message);
    }
    return;
  }
  if (file.type.includes('csv') || file.name.endsWith('.csv') || file.name.endsWith('.tsv')) {
    const isTsv = file.name.endsWith('.tsv');
    importCsvText(data, isTsv);
    return;
  }
  alert('Підтримуються тільки JSON, CSV, TSV або XLSX файли.');
}

export function importCsvText(rawText, isTsv = false) {
  const rows = parseDelimitedText(rawText, isTsv);
  if (!rows.length) return;
  let startIndex = 0;
  const firstRow = (rows[0] || []).map((c) => String(c || '').toLowerCase());
  if (firstRow.some((h) => ['title', 'text', 'tags', 'emoji', 'image', 'category'].includes(h))) startIndex = 1;
  const mapped = [];
  for (let r = startIndex; r < rows.length; r += 1) {
    const row = rows[r] || [];
    const title = String(row[0] || '').trim();
    const text = String(row[1] || '').trim();
    const tagsRaw = String(row[2] || '').trim();
    const emoji = String(row[3] || '').trim();
    const image = String(row[4] || '').trim();
    const category = String(row[5] || '').trim() || 'Без категорії';
    if (!title && !text) continue;
    const tags = tagsRaw ? parseTags(tagsRaw) : [];
    mapped.push({ title, category, text: sanitizeText(text), tags, emoji, image });
  }
  const merged = mergeImportedTemplates(mapped);
  persist();
  renderCategories();
  renderTemplateGrid();
  toast(`Імпортовано ${merged.added} нових та оновлено ${merged.updated} шаблонів.`);
}

export function showImportPreview(items, format = 'json') {
  state.previewRowsData = items;
  state.currentPreviewFormat = format;
  const previewArea = $('previewArea');
  if (previewArea) previewArea.style.display = 'block';
  const rowCount = Number($('previewRows')?.value || 10);
  const rows = Array.isArray(items) ? items : [];
  const previewCount = $('previewCount');
  if (previewCount) previewCount.textContent = String(Math.min(rowCount, rows.length));
  if (Array.isArray(items) && items.length && Array.isArray(items[0])) {
    const cols = Math.max(...items.map((r) => Array.isArray(r) ? r.length : 0));
    buildMappingControls(cols);
  } else {
    const wrap = $('mappingControls');
    if (wrap) wrap.innerHTML = '';
  }
  renderPreviewTable(rows);
}

export function confirmImport() {
  if (!state.previewRowsData || !state.previewRowsData.length) {
    alert('Немає даних для імпорту');
    return;
  }
  let imported = [];
  if (state.currentPreviewFormat === 'csv' || state.currentPreviewFormat === 'tsv' || state.currentPreviewFormat === 'xlsx') {
    const selects = $('mappingControls')?.querySelectorAll('select');
    if (!selects || selects.length === 0) {
      alert('Немає налаштувань мапінгу. Перезавантажте прев’ю.');
      console.warn('confirmImport: no mapping selects');
      return;
    }
    const mapping = {};
    const keys = ['title', 'category', 'text', 'tags', 'emoji', 'image'];
    selects.forEach((sel, i) => {
      const val = parseInt(sel.value, 10);
      mapping[keys[i]] = Number.isNaN(val) ? -1 : val;
    });
    if (mapping.title < 0 && mapping.text < 0) {
      alert('Потрібно вказати колонку для Title або Text');
      return;
    }
    const rows = Array.isArray(state.previewRowsData) ? state.previewRowsData.slice(0, Math.min(state.previewRowsData.length, 1000)) : [];
    const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
    const skipHeader = isHeaderRow(headerRow);
    const imageNameIndex = findImageNameColumn(headerRow);
    for (let r = skipHeader ? 1 : 0; r < rows.length; r += 1) {
      const row = rows[r] || [];
      const title = mapping.title >= 0 ? String(row[mapping.title] || '').trim() : '';
      const category = mapping.category >= 0 ? String(row[mapping.category] || '').trim() : 'Без категорії';
      const text = mapping.text >= 0 ? String(row[mapping.text] || '').trim() : '';
      const tagsRaw = mapping.tags >= 0 ? String(row[mapping.tags] || '').trim() : '';
      const emoji = mapping.emoji >= 0 ? String(row[mapping.emoji] || '').trim() : '';
      const image = mapping.image >= 0 ? String(row[mapping.image] || '').trim() : '';
      const imageName = imageNameIndex >= 0 ? String(row[imageNameIndex] || '').trim() : '';
      if (!title && !text) continue;
      const tags = tagsRaw ? parseTags(tagsRaw) : [];
      imported.push({ title, category: category || 'Без категорії', text: sanitizeText(text), tags, emoji, image, imageName });
    }
  } else if (Array.isArray(state.previewRowsData) && state.previewRowsData.length && typeof state.previewRowsData[0] === 'object') {
    imported = state.previewRowsData.map((item) => ({
      id: `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: item.title || item.name || item['заголовок'] || item['title'] || '',
      category: item.category || item['категорія'] || 'Без категорії',
      text: sanitizeText(item.text || item.body || item['текст'] || ''),
      tags: parseTags(item.tags || item['теги'] || ''),
      emoji: item.emoji || item['emoji'] || '',
      image: item.image || item['image'] || '',
      imageName: item.imageName || item['image name'] || item['image_name'] || '',
      favorite: String(item.favorite) === 'true' || String(item.favorite) === '1',
      pinned: String(item.pinned) === 'true' || String(item.pinned) === '1',
      usage: Number(item.usage) || 0,
      weight: Number(item.weight) || 1,
      createdAt: item.createdAt || Date.now(),
      updatedAt: item.updatedAt || Date.now(),
    }));
  }

  if (!imported.length) {
    alert('Не знайдено рядків для імпорту.');
    return;
  }
  const merged = mergeImportedTemplates(imported);
  persist();
  renderCategories();
  renderTemplateGrid();
  toast(`Імпортовано ${merged.added} нових та оновлено ${merged.updated} шаблонів.`);
  resetImportPreview();
}

export function openImportModal() {
  disableHotkeys();
  const modal = $('modalImport');
  if (!modal) return;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  const closeButton = $('btnImportClose');
  if (closeButton) closeButton.focus();
}

export function closeImportModal() {
  const modal = $('modalImport');
  if (!modal) return;
  const activeElement = document.activeElement;
  if (activeElement && modal.contains(activeElement)) {
    activeElement.blur();
    const importButton = $('btnImportExport');
    if (importButton) {
      importButton.focus();
    }
  }
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  resetImportPreview();
  initHotkeys();
}

export function exportTemplatesAsJson() {
  const data = {
    templates: state.templates,
    categoryOrder: state.categoryOrder,
    exported: new Date().toISOString(),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `snapreply-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast('Експортовано шаблони у JSON.');
}

export function exportTemplatesAsCsv() {
  const headers = ['title', 'text', 'category', 'tags', 'emoji', 'image', 'imageName', 'favorite', 'pinned', 'usage', 'weight'];
  const escapeCSVField = (field) => {
    const value = String(field || '');
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
  const rows = state.templates.map((item) => headers.map((key) => escapeCSVField(item[key] || '')));
  const text = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `snapreply-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast('Експортовано шаблони у CSV.');
}

export function previewFiles(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    alert('Файл занадто великий. Максимальний розмір: 5 МБ.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target?.result;
    if (!text) return;
    if (file.type.includes('json') || file.name.endsWith('.json')) {
      try {
        const parsed = JSON.parse(text);
        let templates = [];
        
        // Проверяем структуру: может быть как массив, так и объект с templates
        if (Array.isArray(parsed)) {
          templates = parsed;
        } else if (parsed && typeof parsed === 'object' && parsed.templates) {
          templates = Array.isArray(parsed.templates) ? parsed.templates : [];
        } else if (parsed && typeof parsed === 'object') {
          templates = [parsed];
        }
        
        if (!templates.length) {
          alert('JSON файл не містить шаблонів.');
          return;
        }
        
        showImportPreview(templates, 'json');
      } catch (error) {
        alert('Не вдалося прочитати JSON-файл.');
        console.error('JSON preview error:', error);
      }
      return;
    }
    if (file.type.includes('csv') || file.name.endsWith('.csv') || file.name.endsWith('.tsv')) {
      const isTsv = file.name.endsWith('.tsv');
      previewCsvText(String(text), isTsv);
      return;
    }
    alert('Підтримуються тільки JSON, CSV та TSV файли.');
  };
  reader.readAsText(file);
}
