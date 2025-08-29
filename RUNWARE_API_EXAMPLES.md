# Runware API - Документация и примеры

Документация по интеграции с Runware API для генерации изображений, с примерами из нашего проекта.

## Конфигурация

```javascript
const RUNWARE_API_KEY = process.env.RUNWARE_API_KEY;
const RUNWARE_RESULTS_COUNT = Number(process.env.RUNWARE_RESULTS_COUNT || 2);
const RUNWARE_TIMEOUT_MS = Number(process.env.RUNWARE_TIMEOUT_MS || 45000);
```

## Endpoint

```
POST https://api.runware.ai/v1/image/generate
```

## Headers

```javascript
const headers = {
  'authorization': `Bearer ${apiKey}`,
  'content-type': 'application/json; charset=utf-8',
  'accept': 'application/json'
}
```

## 1. Text-to-Image запрос

### Payload (без референсных изображений)

```json
[{
  "taskType": "imageInference",
  "numberResults": 2,
  "outputFormat": "JPEG", 
  "includeCost": true,
  "outputType": ["URL"],
  "model": "google:4@1",
  "positivePrompt": "beautiful sunset over mountains",
  "taskUUID": "550e8400-e29b-41d4-a716-446655440000"
}]
```

### Пример из проекта:

```javascript
function requestRunwareGenerate({ apiKey, prompt, images, resultsCount = 2 }) {
  const taskUUID = generateTaskUUID(); // crypto.randomUUID()
  
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
  if (images && images.length > 0) {
    const referenceImages = images.map(img => `data:${img.mimeType};base64,${img.base64}`);
    payload[0].referenceImages = referenceImages;
  }
  
  // ... HTTP запрос
}
```

## 2. Image-to-Image запрос (с референсными изображениями)

### Payload

```json
[{
  "taskType": "imageInference",
  "numberResults": 2,
  "outputFormat": "JPEG",
  "includeCost": true,
  "outputType": ["URL"],
  "model": "google:4@1", 
  "positivePrompt": "make the sky brighter and add rainbow",
  "taskUUID": "550e8400-e29b-41d4-a716-446655440001",
  "referenceImages": [
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA...",
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  ]
}]
```

### Подготовка изображений в проекте:

```javascript
// Конвертация File объектов в base64 для API
const images = files.map((f, idx) => ({
  mimeType: f.mimeType.startsWith('image/') ? f.mimeType : 'image/png',
  base64: f.data.toString('base64'),
  filename: f.filename || `image_${idx + 1}`
}));

// Формирование referenceImages для API
const referenceImages = images.map(img => `data:${img.mimeType};base64,${img.base64}`);
```

## 3. Успешный ответ от Runware

### Структура ответа:

```json
{
  "data": [
    {
      "taskUUID": "550e8400-e29b-41d4-a716-446655440000",
      "imageUUID": "123e4567-e89b-12d3-a456-426614174000", 
      "imageURL": "https://im.runware.ai/image/ws/0.25/ii/123e4567-e89b-12d3-a456-426614174000.jpg",
      "cost": 0.25,
      "seed": 1234567890
    },
    {
      "taskUUID": "550e8400-e29b-41d4-a716-446655440000",
      "imageUUID": "456e7890-e89b-12d3-a456-426614174001",
      "imageURL": "https://im.runware.ai/image/ws/0.25/ii/456e7890-e89b-12d3-a456-426614174001.jpg", 
      "cost": 0.25,
      "seed": 9876543210
    }
  ]
}
```

### Обработка результатов в проекте:

```javascript
// Извлечение результатов из ответа Runware
if (json.data && Array.isArray(json.data) && json.data.length > 0) {
  json.data.forEach((item, index) => {
    if (item && item.imageURL) {
      results.push({ 
        mimeType: 'image/jpeg', 
        imageURL: item.imageURL,      // Готовый URL изображения
        imageUUID: item.imageUUID,    // UUID изображения
        cost: item.cost,              // Стоимость генерации
        seed: item.seed,              // Seed для воспроизведения
        filename: `runware_result_${index + 1}.jpg` 
      });
    }
  });
}
```

## 4. Ошибки от Runware

### Структура ошибки:

```json
{
  "errors": [
    {
      "code": "INSUFFICIENT_CREDITS",
      "message": "Insufficient credits to complete the request"
    }
  ]
}
```

### Обработка ошибок в проекте:

```javascript
// Проверка на ошибки в ответе
if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
  console.error('❌ Runware вернул ошибки:', json.errors);
  const errorMessages = json.errors.map(err => `${err.code}: ${err.message}`).join('; ');
  reject(new Error(`Runware API error: ${errorMessages}`));
  return;
}

// Проверка HTTP статусов
if (json.__statusCode && json.__statusCode !== 200) {
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
  }
}
```

## 5. Настройки таймаутов и retry

### HTTP клиент с таймаутом:

```javascript
const options = {
  method: 'POST',
  hostname: 'api.runware.ai',
  path: '/v1/image/generate',
  headers: headers
};

return new Promise((resolve, reject) => {
  const req = https.request(options, (res) => {
    // обработка ответа
  });
  
  // Таймаут запроса
  req.setTimeout(RUNWARE_TIMEOUT_MS, () => {
    console.error(`⏰ Runware таймаут после ${elapsed}ms`);
    req.destroy(new Error(`Runware timeout after ${elapsed}ms`));
  });
  
  req.on('error', reject);
  req.write(payloadStr);
  req.end();
});
```

