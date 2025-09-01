'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

// Simple .env loader (no deps)
function loadDotEnv(filePath) {
  try {
    const full = path.resolve(filePath);
    if (!fs.existsSync(full)) return;
    const content = fs.readFileSync(full, 'utf8');
    content.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    });
  } catch (_) {
    // ignore
  }
}

loadDotEnv(path.join(__dirname, '.env'));
// Fallback для окружений, где создание скрытых файлов ограничено
loadDotEnv(path.join(__dirname, 'env'));

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = 'gemini-2.5-flash-image-preview';
const PROVIDER = String(process.env.PROVIDER || 'gemini').toLowerCase();
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const OR_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp';
const RUNWARE_API_KEY = process.env.RUNWARE_API_KEY || '';
const RUNWARE_RESULTS_COUNT = Number(process.env.RUNWARE_RESULTS_COUNT || 2);
const RUNWARE_TIMEOUT_MS = Number(process.env.RUNWARE_TIMEOUT_MS || 45000);
const REQ_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 15000);
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || '';

// Minimal MIME map
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function serveStatic(req, res) {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  let filePath = decodeURIComponent(parsed.pathname);
  if (filePath === '/') filePath = '/index.html';
  const safePath = path.normalize(filePath).replace(/^\.+/, '');
  const abs = path.join(__dirname, safePath);
  if (!abs.startsWith(__dirname)) return notFound(res);
  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) return notFound(res);
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    fs.createReadStream(abs).pipe(res);
  });
}

// Buffer split helper
function bufferSplit(buf, sep) {
  const parts = [];
  let start = 0;
  let index;
  while ((index = buf.indexOf(sep, start)) !== -1) {
    parts.push(buf.slice(start, index));
    start = index + sep.length;
  }
  parts.push(buf.slice(start));
  return parts;
}

