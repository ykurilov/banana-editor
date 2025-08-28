'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

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

// ===== Retry helpers =====
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function callWithRetries(fn, { retries = 2, baseDelayMs = 400, maxDelayMs = 2000 } = {}) {
  let attempt = 0; let last;
  // Всего попыток = 1 + retries
  // backoff: base * 2^attempt + jitter
  while (attempt <= retries) {
    try {
      const json = await fn();
      const status = Number(json && json.__statusCode);
      const err = json && json.error;
      const code = Number(err && err.code);
      const shouldRetry = (status === 429 || (status >= 500 && status < 600)) || (code === 429 || (code >= 500 && code < 600));
      if (shouldRetry && attempt < retries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random() * 200);
        await sleep(delay);
        attempt += 1;
        last = json;
        continue;
      }
      return json;
    } catch (e) {
      if (attempt >= retries) throw e;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random() * 200);
      await sleep(delay);
      attempt += 1;
      last = e;
    }
  }
  return last;
}

async function handleEdit(req, res) {
  if (!API_KEY) {
    return sendJson(res, 400, { error: 'GEMINI_API_KEY не задан' });
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
  if (req.method === 'GET') return serveStatic(req, res);
  notFound(res);
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://${HOST}:${PORT}`);
});


