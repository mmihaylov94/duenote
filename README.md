# DueNote

**DueNote** is a language-learning notebook app: you organize **courses** (e.g. Italian, German), each containing **workbooks** with rich **sections**—headers, translations, free text, and vocabulary tables. The UI is a **Vue 3** single-page app; **PostgreSQL** stores data and a **Node.js** API serves it. **DeepL** powers on-demand translation inside workbooks.

The project focuses on a **clean split** between frontend, API, and database, with **course-level defaults** (languages, merged vocabulary) and **auto-saved** workbook content.

---

## Purpose

DueNote is built to:

- Group learning material by **course** and **workbook** instead of a single flat document
- Support **mixed content types** in one workbook: title/header, paragraph-style notes, side-by-side translation blocks, and word lists
- Let each **course** define default **source** and **destination** languages for **new** workbooks
- Offer a **unified course vocabulary** view: all vocabulary sections across workbooks in a course, searchable, filterable by workbook, in **document order**
- Integrate **DeepL** for translation requests from the translation sections

---

## Core Features

### Courses & workbooks

- **Courses** — Top-level groups (e.g. “Italian”, “German”). Each course has a title and default **source** / **destination** languages for new workbooks.
- **Workbooks** — Belong to exactly one course. Titles derive from the first header line; content is stored as structured **sections** in JSON.
- **Sidebar** — Tree of courses (expand/collapse) with workbooks inside. Actions per course: rename, **Languages** (modal), **Vocabulary** (aggregated view), new workbook, delete course. Per workbook: open, duplicate, delete.

### Workbook content (sections)

Workbooks are a list of sections (see **TranslatorView**). Types include:

- **Header** — Title / heading text (drives workbook display name).
- **Translation** — Source and target text with language pair (synced with workbook / header language controls).
- **Vocabulary** — Table rows (`word` / `meaning`); multiple vocabulary blocks per workbook.
- **Simple text** — Free-form text blocks.

Content **auto-saves** (debounced) to the API when the user edits.

### Languages

- **Global header** (when a workbook is open): **Source** and **Destination** dropdowns (EN, BG, IT, DE, ES).
- **Course “Languages”** modal: sets defaults stored on the **course**; **new** workbooks in that course start with those languages. Existing workbooks keep their own stored languages.
- **API** validates language codes against the same allowed set.

### Course vocabulary

- Opens from the course **⋮** menu → **Vocabulary**.
- **Aggregates** every vocabulary section row from all workbooks in the course.
- **Order**: workbooks by creation time (oldest first), then section order, then row order within each vocabulary section.
- **Search** (word or meaning) and **filter** by workbook.
- Read-only combined view (editing stays in each workbook).

### Translation & DeepL

- Translation sections can call the backend **`POST /api/translate`**, which forwards to **DeepL** using the server-side API key.
- Supports the same language codes as the UI; identical source/target returns the original text without calling DeepL.

### API & operations

- **Health check**: `GET /health` — JSON `{ ok, env }` for monitoring.
- **Production-oriented backend**: modular `src/` layout, Helmet (when `NODE_ENV=production`), configurable CORS, centralized error handling, graceful shutdown and PostgreSQL pool closure.

---

## API Routes

Base URL is the backend origin (e.g. `http://localhost:3000`). All JSON APIs under `/api` except **`GET /health`** at the root.

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness: `{ ok: true, env: "..." }` |

### Courses

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/courses` | List courses with nested workbook summaries |
| POST | `/api/courses` | Create course (`title`, optional `sourceLang`, `targetLang`) |
| PATCH | `/api/courses/:id` | Update course (`title`, `sourceLang`, `targetLang`) |
| DELETE | `/api/courses/:id` | Delete course (cascades workbooks) |
| GET | `/api/courses/:id/vocabulary` | Aggregated vocabulary entries for the course |

### Workbooks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workbooks` | List workbook metadata |
| GET | `/api/workbooks/:id` | Full workbook (sections, languages, etc.) |
| POST | `/api/workbooks` | Create workbook (`courseId`, optional `title`) |
| PATCH | `/api/workbooks/:id` | Update workbook (e.g. `sections`, `title`, languages) |
| DELETE | `/api/workbooks/:id` | Delete workbook |
| POST | `/api/workbooks/:id/duplicate` | Duplicate workbook |

### Translation (DeepL)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/translate` | Body: `text`, `sourceLang`, `targetLang` → `{ translatedText }` |

---

## Technology Stack

### Backend

- **Node.js** (ES modules)
- **Express** — HTTP API
- **pg** — PostgreSQL client
- **dotenv** — Environment variables
- **cors** — Cross-origin requests
- **helmet** — Security headers in production

### Frontend

- **Vue 3** (Composition API, `<script setup>`)
- **Vite** — Dev server and production build
- **Tailwind CSS** — Styling
- **@vueup/vue-quill** — Rich text where used
- **@heroicons/vue** — Icons

