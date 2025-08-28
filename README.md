# Редактирование изображений по текстовому запросу (Gemini 2.5 flash image preview)

Мини-приложение без зависимостей: фронтенд на чистом JS + Node.js http-сервер с прокси к Gemini.

## Настройка

1) Скопируйте файл env.example в .env и укажите ключ:

GEMINI_API_KEY=ВАШ_API_КЛЮЧ
PORT=8080
HOST=0.0.0.0

2) Запуск сервера:

node server.js

3) Откройте в браузере:

http://localhost:8080

## Как это работает
- Фронтенд отправляет multipart/form-data на POST /api/edit с полями images (1..N файлов) и prompt (текст).
- Сервер проксирует запрос в Gemini v1beta/models/gemini-2.5-flash-image-preview:generateContent, передавая картинку как inline_data и текст запроса как text.
- В ответе ожидается inline_data с изображением (PNG), далее фронтенд отрисовывает и позволяет сохранить результат.

## Заметки
- Ключ храните только локально. Не коммитьте .env в репозиторий.
- Если модель не вернет inline_data, сервер вернет 502 с raw для диагностики.
- Лимит на размер запроса установлен ~25MB.

## Деплой на GitHub Pages (Frontend) + любой HTTPS сервер (Backend)

GitHub Pages хостит только фронтенд (статические файлы). Сервер `server.js` разместите на любом HTTPS-хостинге (Render/Railway/ВМ), укажите `GEMINI_API_KEY` и включите CORS (уже включено в проекте).

### 1) Подготовка репозитория
```bash
git init
git add .
git commit -m "Init: image editor + server proxy"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo>.git
git push -u origin main
```

### 2) Включение GitHub Pages
- В репозитории: Settings → Pages → Build and deployment → Deploy from a branch
- Branch: `main`, Folder: `/ (root)` → Save
- Итоговый URL: `https://<your-username>.github.io/<repo>/`

### 3) Деплой сервера (Node.js)
- Любая платформа с Node 18+. Пример запуска:
  - Start Command: `node server.js`
  - Env vars: `GEMINI_API_KEY=<ваш ключ>` (опц. `GEMINI_TIMEOUT_MS`, `GEMINI_FALLBACK_MODEL`)
- Сервер должен быть доступен по HTTPS, например `https://<service>.onrender.com`

### 4) Настроить адрес API в UI
- Откройте страницу GitHub Pages → блок «Настройки» → поле «Адрес API»
- Укажите базовый URL сервера без завершающего `/`, например `https://<service>.onrender.com`
- Нажмите «Сохранить» — фронтенд будет отправлять на `<API>/api/edit`

### 5) Проверка
- Загрузите изображения, введите промпт, нажмите «Запустить»
- При ошибках 5xx повторите через ~10–30 сек (на сервере есть ретраи и таймаут)

## Подсказки по конфигурации фронтенда
- В `app.js` есть `DEFAULT_API_BASE`. Укажите там базовый URL вашего сервера (без завершающего `/`), чтобы пользователю не приходилось вводить адрес в UI.
- Также можно передать адрес через URL: параметр `?api=...` имеет наивысший приоритет и автоматически сохранится в localStorage. Пример:
  - `https://<your-username>.github.io/<repo>/?api=https://<service>.onrender.com`
