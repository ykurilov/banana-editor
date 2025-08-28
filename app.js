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
  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.style.color = kind === 'error' ? '#ff9b9b' : '#a7b0c0';
  }

  /**
   * Рендер превью входных изображений
   * @param {File[]} files
   */
  async function renderInputPreview(files) {
    inputPreview.innerHTML = '';
    if (!files || files.length === 0) return;
    const urls = await Promise.all(Array.from(files).map(readFileAsDataURL));
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
        removeInputAt(idx);
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

  // Удаление одного изображения по индексу
  function removeInputAt(idx) {
    if (idx < 0 || idx >= currentFiles.length) return;
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
  }

  imagesInput.addEventListener('change', () => {
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
    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (!dt) return;
      const files = Array.from(dt.files).filter((f) => f.type.startsWith('image/'));
      if (files.length === 0) return;
      currentFiles = currentFiles.concat(files);
      void renderInputPreview(currentFiles);
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
  async function callEditApi(files, prompt, textOnly, canvasRatio) {
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
        finalPrompt += ' Размер и соотношение как у приложенного пустого изображения.';
      } catch (e) {
        console.warn('Не удалось загрузить холст:', e);
      }
    }
    
    // textOnly только если нет ни пользовательских файлов, ни холста
    const hasImages = (!textOnly && files.length > 0) || canvasRatio;
    form.append('textOnly', hasImages ? '0' : '1');
    form.append('prompt', finalPrompt);

    const base = getApiBaseEffective();
    const url = (base ? `${base.replace(/\/$/, '')}` : '') + '/api/edit';
    const resp = await fetch(url, {
      method: 'POST',
      body: form,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || `Ошибка ${resp.status}`);
    }
    /** @type {{ results: { mimeType: string, b64: string, filename: string }[] }} */
    const data = await resp.json();
    return data.results || [];
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
      const dataUrl = `data:${it.mimeType};base64,${it.b64}`;
      dataUrls.push(dataUrl);
      img.src = dataUrl;
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
      if (want === 1) {
        items = await callEditApi(files, prompt, textOnly, canvasRatio);
      } else if (runParallel) {
        const tasks = Array.from({ length: want }, () => callEditApi(files, prompt, textOnly, canvasRatio));
        const all = await Promise.allSettled(tasks);
        items = all.flatMap((r) => r.status === 'fulfilled' ? r.value : []);
      } else {
        for (let i = 0; i < want; i += 1) {
          const res = await callEditApi(files, prompt, textOnly, canvasRatio);
          items = items.concat(res);
        }
      }

      setStatus(`Готово: ${items.length} изображение(й)`);
      renderResults(items);
    } catch (e) {
      setStatus(e && e.message ? e.message : 'Ошибка выполнения', 'error');
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
})();