### Data store

- **PostgreSQL** — Courses, workbooks, JSON content for sections

### Tooling

- **npm** — Package management
- **Git** — Version control

---

## Third-Party Services

### DeepL API

- Used for **`POST /api/translate`**.
- Requires **`DEEPL_AUTH_KEY`** in the backend `.env`.
- Default base URL is the **free** API (`https://api-free.deepl.com`); Pro accounts can set **`DEEPL_API_URL`** (e.g. `https://api.deepl.com`).
- See [DeepL API documentation](https://www.deepl.com/pro-api).

### PostgreSQL

- Required for all app data.
- Connection via **`DATABASE_URL`** or discrete **`DATABASE_*`** / **`PG*`** variables (see backend `.env.example`).

---

## Project Structure (overview)

```
duenote/
├── backend/
│   src/
│   ├── server.js          # Entry: DB init, listen, graceful shutdown
│   ├── app.js             # Express app, middleware, route mounts
│   ├── config.js          # Environment-driven config
│   ├── db/                # Pool, init/migrations, repositories
│   ├── routes/            # courses, workbooks, translate
│   ├── services/          # e.g. DeepL translation
│   ├── middleware/        # async handler, errors, 404
│   └── utils/             # Language helpers
│   package.json
│   .env.example
├── frontend/
│   src/
│   ├── App.vue
│   ├── main.js
│   ├── components/        # Sidebar, TranslatorView, sections, vocabulary panel
│   └── constants/         # e.g. languages.js
│   package.json
│   .env.example
└── README.md
```

---

## Dependencies

### Backend (`backend/package.json`)

| Package | Role |
|---------|------|
| express | Web framework |
| pg | PostgreSQL driver |
| dotenv | Load `.env` |
| cors | CORS middleware |
| helmet | Security headers (production) |

### Frontend (`frontend/package.json`)

| Package | Role |
|---------|------|
| vue | UI framework |
| vite | Build tool |
| @vitejs/plugin-vue | Vue SFC support |
| tailwindcss, @tailwindcss/vite | Styling |
| @vueup/vue-quill | Editor integration |
| @heroicons/vue | Icons |

---

## Environment Configuration

### Backend

Copy **`backend/.env.example`** to **`backend/.env`** and set:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` or `DATABASE_*` / `PG*` | PostgreSQL connection |
| `DEEPL_AUTH_KEY` | DeepL API key (required for translation) |
| `DEEPL_API_URL` | Optional; default free-tier DeepL URL |
| `PORT` | API port (default `3000`) |
| `NODE_ENV` | `production` enables stricter logging and Helmet |
| `CORS_ORIGIN` | Optional; comma-separated origins, or omit / `*` for permissive CORS |
| `JSON_LIMIT` | Optional; max JSON body size (default `2mb`) |

### Frontend

Copy **`frontend/.env.example`** to **`frontend/.env`** if needed:

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Backend base URL (no trailing slash); default `http://localhost:3000` in code |

---

## Setup

### Prerequisites

- **Node.js** 18+ recommended (backend `npm run dev` uses `node --watch`; use `npm run dev:plain` if needed)
- **PostgreSQL** with a database created for DueNote (e.g. `duenote`)
- **DeepL API key** if you want translation features

### 1. Database

Create a database and user with appropriate permissions. Note connection URL or host, port, database name, user, and password.

### 2. Backend

```bash
cd backend
npm install
copy .env.example .env   # Windows; or cp on Unix — then edit .env
```

Fill in PostgreSQL and **DeepL** settings. Start the API:

```bash
npm run dev
# or: npm run dev:plain
# production: set NODE_ENV=production then npm start
```

On first run, the app creates/updates tables (`courses`, `workbooks`, migrations for `course_id`, languages on courses, etc.).

### 3. Frontend

```bash
cd frontend
npm install
copy .env.example .env   # optional — set VITE_API_URL if API is not on localhost:3000
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`).

### 4. Production build (frontend)

```bash
cd frontend
npm run build
```

Serve the **`frontend/dist`** static files with any static host or reverse proxy, and point **`VITE_API_URL`** (at build time) to your public API URL.

### 5. Production API

- Set **`NODE_ENV=production`**
- Configure **`CORS_ORIGIN`** to your frontend origin(s) if not using a same-origin proxy
- Run **`npm start`** behind a process manager (systemd, PM2, Docker, etc.)
- Use **`GET /health`** for load balancer health checks

---

## Security notes

- **Never commit** real `.env` files; use `.env.example` as a template.
- **DeepL keys** and **database credentials** stay on the server only.
- The API does not implement user accounts; protect the deployment with network rules, authentication at the reverse proxy, or VPN as appropriate for your environment.

---

## License

Private / project-specific — add a license file if you distribute the code.