### Retry логика:

```javascript
// Вызов с повторами при ошибках 429, 5xx
json = await callWithRetries(() => requestRunwareGenerate({ 
  apiKey: RUNWARE_API_KEY, 
  prompt, 
  images, 
  resultsCount 
}), { retries: 1 });

// Функция retry с экспоненциальной задержкой
async function callWithRetries(fn, { retries = 2, baseDelayMs = 400, maxDelayMs = 2000 } = {}) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const json = await fn();
      const status = Number(json && json.__statusCode);
      const shouldRetry = (status === 429 || (status >= 500 && status < 600));
      
      if (shouldRetry && attempt < retries) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random() * 200);
        console.log(`⏳ Retry через ${delay}ms из-за статуса ${status}`);
        await sleep(delay);
        attempt += 1;
        continue;
      }
      return json;
    } catch (e) {
      if (attempt >= retries) throw e;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs) + Math.floor(Math.random() * 200);
      await sleep(delay);
      attempt += 1;
    }
  }
}
```

## 6. Fallback стратегия

### Обработка сбоев Runware:

```javascript
try {
  // Основной запрос к Runware
  json = await callWithRetries(() => requestRunwareGenerate({ 
    apiKey: RUNWARE_API_KEY, 
    prompt, 
    images, 
    resultsCount 
  }), { retries: 1 });
} catch (error) {
  console.error('🔥 Ошибка при запросе к Runware:', error.message);
  
  // Попробуем без референсных изображений
  if (images.length > 0) {
    console.log('🔄 Пробуем Runware без референсных изображений...');
    try {
      json = await callWithRetries(() => requestRunwareGenerate({ 
        apiKey: RUNWARE_API_KEY, 
        prompt: `${prompt} (по мотивам загруженного изображения)`, 
        images: [], // Без референсов
        resultsCount 
      }), { retries: 1 });
    } catch (noRefError) {
      // Fallback на Gemini
      if (API_KEY) {
        json = await callWithRetries(() => requestGeminiGenerate({ 
          apiKey: API_KEY, 
          model: MODEL, 
          prompt, 
          images 
        }), { retries: 1 });
      }
    }
  }
}
```

## 7. Логирование и диагностика

### Подробное логирование запросов:

```javascript
console.log(`🎯 Runware запрос:`, {
  resultsCount,
  hasReferenceImages,
  referenceImagesCount: referenceImages.length,
  promptLength: prompt.length,
  promptPreview: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
  taskUUID,
  timeout: `${RUNWARE_TIMEOUT_MS}ms`
});

console.log(`📤 Отправляем payload размером ${payloadStr.length} байт`);
console.log(`🔍 Содержимое payload:`, JSON.stringify(payload, null, 2));

// При получении ответа
console.log(`✅ Runware запрос завершен за ${elapsed}ms`);
console.log('📦 Runware response structure:', JSON.stringify(json, null, 2));

if (json.data && Array.isArray(json.data)) {
  json.data.forEach((item, index) => {
    if (item && item.imageURL) {
      console.log(`🖼️ Изображение ${index + 1}: ${item.imageURL} (cost: ${item.cost})`);
    }
  });
}
```

## 8. Использование в клиентском коде

### Frontend отправка запроса:

```javascript
async function callEditApi(files, prompt, textOnly, canvasRatio, resultsCount = 1) {
  const form = new FormData();
  
  // Добавляем изображения
  if (!textOnly) {
    files.forEach((f) => form.append('images', f, f.name));
  }
  
  // Параметры запроса
  form.append('textOnly', textOnly ? '1' : '0');
  form.append('prompt', prompt);
  form.append('resultsCount', String(resultsCount)); // Количество результатов для Runware
  
  const resp = await fetch('/api/edit', {
    method: 'POST',
    body: form,
    signal: controller.signal // Для отмены запроса
  });
  
  const data = await resp.json();
  return data.results || [];
}
```

### Рендеринг результатов:

```javascript
function renderResults(items) {
  items.forEach((it, idx) => {
    let imageSrc;
    if (it.imageURL) {
      // Runware возвращает готовый URL
      imageSrc = it.imageURL;
    } else if (it.b64) {
      // Gemini/OpenRouter возвращают base64
      imageSrc = `data:${it.mimeType};base64,${it.b64}`;
    }
    
    const img = document.createElement('img');
    img.src = imageSrc;
    // ... рендеринг
  });
}
```

## Основные отличия Runware от других провайдеров

1. **URL вместо base64** - Runware возвращает готовые URL изображений
2. **Batch генерация** - можно запросить несколько изображений сразу (`numberResults`)
3. **Стоимость в ответе** - каждый результат содержит информацию о стоимости
4. **UUID для отслеживания** - каждое изображение имеет уникальный ID
5. **Референсные изображения** - поддержка image-to-image через `referenceImages`

## Рекомендуемые настройки

- **Таймаут**: 120-180 секунд (генерация может занимать много времени)
- **Retry**: 1-2 попытки при ошибках сети/сервера  
- **Batch size**: 1-4 изображения за раз
- **Fallback**: предусмотреть резервный провайдер
- **Логирование**: детальное для диагностики проблем