// Parse multipart/form-data; returns { fields: {prompt: string}, files: { name, filename, mimeType, data: Buffer }[] }
function parseMultipart(req, bodyBuf) {
  const ct = req.headers['content-type'] || '';
  const m = /boundary=([^;]+)/i.exec(ct);
  if (!m) throw new Error('boundary not found');
  const boundary = Buffer.from('--' + m[1]);
  const ending = Buffer.from('--' + m[1] + '--');

  const chunks = bufferSplit(bodyBuf, boundary);
  const fields = {};
  const files = [];

  for (let i = 1; i < chunks.length - 1; i += 1) {
    let part = chunks[i];
    if (part.slice(0, 2).toString() === '\r\n') part = part.slice(2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;
    const headersBuf = part.slice(0, headerEnd).toString('utf8');
    let content = part.slice(headerEnd + 4);
    // remove trailing CRLF
    if (content.slice(-2).toString() === '\r\n') content = content.slice(0, -2);

    const cdMatch = /content-disposition: form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(headersBuf);
    const ctMatch = /content-type:\s*([^\r\n]+)/i.exec(headersBuf);
    if (!cdMatch) continue;
    const name = cdMatch[1];
    const filename = cdMatch[2];
    const mimeType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';

    if (filename) {
      files.push({ name, filename, mimeType, data: content });
    } else {
      fields[name] = content.toString('utf8');
    }
  }

  return { fields, files };
}

function requestGeminiGenerate({ apiKey, model, prompt, images }) {
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: prompt },
          ...images.map((img) => ({ inline_data: { mime_type: img.mimeType, data: img.base64 } }))
        ]
      }
    ]
  };

  const payloadStr = JSON.stringify(payload);
  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`);

  const options = {
    method: 'POST',
    hostname: endpoint.hostname,
    path: endpoint.pathname + endpoint.search,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'accept': 'application/json',
      'content-length': Buffer.byteLength(payloadStr)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(text);
          // Возвращаем JSON даже при ошибке, чтобы выше решить — ретраить или нет
          json.__statusCode = res.statusCode;
          resolve(json);
        } catch (e) {
          reject(new Error('Bad JSON from Gemini'));
        }
      });
    });
    req.setTimeout(REQ_TIMEOUT_MS, () => {
      req.destroy(new Error('Upstream timeout'));
    });
    req.on('error', reject);
    req.write(payloadStr);
    req.end();
  });
}

function generateTaskUUID() {
  const uuid = crypto.randomUUID();
  console.log(`🆔 Сгенерированный UUID: ${uuid}`);
  return uuid;
}

function requestRunwareGenerate({ apiKey, prompt, images, resultsCount = 2 }) {
  const taskUUID = generateTaskUUID();
  
  // Создаем referenceImages только если есть изображения
  let referenceImages = [];
  let hasReferenceImages = false;
  
  if (images && images.length > 0) {
    referenceImages = images.map(img => `data:${img.mimeType};base64,${img.base64}`);
    hasReferenceImages = true;
    console.log(`📎 Создано ${referenceImages.length} референсных изображений`);
    console.log(`🎯 Размеры референсов:`, referenceImages.map(img => `${Math.round(img.length / 1024)}KB`));
  } else {
    console.log(`📝 Text-to-image генерация (без референсных изображений)`);
  }
  
  console.log(`🎯 Runware запрос:`, {
    resultsCount,
    hasReferenceImages,
    referenceImagesCount: referenceImages.length,
    promptLength: prompt.length,
    promptPreview: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
    taskUUID,
    timeout: `${RUNWARE_TIMEOUT_MS}ms`
  });
  
  const payload = [{
    taskType: "imageInference",
    numberResults: resultsCount,
    outputFormat: "JPEG", 
    includeCost: true,
    outputType: ["URL"],
    model: "google:4@1",
    positivePrompt: prompt,
    taskUUID: taskUUID
  }];
  
  // Добавляем referenceImages только если есть изображения
  if (hasReferenceImages) {
    payload[0].referenceImages = referenceImages;
    console.log(`✅ Добавлено поле referenceImages с ${referenceImages.length} изображениями`);
  } else {
    console.log(`✅ Поле referenceImages НЕ добавлено (text-to-image)`);
  }

  const payloadStr = JSON.stringify(payload);
  const endpoint = new URL('https://api.runware.ai/v1/image/generate');

  const options = {
    method: 'POST',
    hostname: endpoint.hostname,
    path: endpoint.pathname,
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json; charset=utf-8',
      'accept': 'application/json',
      'content-length': Buffer.byteLength(payloadStr)
    }
  };

  return new Promise((resolve, reject) => {
    console.log(`⏱️ Начинаем HTTP запрос к Runware...`);
    const startTime = Date.now();
    
    const req = https.request(options, (res) => {
      console.log(`📡 Получен ответ от Runware, статус: ${res.statusCode}`);
      const chunks = [];
      res.on('data', (d) => {
        chunks.push(d);
        console.log(`📊 Получено ${d.length} байт данных`);
      });
      res.on('end', () => {
        const elapsed = Date.now() - startTime;
        console.log(`✅ Runware запрос завершен за ${elapsed}ms`);
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(text);
          json.__statusCode = res.statusCode;
          
          // Проверяем на ошибки в ответе Runware
          if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
            console.error(`❌ Runware вернул ошибки:`, json.errors);
            const errorMessages = json.errors.map(err => `${err.code}: ${err.message}`).join('; ');
            reject(new Error(`Runware API error: ${errorMessages}`));
            return;
          }
          
          resolve(json);
        } catch (e) {
          console.error(`❌ Ошибка парсинга JSON от Runware:`, e.message);
          console.error(`Полученный текст:`, text.substring(0, 500));
          reject(new Error('Bad JSON from Runware'));
        }
      });
    });
    
    req.setTimeout(RUNWARE_TIMEOUT_MS, () => {
      const elapsed = Date.now() - startTime;
      console.error(`⏰ Runware таймаут после ${elapsed}ms (лимит: ${RUNWARE_TIMEOUT_MS}ms)`);
      req.destroy(new Error(`Runware timeout after ${elapsed}ms`));
    });
    
    req.on('error', (err) => {
      const elapsed = Date.now() - startTime;
      console.error(`❌ Ошибка HTTP запроса к Runware после ${elapsed}ms:`, err.message);
      reject(err);
    });
    
    console.log(`📤 Отправляем payload размером ${payloadStr.length} байт`);
  console.log(`🔍 Содержимое payload:`, JSON.stringify(payload, null, 2));
    req.write(payloadStr);
    req.end();
  });
}

function requestOpenRouterGenerate({ apiKey, model, prompt, images }) {
  const userContent = [];
  userContent.push({ type: 'text', text: prompt });
  (images || []).forEach((img) => {
    const dataUrl = `data:${img.mimeType};base64,${img.base64}`;
    userContent.push({ type: 'image_url', image_url: { url: dataUrl } });
  });

  const payload = {
    model,
    messages: [
      { role: 'system', content: 'You are an image generation and editing assistant. If the user provides input images, edit them as requested. If not, generate a brand new image. Always include the result as a single data URL (data:image/png;base64,...) in your final message and nothing else.' },
      { role: 'user', content: userContent }
    ]
  };

  const payloadStr = JSON.stringify(payload);
  const endpoint = new URL('https://openrouter.ai/api/v1/chat/completions');
  const options = {
    method: 'POST',
    hostname: endpoint.hostname,
    path: endpoint.pathname,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'accept': 'application/json',
      'authorization': `Bearer ${apiKey}`,
      'content-length': Buffer.byteLength(payloadStr)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(text);
          json.__statusCode = res.statusCode;
          resolve(json);
        } catch (e) {
          reject(new Error('Bad JSON from OpenRouter'));
        }
      });
    });
    req.on('error', reject);
    req.write(payloadStr);
    req.end();
  });
}

// ===== Session & File helpers =====
function generateSessionId() {
  return 'session_' + crypto.randomBytes(8).toString('hex');
}

function ensureUploadsDir() {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

function ensureSessionDir(sessionId) {
  const uploadsDir = ensureUploadsDir();
  const sessionDir = path.join(uploadsDir, sessionId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}

function getImageMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg', 
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  };
  return mimeTypes[ext] || 'image/png';
}

// ===== Retry helpers =====
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function callWithRetries(fn, { retries = 2, baseDelayMs = 400, maxDelayMs = 2000 } = {}) {
  let attempt = 0; let last;
  console.log(`🔁 Начинаем retry запрос, максимум попыток: ${retries + 1}`);
  
  // Всего попыток = 1 + retries
  // backoff: base * 2^attempt + jitter
  while (attempt <= retries) {
    try {
      console.log(`🚀 Попытка ${attempt + 1} из ${retries + 1}`);
      const json = await fn();
      const status = Number(json && json.__statusCode);
      const err = json && json.error;
      const code = Number(err && err.code);
      const shouldRetry = (status === 429 || (status >= 500 && status < 600)) || (code === 429 || (code >= 500 && code < 600));
      
      console.log(`📋 Результат попытки ${attempt + 1}:`, { status, hasError: !!err, shouldRetry });
      
      if (shouldRetry && attempt < retries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random() * 200);
        console.log(`⏳ Retry через ${delay}ms из-за статуса ${status}`);
        await sleep(delay);
        attempt += 1;
        last = json;
        continue;
      }
      console.log(`✅ Retry завершен успешно на попытке ${attempt + 1}`);
      return json;
    } catch (e) {
      console.log(`❌ Ошибка на попытке ${attempt + 1}:`, e.message);
      if (attempt >= retries) {
        console.log(`🔥 Исчерпаны все попытки retry`);
        throw e;
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random() * 200);
      console.log(`⏳ Retry через ${delay}ms из-за ошибки`);
      await sleep(delay);
      attempt += 1;
      last = e;
    }
  }
  return last;
}

async function handleEdit(req, res) {
  console.log(`🌐 Получен запрос на /api/edit от ${req.headers['x-forwarded-for'] || req.connection.remoteAddress}`);
  console.log(`📋 Headers:`, {
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length'],
    'user-agent': req.headers['user-agent']
  });
  
  if (!API_KEY && !RUNWARE_API_KEY) {
    return sendJson(res, 400, { error: 'Ни один API ключ не задан' });
  }
  const MAX = 25 * 1024 * 1024; // 25MB
  const chunks = [];
  let size = 0;
  req.on('data', (d) => {
    size += d.length;
    if (size > MAX) {
      req.destroy();
    } else {
      chunks.push(d);
    }
  });
  req.on('close', () => {
    if (size > MAX) sendJson(res, 413, { error: 'Слишком большой запрос' });
  });
  req.on('end', async () => {
    try {
      const body = Buffer.concat(chunks);
      const { fields, files } = parseMultipart(req, body);
      const prompt = String(fields.prompt || '').trim();
      const textOnly = String(fields.textOnly || '0') === '1';
      const resultsCount = Math.max(1, Math.min(4, Number(fields.resultsCount) || RUNWARE_RESULTS_COUNT));
      if (!prompt) return sendJson(res, 400, { error: 'prompt обязателен' });
      if (!textOnly && (!files || files.length === 0)) return sendJson(res, 400, { error: 'нужно минимум одно изображение или включить textOnly' });

      const images = (textOnly ? [] : files).map((f, idx) => ({
        mimeType: f.mimeType.startsWith('image/') ? f.mimeType : 'image/png',
        base64: f.data.toString('base64'),
        filename: f.filename || `image_${idx + 1}`
      }));

      let json;
      if (PROVIDER === 'openrouter') {
        if (!OR_KEY) return sendJson(res, 400, { error: 'OPENROUTER_API_KEY не задан' });
        json = await callWithRetries(() => requestOpenRouterGenerate({ apiKey: OR_KEY, model: OR_MODEL, prompt, images }), { retries: 2 });
      } else if (PROVIDER === 'runware') {
        if (!RUNWARE_API_KEY) return sendJson(res, 400, { error: 'RUNWARE_API_KEY не задан' });
        console.log(`🖼️ Runware: запрашиваем ${resultsCount} изображений`);
        
        try {
          json = await callWithRetries(() => requestRunwareGenerate({ apiKey: RUNWARE_API_KEY, prompt, images, resultsCount }), { retries: 1 });
          
          // Проверяем статус ответа от Runware
          if (json.__statusCode && json.__statusCode !== 200) {
            console.error(`❌ Runware вернул статус ${json.__statusCode}:`, json);
            
            if (json.__statusCode >= 500) {
              return sendJson(res, 502, { 
                error: 'Временная проблема на сервере AI. Попробуйте через несколько минут', 
                details: `Runware API статус: ${json.__statusCode}`,
                provider: 'runware',
                upstream: json
              });
            } else if (json.__statusCode === 429) {
              return sendJson(res, 429, { 
                error: 'Превышен лимит запросов к AI. Подождите и попробуйте снова', 
                details: 'Rate limit exceeded',
                provider: 'runware'
              });
            } else if (json.__statusCode === 401 || json.__statusCode === 403) {
              return sendJson(res, 401, { 
                error: 'Проблема с API ключом Runware', 
                details: `Authentication failed: ${json.__statusCode}`,
                provider: 'runware'
              });
            }
          }
          
        } catch (error) {
          console.error('🔥 Ошибка при запросе к Runware:', error.message);
          
          // Попробуем Runware без референсных изображений
          if (images.length > 0) {
            console.log('🔄 Пробуем Runware без референсных изображений...');
            try {
              json = await callWithRetries(() => requestRunwareGenerate({ 
                apiKey: RUNWARE_API_KEY, 
                prompt: `${prompt} (по мотивам загруженного изображения)`, 
                images: [], // Без референсов
                resultsCount 
              }), { retries: 1 });
              console.log('✅ Runware без референсов успешен');
            } catch (noRefError) {
              console.error('❌ Runware без референсов тоже не сработал:', noRefError.message);
              
              // Fallback на Gemini
              if (API_KEY) {
                console.log('🔄 Пробуем fallback на Gemini...');
                try {
                  json = await callWithRetries(() => requestGeminiGenerate({ apiKey: API_KEY, model: MODEL, prompt, images }), { retries: 1 });
                  console.log('✅ Fallback на Gemini успешен');
                } catch (geminiError) {
                  console.error('❌ Fallback на Gemini тоже не сработал:', geminiError.message);
                  return sendJson(res, 502, { 
                    error: 'Временная проблема на сервере AI. Попробуйте через несколько минут', 
                    details: `Runware с референсами: ${error.message}, Runware без референсов: ${noRefError.message}, Gemini: ${geminiError.message}`,
                    provider: 'all-failed'
                  });
                }
              } else {
                return sendJson(res, 502, { 
                  error: 'Временная проблема на сервере AI. Попробуйте через несколько минут', 
                  details: `Runware с референсами: ${error.message}, Runware без референсов: ${noRefError.message}`,
                  provider: 'runware-failed'
                });
              }
            }
          } else {
            // Fallback на Gemini для text-to-image
            if (API_KEY) {
              console.log('🔄 Пробуем fallback на Gemini для text-to-image...');
              try {
                json = await callWithRetries(() => requestGeminiGenerate({ apiKey: API_KEY, model: MODEL, prompt, images }), { retries: 1 });
                console.log('✅ Fallback на Gemini успешен');
              } catch (geminiError) {
                console.error('❌ Fallback на Gemini тоже не сработал:', geminiError.message);
                return sendJson(res, 502, { 
                  error: 'Временная проблема на сервере AI. Попробуйте через несколько минут', 
                  details: `Runware: ${error.message}, Gemini: ${geminiError.message}`,
                  provider: 'runware+gemini'
                });
              }
            } else {
              return sendJson(res, 502, { 
                error: 'Временная проблема на сервере AI. Попробуйте через несколько минут', 
                details: error.message,
                provider: 'runware'
              });
            }
          }
        }
      } else {
        if (!API_KEY) return sendJson(res, 400, { error: 'GEMINI_API_KEY не задан' });
        json = await callWithRetries(() => requestGeminiGenerate({ apiKey: API_KEY, model: MODEL, prompt, images }), { retries: 2 });
      }

      const results = [];
      try {
        if (PROVIDER === 'openrouter') {
          const choice = json && json.choices && json.choices[0];
          const content = choice && choice.message && choice.message.content;
          // Expect a data URL somewhere in the assistant message
          const match = content && content.match(/data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=]+)/);
          if (match) {
            results.push({ mimeType: match[1], b64: match[2], filename: 'result.png' });
          }
        } else if (PROVIDER === 'runware') {
          // Обработка ответа от Runware API  
          console.log('📦 Runware response structure:', JSON.stringify(json, null, 2));
          console.log('📋 Runware response status:', json.__statusCode);
          
          if (json.data && Array.isArray(json.data) && json.data.length > 0) {
            console.log(`✅ Runware вернул ${json.data.length} изображений`);
            json.data.forEach((item, index) => {
              if (item && item.imageURL) {
                console.log(`🖼️ Изображение ${index + 1}: ${item.imageURL} (cost: ${item.cost})`);
                // Для Runware используем imageURL, конвертируем в base64 если нужно
                results.push({ 
                  mimeType: 'image/jpeg', 
                  imageURL: item.imageURL,
                  imageUUID: item.imageUUID,
                  cost: item.cost,
                  seed: item.seed,
                  filename: `runware_result_${index + 1}.jpg` 
                });
              }
            });
          } else if (json.data && Array.isArray(json.data) && json.data.length === 0) {
            console.warn('⚠️ Runware вернул пустой массив данных');
          } else {
            console.warn('⚠️ Неожиданная структура ответа от Runware:', {
              hasData: !!json.data,
              dataType: typeof json.data,
              isArray: Array.isArray(json.data),
              dataLength: json.data ? json.data.length : 'N/A',
              fullResponse: json
            });
          }
        } else {
          const candidates = (json && json.candidates) || [];
          candidates.forEach((cand) => {
            const parts = (cand && cand.content && cand.content.parts) || [];
            parts.forEach((p) => {
              const inlineA = p && p.inline_data;
              const inlineB = p && p.inlineData;
              const chosen = inlineA || inlineB;
              if (chosen && (chosen.data || chosen.bytesBase64)) {
                results.push({
                  mimeType: chosen.mime_type || chosen.mimeType || 'image/png',
                  b64: chosen.data || chosen.bytesBase64,
                  filename: 'result.png'
                });
              }
              // Дополнительно: если пришёл текст с data URL
              const asText = p && (p.text || p.rawText);
              if (!chosen && typeof asText === 'string') {
                const mAll = Array.from(asText.matchAll(/data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=]+)/g));
                mAll.forEach((m) => {
                  results.push({ mimeType: m[1], b64: m[2], filename: 'result.png' });
                });
              }
            });
          });
        }
      } catch (_) {}

      if (!results.length) {
        // Попробуем фоллбек-модель Gemini, если задана
        if (PROVIDER === 'gemini' && GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== MODEL) {
          try {
            const jsonFb = await callWithRetries(() => requestGeminiGenerate({ apiKey: API_KEY, model: GEMINI_FALLBACK_MODEL, prompt, images }), { retries: 1 });
            const candidatesFb = (jsonFb && jsonFb.candidates) || [];
            candidatesFb.forEach((cand) => {
              const parts = (cand && cand.content && cand.content.parts) || [];
              parts.forEach((p) => {
                const inlineA = p && p.inline_data;
                const inlineB = p && p.inlineData;
                const chosen = inlineA || inlineB;
                if (chosen && (chosen.data || chosen.bytesBase64)) {
                  results.push({
                    mimeType: chosen.mime_type || chosen.mimeType || 'image/png',
                    b64: chosen.data || chosen.bytesBase64,
                    filename: 'result.png'
                  });
                }
                const asText = p && (p.text || p.rawText);
                if (!chosen && typeof asText === 'string') {
                  const mAll = Array.from(asText.matchAll(/data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=]+)/g));
                  mAll.forEach((m) => {
                    results.push({ mimeType: m[1], b64: m[2], filename: 'result.png' });
                  });
                }
              });
            });
            if (!results.length) {
              if (jsonFb && jsonFb.error) {
                return sendJson(res, 502, { error: 'Провайдер вернул ошибку', upstream: jsonFb.error, raw: jsonFb, modelTried: [MODEL, GEMINI_FALLBACK_MODEL] });
              }
              return sendJson(res, 502, { error: 'Модель не вернула изображение', raw: jsonFb, modelTried: [MODEL, GEMINI_FALLBACK_MODEL] });
            }
          } catch (e) {
            return sendJson(res, 502, { error: 'Сбой фоллбек-модели', details: e && e.message, modelTried: [MODEL, GEMINI_FALLBACK_MODEL] });
          }
        } else {
          if (json && json.error) {
            return sendJson(res, 502, { error: 'Провайдер вернул ошибку', upstream: json.error, raw: json });
          }
          return sendJson(res, 502, { error: 'Модель не вернула изображение', raw: json });
        }
      }
      sendJson(res, 200, { results });
    } catch (e) {
      sendJson(res, 400, { error: e.message || 'Ошибка парсинга' });
    }
  });
}

// ===== Upload handler =====
async function handleUpload(req, res) {
  const MAX = 25 * 1024 * 1024; // 25MB
  const chunks = [];
  let size = 0;
  req.on('data', (d) => {
    size += d.length;
    if (size > MAX) {
      req.destroy();
    } else {
      chunks.push(d);
    }
  });
  req.on('close', () => {
    if (size > MAX) sendJson(res, 413, { error: 'Слишком большой запрос' });
  });
  req.on('end', async () => {
    try {
      const body = Buffer.concat(chunks);
      const { fields, files } = parseMultipart(req, body);
      
      let sessionId = fields.sessionId;
      if (!sessionId) {
        sessionId = generateSessionId();
      }
      
      const sessionDir = ensureSessionDir(sessionId);
      const savedFiles = [];
      
      for (const file of files) {
        // Генерируем безопасное имя файла
        const timestamp = Date.now();
        const ext = path.extname(file.filename || '.png');
        const safeName = `${timestamp}_${crypto.randomBytes(4).toString('hex')}${ext}`;
        const filePath = path.join(sessionDir, safeName);
        
        fs.writeFileSync(filePath, file.data);
        
        savedFiles.push({
          originalName: file.filename,
          savedName: safeName,
          mimeType: getImageMimeType(safeName),
          size: file.data.length
        });
      }
      
      sendJson(res, 200, { 
        sessionId, 
        files: savedFiles,
        message: `Сохранено ${savedFiles.length} файл(ов)` 
      });
    } catch (e) {
      sendJson(res, 400, { error: e.message || 'Ошибка загрузки файлов' });
    }
  });
}

// ===== Session handler =====
async function handleSession(req, res) {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = parsed.pathname.split('/');
    const sessionId = pathParts[3]; // /api/session/{sessionId}
    const fileName = pathParts[5]; // /api/session/{sessionId}/file/{fileName}
    
    if (!sessionId) {
      return sendJson(res, 400, { error: 'sessionId обязателен' });
    }
    
    const sessionDir = path.join(__dirname, 'uploads', sessionId);
    if (!fs.existsSync(sessionDir)) {
      return sendJson(res, 404, { error: 'Сессия не найдена' });
    }
    
    // Если запрашивается конкретный файл
    if (fileName) {
      const filePath = path.join(sessionDir, fileName);
      if (!fs.existsSync(filePath)) {
        return sendJson(res, 404, { error: 'Файл не найден' });
      }
      if (req.method === 'DELETE') {
        try {
          fs.unlinkSync(filePath);
          return sendJson(res, 200, { ok: true, deleted: fileName });
        } catch (e) {
          return sendJson(res, 500, { error: 'Не удалось удалить файл', message: e && e.message });
        }
      }
      const mimeType = getImageMimeType(fileName);
      res.writeHead(200, { 'content-type': mimeType });
      return fs.createReadStream(filePath).pipe(res);
    }
    
    // Возвращаем список файлов в сессии
    const files = fs.readdirSync(sessionDir)
      .filter(name => /\.(png|jpg|jpeg|gif|webp)$/i.test(name))
      .map(name => {
        const filePath = path.join(sessionDir, name);
        const stats = fs.statSync(filePath);
        return {
          name,
          mimeType: getImageMimeType(name),
          size: stats.size,
          url: `/api/session/${sessionId}/file/${name}`
        };
      });
      
    sendJson(res, 200, { sessionId, files });
  } catch (e) {
    sendJson(res, 400, { error: e.message || 'Ошибка получения сессии' });
  }
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  // CORS
  const origin = req.headers.origin || '*';
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-allow-credentials', 'true');
  
  // Запрет индексации поисковиками
  res.setHeader('x-robots-tag', 'noindex, nofollow, nosnippet, noarchive, noimageindex');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === 'POST' && parsed.pathname === '/api/edit') {
    return void handleEdit(req, res);
  }
  if (req.method === 'POST' && parsed.pathname === '/api/upload') {
    return void handleUpload(req, res);
  }
  if ((req.method === 'GET' || req.method === 'DELETE') && parsed.pathname.startsWith('/api/session/')) {
    return void handleSession(req, res);
  }
  if (req.method === 'GET') return serveStatic(req, res);
  notFound(res);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://${HOST}:${PORT}`);
});


