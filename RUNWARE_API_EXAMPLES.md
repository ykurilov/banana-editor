# Runware API - Примеры запросов и ответов

Документация для интеграции с Runware AI API для генерации изображений.

## 🔑 Базовая информация

- **Endpoint:** `https://api.runware.ai/v1/image/generate`
- **Method:** `POST`
- **Content-Type:** `application/json`
- **Authorization:** `Bearer YOUR_API_KEY`

## 📤 Примеры запросов (Payload)

### 1. Text-to-Image (Генерация из текста)

```json
[
  {
    "taskType": "imageInference",
    "numberResults": 2,
    "outputFormat": "JPEG",
    "includeCost": true,
    "outputType": ["URL"],
    "model": "google:4@1",
    "positivePrompt": "Beautiful sunset over mountains, photorealistic",
    "taskUUID": "550e8400-e29b-41d4-a716-446655440000"
  }
]
```

### 2. Image-to-Image (С референсными изображениями)

```json
[
  {
    "taskType": "imageInference",
    "numberResults": 4,
    "outputFormat": "JPEG",
    "includeCost": true,
    "outputType": ["URL"],
    "referenceImages": [
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD...",
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA..."
    ],
    "model": "google:4@1",
    "positivePrompt": "Превратить в стиль акварельной живописи с яркими цветами",
    "taskUUID": "550e8400-e29b-41d4-a716-446655440001"
  }
]
```

## 📥 Примеры ответов

### ✅ Успешный ответ

```json
{
  "data": [
    {
      "taskType": "imageInference",
      "imageUUID": "b417baea-992a-4b3c-838c-07980d06a0fb",
      "taskUUID": "550e8400-e29b-41d4-a716-446655440000",
      "cost": 0.0273,
      "seed": 709596153,
      "imageURL": "https://im.runware.ai/image/ws/2/ii/b417baea-992a-4b3c-838c-07980d06a0fb.jpg"
    },
    {
      "taskType": "imageInference", 
      "imageUUID": "8c321754-af9b-4624-a502-c2e7958ca9af",
      "taskUUID": "550e8400-e29b-41d4-a716-446655440000",
      "cost": 0.0273,
      "seed": 709596154,
      "imageURL": "https://im.runware.ai/image/ws/2/ii/8c321754-af9b-4624-a502-c2e7958ca9af.jpg"
    }
  ]
}
```

### ❌ Ответ с ошибкой

```json
{
  "data": [],
  "errors": [
    {
      "code": "invalidReferenceImages",
      "message": "Invalid value for 'referenceImages' parameter. Reference images must be an array of strings, where each image must be specified in one of the following formats: a UUID v4 string of a previously uploaded or generated image, a data URI string, a base64 encoded image, or a publicly accessible URL. Supported formats are: PNG, JPG, and WEBP.",
      "parameter": "referenceImages",
      "type": "string[]",
      "documentation": "https://runware.ai/docs/en/image-inference/api-reference#request-referenceimages",
      "taskUUID": "550e8400-e29b-41d4-a716-446655440000"
    }
  ]
}
```

## 📋 Описание параметров

### Обязательные параметры

| Параметр | Тип | Описание |
|----------|-----|----------|
| `taskType` | string | Всегда `"imageInference"` |
| `positivePrompt` | string | Текстовое описание желаемого изображения |
| `taskUUID` | string | Уникальный UUID v4 для отслеживания задачи |
| `model` | string | Модель AI (рекомендуется `"google:4@1"`) |

### Опциональные параметры

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|--------------|----------|
| `numberResults` | number | 1 | Количество генерируемых изображений (1-4) |
| `outputFormat` | string | "PNG" | Формат выходного файла ("PNG", "JPEG") |
| `outputType` | string[] | ["URL"] | Тип вывода (["URL"], ["dataURI"]) |
| `includeCost` | boolean | false | Включать стоимость в ответ |
| `referenceImages` | string[] | - | Массив изображений для image-to-image |

## 🎯 Модели

| Модель | Описание |
|--------|----------|
| `google:4@1` | Google Imagen - высокое качество, фотореализм |
| `bfl:5@1` | FLUX.1 Pro - художественный стиль |

## 💰 Стоимость

- **Google Imagen:** ~$0.027 за изображение
- **Время генерации:** 7-15 секунд (text-to-image), 30-120 секунд (image-to-image)

## ⚡ Важные особенности

### 1. Text-to-Image
- **НЕ включать** параметр `referenceImages` вообще
- Быстрая генерация (7-15 секунд)

### 2. Image-to-Image  
- **Обязательно включать** `referenceImages` с массивом изображений
- Поддерживаемые форматы: PNG, JPG, WEBP
- Изображения передаваются как data URI: `data:image/jpeg;base64,...`
- Медленная генерация (30-120 секунд)

### 3. UUID Generation
```javascript
// JavaScript
const taskUUID = crypto.randomUUID();

// Python
import uuid
task_uuid = str(uuid.uuid4())
```

## 🔧 Пример интеграции (JavaScript)

```javascript
async function generateWithRunware(prompt, referenceImages = [], count = 1) {
  const payload = [{
    taskType: "imageInference",
    numberResults: count,
    outputFormat: "JPEG",
    includeCost: true,
    outputType: ["URL"],
    model: "google:4@1",
    positivePrompt: prompt,
    taskUUID: crypto.randomUUID()
  }];
  
  // Добавляем референсные изображения только если есть
  if (referenceImages.length > 0) {
    payload[0].referenceImages = referenceImages;
  }
  
  const response = await fetch('https://api.runware.ai/v1/image/generate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${YOUR_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  
  const result = await response.json();
  
  if (result.errors && result.errors.length > 0) {
    throw new Error(`Runware API Error: ${result.errors[0].message}`);
  }
  
  return result.data; // Массив сгенерированных изображений
}
```

## 🛡️ Обработка ошибок

```javascript
// Проверка на ошибки в ответе
if (response.data && response.data.length > 0) {
  // Успех - используем response.data[0].imageURL
  console.log('Generated:', response.data[0].imageURL);
} else if (response.errors && response.errors.length > 0) {
  // Ошибка API
  console.error('API Error:', response.errors[0].message);
} else {
  // Неожиданный ответ
  console.error('Unexpected response:', response);
}
```

## 📞 Контакты

- **Документация:** https://runware.ai/docs
- **Support:** support@runware.ai
- **API Reference:** https://runware.ai/docs/en/image-inference/api-reference
