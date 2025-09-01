'use strict';

(function () {
  /** @type {HTMLInputElement} */
  const imagesInput = document.getElementById('images');
  /** @type {HTMLTextAreaElement} */
  const promptInput = document.getElementById('prompt');
  /** @type {HTMLButtonElement} */
  const runBtn = document.getElementById('runBtn');
  /** @type {HTMLButtonElement} */
  const clearBtn = document.getElementById('clearBtn');
  /** @type {HTMLDivElement} */
  const inputPreview = document.getElementById('inputPreview');
  /** @type {HTMLDivElement} */
  const results = document.getElementById('results');
  /** @type {HTMLDivElement} */
  const statusEl = document.getElementById('status');
  /** @type {HTMLDivElement} */
  const lightbox = document.getElementById('lightbox');
  /** @type {HTMLImageElement} */
  const lightboxImg = document.getElementById('lightboxImg');
  /** @type {HTMLDivElement} */
  const lightboxToolbar = document.querySelector('#lightbox .lightbox-toolbar');
  /** @type {HTMLDivElement} */
  const lightboxStage = document.querySelector('#lightbox .lightbox-stage');
  /** @type {HTMLDivElement} */
  const overlay = document.getElementById('overlay');
  /** @type {HTMLDivElement} */
  const runProgress = document.getElementById('runProgress');
  /** @type {HTMLDivElement} */
  const dropzone = document.getElementById('dropzone');
  /** @type {HTMLInputElement} */
  const textOnlyChk = document.getElementById('textOnly');
  /** @type {HTMLSelectElement} */
  const outCountSel = document.getElementById('outCount');
  /** @type {HTMLInputElement} */
  const parallelReqChk = document.getElementById('parallelReq');
  /** @type {HTMLSelectElement} */
  const canvasRatioSel = document.getElementById('canvasRatio');
  /** Saved prompts UI */
  const savePromptBtn = document.getElementById('savePromptBtn');
  const clearPromptsBtn = document.getElementById('clearPromptsBtn');
  const savedList = document.getElementById('savedList');
  /** Settings */
  const apiBaseInput = document.getElementById('apiBase');
  const saveSettingsBtn = document.getElementById('saveSettingsBtn');

  /** @type {File[]} */
  let currentFiles = [];
  /** @type {Set<number>} */
  let selectedIndices = new Set();
  /** @type {number} */
  let lastSelectedIndex = -1;
  
  // Mentions (@imgN) helpers/state
  /** @type {string[]} */ let filePreviewDataUrls = [];
  /** @type {HTMLDivElement|null} */ let mentionMenu = null;
  /** @type {boolean} */ let mentionOpen = false;
  /** @type {number} */ let mentionActiveIndex = 0;
  /** @type {number} */ let mentionTokenStart = -1;
  
  /** Управление сессией для серверного хранения */
  let currentSessionId = localStorage.getItem('currentSessionId') || null;
  
  /** localStorage ключи */
  const LS_LAST_PROMPT_KEY = 'lastPrompt_v1';

  /**
   * Форматирует байты в читаемый размер
   * @param {number} bytes
   */
  function formatSize(bytes) {
    if (!Number.isFinite(bytes)) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0; let s = bytes;
    while (s >= 1024 && i < units.length - 1) { s /= 1024; i += 1; }
    return `${s.toFixed(1)} ${units[i]}`;
  }

  /**
   * Читает File в dataURL
   * @param {File} file
   * @returns {Promise<string>}
   */
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Утилита статуса
   */
  function setStatus(text, kind, details = null) {
    statusEl.innerHTML = ''; // Очищаем содержимое
    statusEl.style.color = kind === 'error' ? '#ff9b9b' : '#a7b0c0';
    
    if (!text) return;
    
    const messageSpan = document.createElement('span');
    messageSpan.textContent = text;
    statusEl.appendChild(messageSpan);
    
    // Если есть детали ошибки, добавляем кнопку для их просмотра
    if (kind === 'error' && details) {
      const detailsBtn = document.createElement('button');
      detailsBtn.type = 'button';
      detailsBtn.textContent = 'Детали';
      detailsBtn.className = 'error-details-btn';
      detailsBtn.style.cssText = `
        margin-left: 8px; 
        padding: 2px 8px; 
        font-size: 11px; 
        background: rgba(255,155,155,0.2); 
        border: 1px solid rgba(255,155,155,0.4); 
        border-radius: 4px; 
        color: #ff9b9b; 
        cursor: pointer;
      `;
      detailsBtn.addEventListener('click', () => showErrorDetails(details));
      statusEl.appendChild(detailsBtn);
    }
  }

  /**
   * Переводит техническую ошибку в понятное сообщение
   */
  function humanizeError(message, details = null) {
    const msg = String(message || '').toLowerCase();
    
    // Таймауты
    if (msg.includes('timeout') || msg.includes('таймаут')) {
      return 'AI модель слишком долго генерирует изображение. Попробуйте:\n• Упростить промпт\n• Уменьшить количество изображений\n• Повторить запрос через минуту';
    }
    
    // Проблемы с API ключом
    if (details && (details.status === 401 || details.status === 403)) {
      return 'Проблема с доступом к API. Проверьте настройки API ключа на сервере';
    }
    
    // Превышение лимитов
    if (details && details.status === 429) {
      return 'Превышен лимит запросов к AI. Подождите несколько минут и попробуйте снова';
    }
    
    // Проблемы с изображением
    if (msg.includes('image') && msg.includes('invalid')) {
      return 'Проблема с загруженным изображением. Попробуйте другой файл (PNG, JPG)';
    }
    
    // Блокировка контента
    if (msg.includes('safety') || msg.includes('policy') || msg.includes('blocked')) {
      return 'AI отказался генерировать изображение. Попробуйте изменить промпт';
    }
    
    // Серверные ошибки
    if (details && details.status >= 500) {
      return 'Временная проблема на сервере AI. Попробуйте через несколько минут';
    }
    
    // Сетевые проблемы
    if (msg.includes('network') || msg.includes('connection') || msg.includes('fetch')) {
      return 'Проблема с подключением к серверу. Проверьте интернет и попробуйте снова';
    }
    
    // Если не удалось определить - возвращаем оригинал с объяснением
    return `${message}\n\nЭто техническая ошибка. Попробуйте:\n• Повторить запрос\n• Изменить промпт\n• Обновить страницу`;
  }

  /**
   * Показывает детали ошибки в alert или консоли
   */
  function showErrorDetails(errorDetails) {
    console.group('🔴 Детали ошибки API:');
    console.error('Статус:', errorDetails.status, errorDetails.statusText);
    if (errorDetails.message) console.error('Сообщение:', errorDetails.message);
    if (errorDetails.serverError) console.error('Ошибка сервера:', errorDetails.serverError);
    if (errorDetails.upstream) console.error('Ошибка провайдера:', errorDetails.upstream);
    if (errorDetails.raw) console.error('Сырой ответ:', errorDetails.raw);
    console.groupEnd();
    
    // Показываем человекопонятное объяснение
    const humanMessage = humanizeError(errorDetails.message, errorDetails);
    alert(humanMessage);
  }

  /**
   * Рендер превью входных изображений
   * @param {File[]} files
   */
  async function renderInputPreview(files) {
    inputPreview.innerHTML = '';
    if (!files || files.length === 0) return;
    const urls = await Promise.all(Array.from(files).map(readFileAsDataURL));
    // Кэшируем превью для меню упоминаний
    filePreviewDataUrls = urls;
    urls.forEach((url, idx) => {
      const file = files[idx];
      const wrapper = document.createElement('div');
      wrapper.className = 'thumb' + (selectedIndices.has(idx) ? ' selected' : '');
      const img = document.createElement('img');
      img.alt = `Вход ${idx + 1}`;
      img.src = url;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'thumb-del';
      del.title = 'Удалить изображение';
      del.innerHTML = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        void removeInputAtWithServer(idx);
      });
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = `${file.name} • ${formatSize(file.size)}`;
      wrapper.addEventListener('click', (e) => handleThumbClick(e, idx));
      wrapper.appendChild(img);
      wrapper.appendChild(del);
      wrapper.appendChild(meta);
      inputPreview.appendChild(wrapper);
    });
  }

  // ===== Mentions (@imgN) =====

  function ensureMentionMenu() {
    if (mentionMenu) return mentionMenu;
    const el = document.createElement('div');
    el.id = 'mentionMenu';
    el.className = 'mention-menu';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    mentionMenu = el;
    return el;
  }

  function positionMentionMenu() {
    if (!mentionOpen || !mentionMenu || !promptInput) return;
    const rect = promptInput.getBoundingClientRect();
    const top = rect.bottom + 6 + window.scrollY;
    const left = rect.left + 12 + window.scrollX;
    mentionMenu.style.top = `${top}px`;
    mentionMenu.style.left = `${left}px`;
    mentionMenu.style.width = `${Math.min(420, rect.width - 24)}px`;
  }

  function closeMentionMenu() {
    if (!mentionMenu) return;
    mentionOpen = false;
    mentionMenu.setAttribute('aria-hidden', 'true');
    mentionMenu.innerHTML = '';
  }

  function buildMentionItems(query) {
    // Порядок как при отправке: если есть выделение — только выделенные (по возрастанию индексов), иначе все
    const indices = (selectedIndices && selectedIndices.size > 0)
      ? Array.from(selectedIndices).sort((a, b) => a - b)
      : Array.from({ length: currentFiles.length }, (_, i) => i);

    const q = String(query || '').toLowerCase();
    const qDigits = q.replace(/[^0-9]/g, '');
    const items = [];

    indices.forEach((origIndex, pos) => {
      const label = `img${pos + 1}`; // imgN соответствует позиции в отправляемом массиве
      // Фильтрация по префиксу 'img' и/или номеру
      if (q) {
        const matchByLabel = label.startsWith(q);
        const matchByNumber = qDigits && String(pos + 1).startsWith(qDigits);
        if (!matchByLabel && !matchByNumber) return;
      }
      const file = currentFiles[origIndex];
      items.push({
        pos,
        origIndex,
        label,
        name: file && file.name ? file.name : `image_${origIndex + 1}`,
        size: file && Number.isFinite(file.size) ? file.size : 0,
        thumb: filePreviewDataUrls[origIndex] || ''
      });
    });

    return items;
  }

  function openMentionMenu(query) {
    if (!currentFiles.length) return closeMentionMenu();
    const menu = ensureMentionMenu();
    const items = buildMentionItems(query);
    menu.innerHTML = '';

    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'mention-item' + (idx === 0 ? ' active' : '');
      row.setAttribute('data-pos', String(it.pos));
      row.setAttribute('data-orig', String(it.origIndex));
      const thumb = document.createElement('img');
      thumb.className = 'mention-thumb';
      if (it.thumb) thumb.src = it.thumb;
      thumb.alt = it.label;
      const textWrap = document.createElement('div');
      textWrap.className = 'mention-text';
      const main = document.createElement('div');
      main.className = 'mention-title';
      main.textContent = it.label;
      const sub = document.createElement('div');
      sub.className = 'mention-sub';
      const sizeText = it.size ? ` • ${formatSize(it.size)}` : '';
      sub.textContent = `${it.name}${sizeText}`;
      textWrap.appendChild(main);
      textWrap.appendChild(sub);
      row.appendChild(thumb);
      row.appendChild(textWrap);
      row.addEventListener('mouseenter', () => {
        const act = menu.querySelector('.mention-item.active');
        if (act) act.classList.remove('active');
        row.classList.add('active');
        mentionActiveIndex = idx;
      });
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        insertMentionAtPos(it.pos);
      });
      menu.appendChild(row);
    });
    mentionActiveIndex = 0;
    mentionOpen = true;
    menu.setAttribute('aria-hidden', 'false');
    positionMentionMenu();
  }

  function findMentionTokenStart(text, caret) {
    // Находим начало токена от '@' до каретки
    for (let i = caret - 1; i >= 0; i -= 1) {
      const ch = text[i];
      if (ch === '@') return i;
      if (/\s/.test(ch)) break;
    }
    return -1;
  }

  function parseMentionQuery(text, caret) {
    const start = findMentionTokenStart(text, caret);
    if (start === -1) return { start: -1, query: '' };
    const raw = text.slice(start + 1, caret);
    return { start, query: raw };
  }

  function handlePromptInputForMentions() {
    const caret = promptInput.selectionStart || 0;
    const text = String(promptInput.value || '');
    const { start, query } = parseMentionQuery(text, caret);
    mentionTokenStart = start;
    if (start !== -1) {
      openMentionMenu(query.trim().toLowerCase());
    } else {
      closeMentionMenu();
    }
  }

  function moveMentionActive(delta) {
    if (!mentionMenu) return;
    const rows = Array.from(mentionMenu.querySelectorAll('.mention-item'));
    if (!rows.length) return;
    const cur = mentionActiveIndex;
    const next = (cur + delta + rows.length) % rows.length;
    rows[cur] && rows[cur].classList.remove('active');
    rows[next] && rows[next].classList.add('active');
    mentionActiveIndex = next;
    // Скроллим к активному
    const el = rows[next];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  function insertMentionAtActive() {
    if (!mentionMenu) return;
    const rows = Array.from(mentionMenu.querySelectorAll('.mention-item'));
    const row = rows[mentionActiveIndex];
    if (!row) return;
    const pos = Number(row.getAttribute('data-pos'));
    insertMentionAtPos(pos);
  }

  function insertMentionAtPos(pos) {
    try {
      const caret = promptInput.selectionStart || 0;
      const text = String(promptInput.value || '');
      if (mentionTokenStart === -1 || mentionTokenStart >= caret) return;
      const before = text.slice(0, mentionTokenStart);
      const after = text.slice(caret);
      // Обеспечиваем строгий мэппинг: если нет выделения — выделяем выбранное изображение
      const hadSelection = selectedIndices && selectedIndices.size > 0;
      const indicesBefore = getSendOrderIndices();
      const origIndex = indicesBefore[pos];
      if (!hadSelection && Number.isFinite(origIndex)) {
        selectedIndices = new Set([origIndex]);
        updateSelectionStyles();
      }
      const indicesAfter = getSendOrderIndices();
      const effectivePos = indicesAfter.indexOf(origIndex);
      const token = `@img${(effectivePos >= 0 ? effectivePos : pos) + 1}`;
      const nextText = `${before}${token} ${after}`;
      promptInput.value = nextText;
      const newCaret = (before + token + ' ').length;
      promptInput.setSelectionRange(newCaret, newCaret);
      closeMentionMenu();
      promptInput.focus();
      // Сохраним промпт
      try { saveLastPrompt(); } catch (_) {}
      // Обновим оверлей превью
      try { renderPromptMentionsOverlay(); } catch (_) {}
    } catch (_) {}
  }

  function handlePromptKeydownForMentions(e) {
    if (!mentionOpen) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); moveMentionActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveMentionActive(-1); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMentionAtActive(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeMentionMenu(); }
  }

  // ===== Prompt mentions overlay (hover previews in textarea) =====
  /** @type {HTMLDivElement|null} */ let promptOverlay = null;
  /** @type {HTMLDivElement|null} */ let promptMirror = null;
  /** @type {HTMLDivElement|null} */ let mentionFloat = null;

  function ensurePromptMentionsInfra() {
    if (!promptOverlay) {
      const ov = document.createElement('div');
      ov.className = 'prompt-mentions-overlay';
      ov.setAttribute('aria-hidden', 'true');
      document.body.appendChild(ov);
      promptOverlay = ov;
    }
    if (!promptMirror) {
      const mir = document.createElement('div');
      mir.className = 'prompt-mentions-mirror';
      mir.setAttribute('aria-hidden', 'true');
      document.body.appendChild(mir);
      promptMirror = mir;
    }
    if (!mentionFloat) {
      const fl = document.createElement('div');
      fl.className = 'mention-preview-float';
      fl.setAttribute('aria-hidden', 'true');
      const img = document.createElement('img');
      fl.appendChild(img);
      document.body.appendChild(fl);
      mentionFloat = fl;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getSendOrderIndices() {
    return (selectedIndices && selectedIndices.size > 0)
      ? Array.from(selectedIndices).sort((a, b) => a - b)
      : Array.from({ length: currentFiles.length }, (_, i) => i);
  }

  function showMentionFloatAt(x, y, pos) {
    if (!mentionFloat) return;
    const indices = getSendOrderIndices();
    const orig = indices[pos];
    const url = filePreviewDataUrls[orig];
    if (!url) return;
    const img = /** @type {HTMLImageElement} */ (mentionFloat.querySelector('img'));
    img.src = url;
    mentionFloat.style.left = `${x + 10}px`;
    mentionFloat.style.top = `${y + 10}px`;
    mentionFloat.setAttribute('aria-hidden', 'false');
  }

  function hideMentionFloat() {
    if (!mentionFloat) return;
    mentionFloat.setAttribute('aria-hidden', 'true');
  }

  function renderPromptMentionsOverlay() {
    if (!promptInput) return;
    ensurePromptMentionsInfra();
    if (!promptOverlay || !promptMirror) return;

    // Position overlay over textarea
    const taRect = promptInput.getBoundingClientRect();
    promptOverlay.style.left = `${taRect.left + window.scrollX}px`;
    promptOverlay.style.top = `${taRect.top + window.scrollY}px`;
    promptOverlay.style.width = `${taRect.width}px`;
    promptOverlay.style.height = `${taRect.height}px`;
    promptOverlay.innerHTML = '';

    // Prepare mirror with same styles
    const cs = window.getComputedStyle(promptInput);
    const mirrorStyle = [
      'position: absolute',
      'visibility: hidden',
      'white-space: pre-wrap',
      'word-wrap: break-word',
      'overflow-wrap: anywhere',
      `font: ${cs.font}`,
      `line-height: ${cs.lineHeight}`,
      `padding: ${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      `border: ${cs.border}`,
      `box-sizing: ${cs.boxSizing}`,
      `width: ${taRect.width}px`,
    ].join(';');
    promptMirror.setAttribute('style', mirrorStyle);
    promptMirror.style.left = `${taRect.left + window.scrollX}px`;
    promptMirror.style.top = `${taRect.top + window.scrollY}px`;

    const text = String(promptInput.value || '');
    const html = escapeHtml(text)
      .replace(/\n/g, '<br>')
      // wrap @imgN tokens
      .replace(/(@img(\d+))/g, '<span class="mention-token" data-pos="$2">$1</span>');
    promptMirror.innerHTML = html;

    const tokens = Array.from(promptMirror.querySelectorAll('.mention-token'));
    if (!tokens.length) {
      promptOverlay.setAttribute('aria-hidden', 'true');
      hideMentionFloat();
      return;
    }

    // Create overlay hit areas for each client rect
    tokens.forEach((tok) => {
      const posNum = Math.max(1, Number(tok.getAttribute('data-pos') || '0')) - 1; // pos -> 0-based
      const rects = tok.getClientRects ? Array.from(tok.getClientRects()) : [];
      rects.forEach((r) => {
        const hit = document.createElement('div');
        hit.className = 'prompt-mention-hit';
        hit.style.left = `${r.left - taRect.left}px`;
        hit.style.top = `${r.top - taRect.top}px`;
        hit.style.width = `${r.width}px`;
        hit.style.height = `${r.height}px`;
        hit.setAttribute('data-pos', String(posNum));
        hit.title = `@img${posNum + 1}`;
        hit.addEventListener('mouseenter', (e) => {
          const bb = /** @type {HTMLElement} */(e.currentTarget).getBoundingClientRect();
          showMentionFloatAt(bb.right + window.scrollX, bb.top + window.scrollY, posNum);
        });
        hit.addEventListener('mouseleave', hideMentionFloat);
        promptOverlay.appendChild(hit);
      });
    });

    promptOverlay.setAttribute('aria-hidden', 'false');
  }

  // Синхронизация оверлея и защита фокуса
  function syncMentionsOverlay() {
    try { renderPromptMentionsOverlay(); } catch (_) {}
  }

  function updateSelectionStyles() {
    const nodes = inputPreview.querySelectorAll('.thumb');
    nodes.forEach((node, i) => {
      if (selectedIndices.has(i)) node.classList.add('selected');
      else node.classList.remove('selected');
    });
  }

  function handleThumbClick(e, idx) {
    const isToggle = e.ctrlKey || e.metaKey;
    const isRange = e.shiftKey && lastSelectedIndex >= 0;
    if (isRange) {
      const [a, b] = lastSelectedIndex < idx ? [lastSelectedIndex, idx] : [idx, lastSelectedIndex];
      selectedIndices = new Set(Array.from({ length: b - a + 1 }, (_, i) => a + i));
    } else if (isToggle) {
      if (selectedIndices.has(idx)) selectedIndices.delete(idx); else selectedIndices.add(idx);
      lastSelectedIndex = idx;
    } else {
      selectedIndices = new Set([idx]);
      lastSelectedIndex = idx;
    }
    updateSelectionStyles();
  }

  // Удаление одного изображения по индексу (клиент+сервер)
  async function removeInputAtWithServer(idx) {
    if (idx < 0 || idx >= currentFiles.length) return;
    const file = currentFiles[idx];
    // Пытаемся удалить с сервера, если есть активная сессия и у файла есть serverName
    try {
      const base = getApiBaseEffective();
      const sessionId = localStorage.getItem('currentSessionId');
      const serverName = file && (file.serverName || file.name) ? String(file.serverName || file.name) : '';
      if (sessionId && serverName) {
        const url = (base ? `${base.replace(/\/$/, '')}` : '') + `/api/session/${sessionId}/file/${encodeURIComponent(serverName)}`;
        await fetch(url, { method: 'DELETE' });
      }
    } catch (e) {
      // Игнорируем ошибки удаления - файл уже удален локально
    }
    currentFiles.splice(idx, 1);
    // Пересчёт выделения
    const next = new Set();
    Array.from(selectedIndices).forEach((i) => {
      if (i < idx) next.add(i);
      else if (i > idx) next.add(i - 1);
    });
    selectedIndices = next;
    if (lastSelectedIndex >= 0) {
      if (lastSelectedIndex > idx) lastSelectedIndex -= 1;
      else if (lastSelectedIndex === idx) lastSelectedIndex = -1;
    }
    void renderInputPreview(currentFiles);
    try { syncMentionsOverlay(); } catch (_) {}
  }

  imagesInput.addEventListener('change', async () => {
    const added = imagesInput.files ? Array.from(imagesInput.files) : [];
    if (!added.length) return;
    const startLen = currentFiles.length;
    currentFiles = currentFiles.concat(added);
    // Если ничего не было выделено — выделим добавленные
    if (selectedIndices.size === 0) {
      for (let i = 0; i < added.length; i += 1) selectedIndices.add(startLen + i);
      lastSelectedIndex = startLen + added.length - 1;
    }
    imagesInput.value = '';
    void renderInputPreview(currentFiles);
    
    // Автосохранение на сервер
    void saveImagesToServer(added);
  });

  // Drag-and-drop
  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }
  if (dropzone) {
    ['dragenter','dragover','dragleave','drop'].forEach((ev) => {
      dropzone.addEventListener(ev, preventDefaults, false);
    });
    ['dragenter','dragover'].forEach((ev) => {
      dropzone.addEventListener(ev, () => dropzone.classList.add('dragover'));
    });
    ['dragleave','drop'].forEach((ev) => {
      dropzone.addEventListener(ev, () => dropzone.classList.remove('dragover'));
    });
    dropzone.addEventListener('drop', async (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const files = Array.from(dt.files).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      currentFiles = currentFiles.concat(files);
      void renderInputPreview(currentFiles);
      
      // Автосохранение на сервер
      void saveImagesToServer(files);
    });
  }

  clearBtn.addEventListener('click', () => {
    imagesInput.value = '';
    inputPreview.innerHTML = '';
    results.innerHTML = '';
    promptInput.value = '';
    setStatus('');
    currentFiles = [];
    selectedIndices = new Set();
    lastSelectedIndex = -1;
    
    // Начинаем новую сессию на сервере
    currentSessionId = null;
    localStorage.removeItem('currentSessionId');
    
    // Очищаем сохраненный промпт
    clearLastPrompt();
  });

  /**
   * Загружает холст по имени файла
   * @param {string} filename
   * @returns {Promise<File>}
   */
  async function loadCanvasFile(filename) {
    const response = await fetch(`./canvas/${filename}`);
    if (!response.ok) throw new Error(`Не удалось загрузить холст: ${filename}`);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type || 'image/png' });
  }

  /**
   * Вызов серверного API /api/edit
   * @param {File[]} files
   * @param {string} prompt
   * @param {boolean} textOnly
   * @param {string} canvasRatio
   */
  async function callEditApi(files, prompt, textOnly, canvasRatio, resultsCount = 1) {
    console.log('🚀 Начинаем API запрос:', { 
      filesCount: files.length, 
      promptLength: prompt.length, 
      textOnly, 
      canvasRatio,
      resultsCount
    });
    
    const form = new FormData();
    let finalPrompt = prompt;
    
    // Добавляем пользовательские изображения
    if (!textOnly) {
      files.forEach((f) => form.append('images', f, f.name));
    }
    
    // Если выбрано разрешение — добавляем холст
    if (canvasRatio) {
      try {
        const canvasFile = await loadCanvasFile(`${canvasRatio}.png`);
        form.append('images', canvasFile, canvasFile.name);
        finalPrompt += 'Aspect ratio should match the attached blank image. The image must completely fill the space. There should be no black bars.';
      } catch (e) {
        console.warn('Не удалось загрузить холст:', e);
      }
    }
    
    // textOnly только если нет ни пользовательских файлов, ни холста
    const hasImages = (!textOnly && files.length > 0) || canvasRatio;
    form.append('textOnly', hasImages ? '0' : '1');
    form.append('prompt', finalPrompt);
    form.append('resultsCount', String(resultsCount)); // Количество результатов для Runware

    const base = getApiBaseEffective();
    const url = (base ? `${base.replace(/\/$/, '')}` : '') + '/api/edit';
    // Увеличиваем таймаут для Runware запросов
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error(`⏰ Клиентский таймаут после 180 секунд`);
      controller.abort();
    }, 180000); // 3 минуты
    
    const startTime = Date.now();
    console.log(`🚀 Отправляем запрос к ${url} с таймаутом 180 сек`);
    
    try {
      const resp = await fetch(url, {
        method: 'POST',
        body: form,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      const elapsed = Date.now() - startTime;
      console.log(`✅ Получен ответ от сервера за ${elapsed}ms`);
    
      if (!resp.ok) {
      let errorInfo = { status: resp.status, statusText: resp.statusText };
      try {
        const text = await resp.text();
        // Попробуем распарсить JSON ошибку от сервера
        try {
          const errorData = JSON.parse(text);
          errorInfo.serverError = errorData;
          errorInfo.message = errorData.error || text;
          if (errorData.upstream) errorInfo.upstream = errorData.upstream;
          if (errorData.raw) errorInfo.raw = errorData.raw;
        } catch (_) {
          errorInfo.message = text || `HTTP ${resp.status}`;
        }
      } catch (_) {
        errorInfo.message = `HTTP ${resp.status} ${resp.statusText}`;
      }
      
      // Логируем детали в консоль для разработчиков
      console.error('API Error:', errorInfo);
      
      const error = new Error(errorInfo.message);
      error.details = errorInfo;
      throw error;
    }
    /** @type {{ results: { mimeType: string, b64: string, filename: string }[] }} */
    const data = await resp.json();
    
    // Логирование для диагностики
    console.log('API Response:', {
      status: resp.status,
      resultsCount: data.results ? data.results.length : 0,
      hasResults: !!(data.results && data.results.length > 0),
      responseData: data
    });
    
    // Проверяем на пустой результат
    const hasResults = data.results && Array.isArray(data.results) && data.results.length > 0;
    if (!hasResults) {
      console.warn('⚠️ API вернул пустой результат:', {
        hasResultsField: !!data.results,
        isResultsArray: Array.isArray(data.results),
        resultsLength: data.results ? data.results.length : 'N/A',
        fullResponse: data
      });
      
      // Детальная диагностика пустого ответа
      const diagnosis = diagnosePoorResponse(data);
      console.error('🔍 Результат диагностики:', diagnosis);
      
      const error = new Error(diagnosis.message);
      error.details = { 
        status: resp.status, 
        diagnosis: diagnosis.reason,
        serverResponse: data,
        message: diagnosis.message
      };
      throw error;
    }
    
    return data.results || [];
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Обрабатываем AbortError (таймаут)
      if (error.name === 'AbortError') {
        console.error('⏰ Запрос отменен по таймауту на клиенте');
        const timeoutError = new Error('Request timeout - генерация заняла слишком много времени');
        timeoutError.details = { timeout: true };
        throw timeoutError;
      }
      
      // Другие ошибки передаем дальше
      throw error;
    }
  }

  function renderResults(items) {
    results.innerHTML = '';
    if (!items || items.length === 0) return;
    /** @type {string[]} */
    const dataUrls = [];
    items.forEach((it, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'thumb';
      const img = document.createElement('img');
      img.alt = `Результат ${idx + 1}`;
      
      // Поддержка как base64 (Gemini/OpenRouter), так и URL (Runware)
      let imageSrc;
      if (it.imageURL) {
        // Runware возвращает готовый URL
        imageSrc = it.imageURL;
      } else if (it.b64) {
        // Gemini/OpenRouter возвращают base64
        imageSrc = `data:${it.mimeType};base64,${it.b64}`;
      } else {
        console.warn('Неизвестный формат изображения:', it);
        return;
      }
      
      dataUrls.push(imageSrc);
      img.src = imageSrc;
      img.style.cursor = 'zoom-in';
      img.addEventListener('click', () => {
        if (!lightbox || !lightboxImg) return;
        openLightboxAt(idx);
      });
      wrapper.appendChild(img);
      results.appendChild(wrapper);
    });

    // сохранить список для навигации
    lightboxImages = dataUrls;
  }

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.setAttribute('aria-hidden', 'true');
    if (lightboxImg) lightboxImg.src = '';
  }
  function openLightboxAt(index) {
    if (!lightbox || !lightboxImg || !lightboxImages.length) return;
    currentIndex = Math.max(0, Math.min(lightboxImages.length - 1, index));
    lightboxImg.src = lightboxImages[currentIndex];
    lightbox.setAttribute('aria-hidden', 'false');
    currentZoom = 1; offsetX = 0; offsetY = 0; applyTransform();
  }
  function showNext(delta) {
    if (!lightboxImages.length) return;
    const next = (currentIndex + delta + lightboxImages.length) % lightboxImages.length;
    openLightboxAt(next);
  }
  if (lightbox) {
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeLightbox();
    });
  }
  window.addEventListener('keydown', (e) => {
    // Не перехватываем стрелки при вводе текста / с модификаторами
    const target = /** @type {HTMLElement} */ (e.target);
    const isEditable = target && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
    );
    if (isEditable || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Escape') closeLightbox();
    // Навигация стрелками только когда лайтбокс открыт
    const isOpen = lightbox && lightbox.getAttribute('aria-hidden') === 'false';
    if (!isOpen) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); showNext(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); showNext(-1); }
  });

  // Loading overlay helpers
  function showOverlay(show) {
    if (!overlay) return;
    overlay.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  // Local progress indicator helpers
  function showRunProgress(show, text = 'Генерация...') {
    if (!runProgress) return;
    runProgress.setAttribute('aria-hidden', show ? 'false' : 'true');
    const textEl = runProgress.querySelector('.progress-text');
    if (textEl && text) textEl.textContent = text;
  }

  /**
   * Анализирует пустой ответ от AI провайдера и определяет причину
   * @param {Object} data - ответ от API
   * @returns {{ reason: string, message: string }}
   */
  function diagnosePoorResponse(data) {
    console.group('🔍 Диагностика пустого ответа:');
    console.log('Полный ответ:', data);
    
    // Проверяем наличие candidates (Gemini)
    if (data.candidates && Array.isArray(data.candidates)) {
      console.log('Candidates:', data.candidates);
      
      for (let i = 0; i < data.candidates.length; i++) {
        const candidate = data.candidates[i];
        console.log(`Candidate ${i}:`, candidate);
        
        // Проверяем finishReason
        if (candidate.finishReason) {
          console.log(`Finish reason: ${candidate.finishReason}`);
          
          switch (candidate.finishReason) {
            case 'SAFETY':
              console.groupEnd();
              return {
                reason: 'SAFETY_BLOCK',
                message: 'Gemini заблокировал генерацию из-за политики безопасности.\nПопробуйте изменить промпт:\n• Уберите потенциально спорные слова\n• Сделайте описание более нейтральным\n• Попробуйте другую формулировку'
              };
              
            case 'RECITATION':
              console.groupEnd();
              return {
                reason: 'RECITATION_BLOCK', 
                message: 'Gemini заблокировал генерацию из-за возможного нарушения авторских прав.\nПопробуйте:\n• Убрать упоминания брендов, персонажей\n• Изменить стиль описания\n• Использовать более общие термины'
              };
              
            case 'MAX_TOKENS':
            case 'STOP':
              console.groupEnd();
              return {
                reason: 'GENERATION_INCOMPLETE',
                message: 'Gemini не завершил генерацию изображения.\nПопробуйте:\n• Упростить промпт\n• Уменьшить количество деталей\n• Повторить запрос'
              };
              
            default:
              console.log(`Неизвестная причина: ${candidate.finishReason}`);
          }
        }
        
        // Проверяем safetyRatings кандидата
        if (candidate.safetyRatings && Array.isArray(candidate.safetyRatings)) {
          const blockedRatings = candidate.safetyRatings.filter(rating => 
            rating.probability === 'HIGH' || rating.probability === 'MEDIUM'
          );
          if (blockedRatings.length > 0) {
            console.log('Заблокированные категории безопасности:', blockedRatings);
            console.groupEnd();
            return {
              reason: 'SAFETY_RATINGS_BLOCK',
              message: `Контент заблокирован фильтрами безопасности (${blockedRatings.map(r => r.category).join(', ')}).\nПопробуйте более безопасный промпт.`
            };
          }
        }
      }
    }
    
    // Проверяем promptFeedback (Gemini)
    if (data.promptFeedback) {
      console.log('Prompt feedback:', data.promptFeedback);
      
      if (data.promptFeedback.blockReason) {
        console.log(`Промпт заблокирован: ${data.promptFeedback.blockReason}`);
        console.groupEnd();
        return {
          reason: 'PROMPT_BLOCKED',
          message: `Промпт заблокирован: ${data.promptFeedback.blockReason}.\nИзмените формулировку запроса.`
        };
      }
      
      if (data.promptFeedback.safetyRatings) {
        const highRiskRatings = data.promptFeedback.safetyRatings.filter(rating =>
          rating.probability === 'HIGH'
        );
        if (highRiskRatings.length > 0) {
          console.log('Высокий риск в промпте:', highRiskRatings);
          console.groupEnd();
          return {
            reason: 'PROMPT_SAFETY_HIGH',
            message: `Промпт содержит потенциально небезопасный контент.\nПопробуйте переформулировать запрос.`
          };
        }
      }
    }
    
    // Проверяем ошибки (общие)
    if (data.error) {
      console.log('API Error:', data.error);
      console.groupEnd();
      return {
        reason: 'API_ERROR',
        message: `Ошибка API: ${data.error.message || 'Неизвестная ошибка'}\nПопробуйте повторить запрос позже.`
      };
    }
    
    // Проверяем пустые candidates без finishReason
    if (data.candidates && data.candidates.length === 0) {
      console.log('Пустой массив candidates');
      console.groupEnd();
      return {
        reason: 'NO_CANDIDATES',
        message: 'Gemini не смог сгенерировать варианты изображения.\nВозможные причины:\n• Перегрузка системы\n• Технические проблемы\n• Попробуйте через несколько минут'
      };
    }
    
    // Проверяем случай когда data.results существует но пустой
    if (data.results && Array.isArray(data.results) && data.results.length === 0) {
      console.log('Поле results существует, но пустое');
      console.groupEnd();
      return {
        reason: 'EMPTY_RESULTS_ARRAY',
        message: 'Сервер вернул пустой список результатов.\nВозможные причины:\n• Временная перегрузка AI модели\n• Промпт не прошел внутренние фильтры\n• Попробуйте изменить промпт или повторить позже'
      };
    }
    
    // Проверяем OpenRouter специфичные ошибки
    if (data.choices && Array.isArray(data.choices)) {
      console.log('OpenRouter response:', data.choices);
      if (data.choices.length === 0) {
        console.groupEnd();
        return {
          reason: 'OPENROUTER_NO_CHOICES',
          message: 'OpenRouter не вернул вариантов ответа.\nВозможно временная проблема сервиса.'
        };
      }
    }
    
    console.log('Не удалось определить причину пустого ответа');
    console.groupEnd();
    
    // Fallback - общая ошибка
    return {
      reason: 'UNKNOWN_EMPTY_RESPONSE',
      message: 'AI не смог создать изображение по неизвестной причине.\nДетали в консоли браузера (F12).\n\nВозможные решения:\n• Изменить промпт\n• Попробовать позже\n• Проверить подключение к интернету'
    };
  }

  // ===== Server image storage =====
  
  /**
   * Сохраняет изображения на сервер
   * @param {File[]} files 
   */
  async function saveImagesToServer(files) {
    if (!files || files.length === 0) return;
    
    try {
      const form = new FormData();
      if (currentSessionId) {
        form.append('sessionId', currentSessionId);
      }
      
      files.forEach((file) => {
        form.append('images', file, file.name);
      });
      
      const base = getApiBaseEffective();
      const url = (base ? `${base.replace(/\/$/, '')}` : '') + '/api/upload';
      const resp = await fetch(url, {
        method: 'POST',
        body: form,
      });
      
      if (resp.ok) {
        const data = await resp.json();
        currentSessionId = data.sessionId;
        localStorage.setItem('currentSessionId', currentSessionId);
        // Присвоим загруженным файлам serverName
        if (Array.isArray(data.files)) {
          let assigned = 0;
          for (let i = currentFiles.length - files.length; i < currentFiles.length; i += 1) {
            const cf = currentFiles[i];
            const info = data.files[assigned];
            if (cf && info) {
              try { Object.defineProperty(cf, 'serverName', { value: info.savedName, enumerable: false, configurable: true }); } catch (_) { cf.serverName = info.savedName; }
              assigned += 1;
            }
          }
        }
        console.log('Images saved to server:', data);
      } else {
        console.warn('Failed to save images to server:', resp.status);
      }
    } catch (e) {
      console.warn('Error saving images to server:', e);
    }
  }

  /**
   * Загружает изображения из серверной сессии
   */
  async function loadImagesFromServer() {
    if (!currentSessionId) return [];
    
    try {
      const base = getApiBaseEffective();
      const url = (base ? `${base.replace(/\/$/, '')}` : '') + `/api/session/${currentSessionId}`;
      const resp = await fetch(url);
      
      if (!resp.ok) {
        if (resp.status === 404) {
          // Сессия не найдена - создаем новую
          currentSessionId = null;
          localStorage.removeItem('currentSessionId');
        }
        return [];
      }
      
      const data = await resp.json();
      const files = [];
      
      for (const fileInfo of data.files) {
        try {
          const fileUrl = (base ? `${base.replace(/\/$/, '')}` : '') + fileInfo.url;
          const fileResp = await fetch(fileUrl);
          if (fileResp.ok) {
            const blob = await fileResp.blob();
            const file = new File([blob], fileInfo.name, { type: fileInfo.mimeType });
            try { Object.defineProperty(file, 'serverName', { value: fileInfo.name, enumerable: false, configurable: true }); } catch (_) { file.serverName = fileInfo.name; }
            files.push(file);
          }
        } catch (e) {
          console.warn('Failed to load file:', fileInfo.name, e);
        }
      }
      
      console.log(`Restored ${files.length} images from server session`);
      return files;
    } catch (e) {
      console.warn('Error loading images from server:', e);
      return [];
    }
  }

  // Zoom & Pan for lightbox
  /** @type {number} */ let currentZoom = 1;
  /** @type {number} */ let offsetX = 0;
  /** @type {number} */ let offsetY = 0;
  /** @type {boolean} */ let isPanning = false;
  /** @type {number} */ let startX = 0;
  /** @type {number} */ let startY = 0;

  function applyTransform() {
    if (!lightboxImg) return;
    lightboxImg.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${currentZoom})`;
    lightboxImg.style.transition = 'transform .06s ease';
  }
  function zoomIn() { currentZoom = Math.min(6, currentZoom * 1.2); applyTransform(); }
  function zoomOut() { currentZoom = Math.max(1, currentZoom / 1.2); if (currentZoom === 1) { offsetX = 0; offsetY = 0; } applyTransform(); }
  function resetZoom() { currentZoom = 1; offsetX = 0; offsetY = 0; applyTransform(); }

  if (lightboxToolbar) {
    lightboxToolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'zoom-in') zoomIn();
      else if (action === 'zoom-out') zoomOut();
      else if (action === 'reset') resetZoom();
      else if (action === 'next') showNext(1);
      else if (action === 'prev') showNext(-1);
      else if (action === 'close') closeLightbox();
    });
  }

  // Side arrows inside stage (prev/next)
  if (lightboxStage) {
    lightboxStage.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'next') showNext(1);
      else if (action === 'prev') showNext(-1);
    });
  }

  /** @type {string[]} */ let lightboxImages = [];
  /** @type {number} */ let currentIndex = 0;
  if (lightboxImg) {
    lightboxImg.addEventListener('mousedown', (e) => {
      if (currentZoom <= 1) return;
      isPanning = true; startX = e.clientX - offsetX; startY = e.clientY - offsetY; lightboxImg.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      offsetX = e.clientX - startX; offsetY = e.clientY - startY; applyTransform();
    });
    window.addEventListener('mouseup', () => { isPanning = false; if (lightboxImg) lightboxImg.style.cursor = 'default'; });
    lightboxImg.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (e.deltaY < 0) zoomIn(); else zoomOut();
    }, { passive: false });

    // Touch gestures: pinch-zoom and pan + swipe nav
    /** @type {number} */ let startDist = 0;
    /** @type {number} */ let pinchStartZoom = 1;
    function dist(t1, t2) { const dx = t1.clientX - t2.clientX; const dy = t1.clientY - t2.clientY; return Math.hypot(dx, dy); }
    /** @type {number} */ let swipeStartX = 0;
    /** @type {number} */ let swipeStartY = 0;
    lightboxImg.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        swipeStartX = e.touches[0].clientX; swipeStartY = e.touches[0].clientY;
        if (currentZoom > 1) { isPanning = true; startX = e.touches[0].clientX - offsetX; startY = e.touches[0].clientY - offsetY; }
      } else if (e.touches.length === 2) {
        e.preventDefault();
        startDist = dist(e.touches[0], e.touches[1]);
        pinchStartZoom = currentZoom;
      }
    }, { passive: false });
    lightboxImg.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && isPanning) {
        offsetX = e.touches[0].clientX - startX; offsetY = e.touches[0].clientY - startY; applyTransform();
      } else if (e.touches.length === 2) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        const scale = d / Math.max(1, startDist);
        currentZoom = Math.min(6, Math.max(1, pinchStartZoom * scale));
        applyTransform();
      }
    }, { passive: false });
    lightboxImg.addEventListener('touchend', (e) => {
      if (!isPanning && e.changedTouches && e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - swipeStartX;
        const dy = e.changedTouches[0].clientY - swipeStartY;
        if (Math.abs(dx) > 40 && Math.abs(dy) < 60) {
          if (dx < 0) showNext(1); else showNext(-1);
        }
      }
      isPanning = false;
    }, { passive: true });
  }

  runBtn.addEventListener('click', async () => {
    try {
      const textOnly = !!(textOnlyChk && textOnlyChk.checked);
      const wantRaw = Number(outCountSel && outCountSel.value ? outCountSel.value : 1);
      const want = Math.max(1, Math.min(4, Number.isFinite(wantRaw) ? wantRaw : 1));
      const runParallel = !!(parallelReqChk && parallelReqChk.checked);
      const canvasRatio = String(canvasRatioSel && canvasRatioSel.value || '').trim();

      let files = [];
      if (!textOnly) {
        if (selectedIndices.size > 0) {
          const indices = Array.from(selectedIndices).sort((a, b) => a - b);
          files = indices.map((i) => currentFiles[i]).filter(Boolean);
        } else {
          files = currentFiles.slice();
        }
      }
      const prompt = String(promptInput.value || '').trim();
      if (!textOnly && files.length === 0) { setStatus('Загрузите хотя бы одно изображение или включите "Только по тексту"', 'error'); return; }
      if (!prompt) { setStatus('Введите текстовый запрос', 'error'); return; }

      runBtn.disabled = true;
      setStatus('Отправляю запрос...'); 
      showRunProgress(true, 'Генерация...');

      let items = [];
      // Для Runware делаем один запрос с нужным количеством результатов  
      console.log(`🚀 Запрашиваем ${want} изображений в одном запросе`);
      items = await callEditApi(files, prompt, textOnly, canvasRatio, want);

      // Проверяем результат перед отображением
      if (items.length === 0) {
        // Если дошли сюда с пустым результатом, значит диагностика не сработала
        setStatus('AI не вернул изображения. Возможные причины:\n• Перегрузка сервиса (попробуйте позже)\n• Контент заблокирован фильтрами\n• Временные проблемы у провайдера\n\nДетали в консоли (F12)', 'error');
        console.warn('⚠️ Получен пустой результат без диагностики. Это не должно происходить.');
      } else {
        setStatus(`Готово: ${items.length} изображение(й)`);
      }
      renderResults(items);
    } catch (e) {
      console.error('Generation error:', e);
      const originalMessage = e && e.message ? e.message : 'Ошибка выполнения';
      const details = e && e.details ? e.details : null;
      
      // Показываем понятное сообщение вместо технического
      const humanMessage = humanizeError(originalMessage, details);
      setStatus(humanMessage, 'error', details);
    } finally {
      runBtn.disabled = false; 
      showRunProgress(false);
    }
  });

  // ===== Saved Prompts (localStorage) =====
  const LS_SETTINGS_KEY = 'settings_v1';
  // Укажи тут базовый адрес API (например, "https://your-service.onrender.com")
  const DEFAULT_API_BASE = '';
  function readApiParam() {
    try {
      const u = new URL(window.location.href);
      const val = u.searchParams.get('api');
      return val ? String(val).trim() : '';
    } catch (_) { return ''; }
  }
  function loadApiBase() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS_KEY);
      if (!raw) return '';
      const obj = JSON.parse(raw);
      return obj && typeof obj.apiBase === 'string' ? obj.apiBase : '';
    } catch (_) { return ''; }
  }
  function saveApiBase(value) {
    const v = String(value || '').trim();
    try { localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify({ apiBase: v })); } catch (_) {}
  }
  function getApiBaseEffective() {
    // Приоритет: ?api= → localStorage → DEFAULT → текущий домен
    const p = readApiParam();
    if (p) { try { saveApiBase(p); } catch (_) {} return p; }
    const stored = loadApiBase();
    if (stored) return stored;
    if (DEFAULT_API_BASE) return DEFAULT_API_BASE;
    return '';
  }
  if (apiBaseInput) {
    const cur = getApiBaseEffective();
    if (cur) apiBaseInput.value = cur;
  }
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', () => {
      const val = apiBaseInput ? apiBaseInput.value : '';
      saveApiBase(val);
      setStatus('Настройки сохранены');
    });
  }

  const LS_KEY = 'saved_prompts_v1';
  /** @returns {string[]} */
  function loadSavedPrompts() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()) : [];
    } catch (_) { return []; }
  }
  /** @param {string[]} arr */
  function saveSavedPrompts(arr) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, 200))); } catch (_) {}
  }
  /** @param {string} value */
  function addSavedPrompt(value) {
    const v = String(value || '').trim();
    if (!v) return;
    const arr = loadSavedPrompts();
    if (arr.includes(v)) return; // не дублируем
    arr.unshift(v);
    saveSavedPrompts(arr);
    renderSavedList();
  }
  /** @param {number} idx */
  function removeSavedPromptAt(idx) {
    const arr = loadSavedPrompts();
    if (idx < 0 || idx >= arr.length) return;
    arr.splice(idx, 1);
    saveSavedPrompts(arr);
    renderSavedList();
  }
  function clearSavedPrompts() {
    saveSavedPrompts([]);
    renderSavedList();
  }
  function renderSavedList() {
    if (!savedList) return;
    const arr = loadSavedPrompts();
    savedList.innerHTML = '';
    if (arr.length === 0) {
      const li = document.createElement('li');
      li.className = 'saved-empty';
      li.textContent = 'Нет сохранённых промптов';
      savedList.appendChild(li);
      return;
    }
    arr.forEach((text, idx) => {
      const li = document.createElement('li');
      li.className = 'saved-item';
      const span = document.createElement('span');
      span.className = 'saved-text';
      span.textContent = text;
      const actions = document.createElement('div');
      actions.className = 'saved-actions';
      const useBtn = document.createElement('button');
      useBtn.type = 'button'; useBtn.className = 'secondary'; useBtn.textContent = 'Вставить';
      useBtn.addEventListener('click', () => { promptInput.value = text; promptInput.focus(); });
      const delBtn = document.createElement('button');
      delBtn.type = 'button'; delBtn.className = 'secondary danger'; delBtn.textContent = 'Удалить';
      delBtn.addEventListener('click', () => removeSavedPromptAt(idx));
      actions.appendChild(useBtn);
      actions.appendChild(delBtn);
      li.appendChild(span);
      li.appendChild(actions);
      savedList.appendChild(li);
    });
  }
  // Bind toolbar
  if (savePromptBtn) {
    savePromptBtn.addEventListener('click', () => addSavedPrompt(promptInput.value));
  }
  if (clearPromptsBtn) {
    clearPromptsBtn.addEventListener('click', () => clearSavedPrompts());
  }
  // Initial render
  renderSavedList();
  
  // ===== Prompt persistence =====
  
  /**
   * Сохраняет текущий промпт в localStorage
   */
  function saveLastPrompt() {
    const prompt = promptInput.value.trim();
    if (prompt) {
      try {
        localStorage.setItem(LS_LAST_PROMPT_KEY, prompt);
      } catch (e) {
        console.warn('Failed to save prompt to localStorage:', e);
      }
    }
  }
  
  /**
   * Загружает последний промпт из localStorage
   */
  function loadLastPrompt() {
    try {
      const saved = localStorage.getItem(LS_LAST_PROMPT_KEY);
      return saved || '';
    } catch (e) {
      console.warn('Failed to load prompt from localStorage:', e);
      return '';
    }
  }
  
  /**
   * Очищает сохраненный промпт
   */
  function clearLastPrompt() {
    try {
      localStorage.removeItem(LS_LAST_PROMPT_KEY);
    } catch (e) {
      console.warn('Failed to clear saved prompt:', e);
    }
  }
  
  // Auto-save prompt as user types
  if (promptInput) {
    // Debounced save - сохраняем не чаще раза в секунду
    let savePromptTimeout = null;
    const debouncedSavePrompt = () => {
      if (savePromptTimeout) clearTimeout(savePromptTimeout);
      savePromptTimeout = setTimeout(() => {
        saveLastPrompt();
      }, 1000);
    };
    
    promptInput.addEventListener('input', debouncedSavePrompt);
    // Mentions: открытие/фильтрация по вводу и клику
    promptInput.addEventListener('input', (e) => { handlePromptInputForMentions(); syncMentionsOverlay(); });
    promptInput.addEventListener('click', (e) => { handlePromptInputForMentions(); syncMentionsOverlay(); });
    promptInput.addEventListener('keydown', handlePromptKeydownForMentions);
    promptInput.addEventListener('blur', () => { closeMentionMenu(); if (promptOverlay) promptOverlay.setAttribute('aria-hidden', 'true'); hideMentionFloat(); });
    promptInput.addEventListener('blur', () => {
      // Сохраняем сразу при потере фокуса
      if (savePromptTimeout) clearTimeout(savePromptTimeout);
      saveLastPrompt();
    });
  }

  // Пере-позиционирование меню при ресайзе/скролле
  window.addEventListener('resize', () => { positionMentionMenu(); syncMentionsOverlay(); });
  window.addEventListener('scroll', () => { positionMentionMenu(); syncMentionsOverlay(); }, true);
  
  // ===== Auto-restore images on page load =====
  (async function initializeApp() {
    try {
      // Восстанавливаем изображения
      const restoredFiles = await loadImagesFromServer();
      if (restoredFiles.length > 0) {
        currentFiles = restoredFiles;
        void renderInputPreview(currentFiles);
      }
      
      // Восстанавливаем промпт
      const savedPrompt = loadLastPrompt();
      if (savedPrompt) {
        promptInput.value = savedPrompt;
      }
      
      // Показываем уведомление о восстановленных данных
      const messages = [];
      if (restoredFiles.length > 0) {
        messages.push(`${restoredFiles.length} изображение(й)`);
      }
      if (savedPrompt) {
        messages.push('промпт');
      }
      
      if (messages.length > 0) {
        setStatus(`✨ Восстановлено: ${messages.join(' и ')}`);
        setTimeout(() => setStatus(''), 3000);
      }
    } catch (e) {
      console.warn('Failed to restore session data:', e);
    }
  })();
})();


