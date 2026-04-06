# DueNote

DueNote is a language-learning notebook for people who want to study from real content (articles, videos, notes) and keep everything organized.

- **For non‑technical readers**: Create a course (e.g. “German”), then create workbooks inside it. Each workbook is made of sections (title, translations, grammar notes, vocabulary lists, and embedded videos). The app auto-saves as you type.
- **For technical readers**: Vue 3 SPA + Node/Express API + PostgreSQL. Authentication uses server-side sessions (PostgreSQL-backed). Translation calls a backend DeepL proxy.

---

## What it does (non‑technical overview)

### Organize learning into courses and workbooks
- **Courses**: one per language/topic.
- **Workbooks**: one per lesson/article/video. A workbook is a page made of blocks you can reorder.

### Build workbooks from sections
Workbooks support multiple section types:
- **Header**: a title (also used as the workbook name).
- **Translation**: side-by-side text with a source/target language.
- **Vocabulary**: word + meaning rows.
- **Grammar**: rich notes (formatting, lists, highlights).
- **Video**: embed a YouTube video (added via URL; immutable once created).

### Create vocabulary as you read
- Highlight text in Header / Translation / Grammar and click **Add to dictionary**.
- DueNote translates the highlighted text via DeepL and adds it to your workbook’s vocabulary.

### View all vocabulary for a course
A course has a combined **Vocabulary** view that aggregates words from all workbooks.

---

## Key behaviors (important details)

### Vocabulary editing rules
- **Edit meaning**: updates the shared meaning for that entry (debounced PATCH).
- **Edit word**:
  - If the entry appears in **multiple rows** in the workbook, editing the word **forks** (creates/links a new entry for just that row).
  - If it appears only **once**, editing the word updates the entry in place.
- **Remove row**: if an entry has no remaining references in any workbook (in the course), it is deleted from the course vocabulary table; otherwise only the row reference is removed.

### Video sections are immutable
When adding a Video section you paste a YouTube link in a modal. After creation the section shows only the video and cannot be edited; to change it, remove the section and add a new Video section.

---

## Integrations

- **DeepL API**: used by `POST /api/translate` to translate selected text and translation blocks. Requires `DEEPL_AUTH_KEY`.
- **Google OAuth** (optional): “Continue with Google”. Requires Google client credentials + callback URL configuration.
- **Email OTP** (optional in dev, recommended in production): passwordless sign-in via email codes. Requires SMTP in production.
- **PostgreSQL**: all app data + session storage.
- **S3 (optional)**: profile avatar uploads can be stored on local disk or S3 (see `backend/.env.example`).

---

## Core Features

### Courses & workbooks

- **Courses** - Top-level groups (e.g. “Italian”, “German”). Each course has a title and default **source** / **destination** languages for new workbooks.
- **Workbooks** - Belong to exactly one course. Titles derive from the first header line; content is stored as structured **sections** in JSON.
- **Sidebar** - Tree of courses (expand/collapse) with workbooks inside. Actions per course: rename, **Languages** (modal), **Vocabulary** (aggregated view), new workbook, delete course. Per workbook: open, duplicate, delete.

### Workbook content (sections)

Workbooks are a list of sections (see **TranslatorView**). Types include:

- **Header** - Title / heading text (drives workbook display name).
- **Translation** - Source and target text with language pair (synced with workbook / header language controls).
- **Vocabulary** - Table rows (`word` / `meaning`); multiple vocabulary blocks per workbook.
- **Grammar** - Rich-text notes (Quill).
- **Video** - YouTube embed section (added via a URL modal; immutable once created).

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

### Vocabulary editing rules (important)

- **Edit meaning**: updates the **shared meaning** for that word entry (debounced PATCH).
- **Edit word**:
  - If that entry is used in **multiple rows** in the workbook, editing the word **forks**: it creates/links a new entry and only this row changes.
  - If it’s used in **one row**, editing the word updates the existing entry in place.
- **Remove row**: if the entry has **no remaining references in any workbook**, the entry is deleted from the course vocabulary table; otherwise only the row reference is removed.

### Add-to-dictionary from highlights

In header / translation / grammar sections, selecting text shows an **Add to dictionary** popover. Clicking it:

- Calls **DeepL** (`POST /api/translate`) for the highlighted text
- Creates/links a vocabulary entry in the course
- Adds it to the workbook’s first vocabulary section (or creates one if missing)

### Translation & DeepL

- Translation sections can call the backend **`POST /api/translate`**, which forwards to **DeepL** using the server-side API key.
- Supports the same language codes as the UI; identical source/target returns the original text without calling DeepL.

### API & operations

- **Health check**: `GET /health` - JSON `{ ok, env }` for monitoring.
- **Authentication**: Session cookie (`httpOnly`, `SameSite`); `GET /api/auth/me`, `POST /api/auth/logout`, Google OAuth (`/auth/google` or `/api/auth/google`), email OTP under `/api/auth/email/*`. The same auth router is mounted at **`/auth`** and **`/api/auth`** so `GOOGLE_CALLBACK_URL` can use either prefix. Data routes require a logged-in session.
- **Production-oriented backend**: modular `src/` layout, Helmet (when `NODE_ENV=production`), CORS with **credentials** for trusted origins, centralized error handling, graceful shutdown and PostgreSQL pool closure.

---

## API Routes

Base URL is the backend origin (e.g. `http://localhost:3000`). **`GET /health`** is public. **`/api/auth/*`** is public (except responses depend on session). **`/api/courses`**, **`/api/workbooks`**, and **`/api/translate`** require an authenticated session (`Cookie` with valid session).

### Health

| Method | Path      | Description                          |
| ------ | --------- | ------------------------------------ |
| GET    | `/health` | Liveness: `{ ok: true, env: "..." }` |

### Auth

| Method | Path                        | Description                                                     |
| ------ | --------------------------- | --------------------------------------------------------------- |
| GET    | `/api/auth/me`              | Current user `{ id, email, displayName, avatarUrl }` or **401** |
| POST   | `/api/auth/logout`          | Destroy session (**204**)                                       |
| GET    | `/auth/google` or `/api/auth/google` | Start Google OAuth (redirect)                                   |
| GET    | `/auth/google/callback` or `/api/auth/google/callback` | OAuth callback (must match `GOOGLE_CALLBACK_URL`; redirects to `FRONTEND_URL/app`) |
| POST   | `/api/auth/email/request`   | Body `{ email }` - sends OTP (rate-limited)                     |
| POST   | `/api/auth/email/verify`    | Body `{ email, code }` - creates session                        |

### Courses

| Method | Path                          | Description                                                  |
| ------ | ----------------------------- | ------------------------------------------------------------ |
| GET    | `/api/courses`                | List courses with nested workbook summaries                  |
| POST   | `/api/courses`                | Create course (`title`, optional `sourceLang`, `targetLang`) |
| PATCH  | `/api/courses/:id`            | Update course (`title`, `sourceLang`, `targetLang`)          |
| DELETE | `/api/courses/:id`            | Delete course (cascades workbooks)                           |
| GET    | `/api/courses/:id/vocabulary` | Aggregated vocabulary entries for the course                 |

### Workbooks

| Method | Path                           | Description                                           |
| ------ | ------------------------------ | ----------------------------------------------------- |
| GET    | `/api/workbooks`               | List workbook metadata                                |
| GET    | `/api/workbooks/:id`           | Full workbook (sections, languages, etc.)             |
| POST   | `/api/workbooks`               | Create workbook (`courseId`, optional `title`)        |
| PATCH  | `/api/workbooks/:id`           | Update workbook (e.g. `sections`, `title`, languages) |
| DELETE | `/api/workbooks/:id`           | Delete workbook                                       |
| POST   | `/api/workbooks/:id/duplicate` | Duplicate workbook                                    |

### Translation (DeepL)

| Method | Path             | Description                                                                    |
| ------ | ---------------- | ------------------------------------------------------------------------------ |
| POST   | `/api/translate` | Auth required. Body: `text`, `sourceLang`, `targetLang` → `{ translatedText }` |

---

## Technology Stack

### Backend

- **Node.js** (ES modules)
- **Express** - HTTP API
- **pg** - PostgreSQL client
- **express-session** + **connect-pg-simple** - Server-side sessions
- **passport** + **passport-google-oauth20** - Google sign-in
- **nodemailer** - Email OTP delivery (SMTP)
- **express-rate-limit** - Rate limits on auth endpoints
- **dotenv** - Environment variables
- **cors** - Cross-origin requests (with credentials when needed)
- **helmet** - Security headers in production

### Frontend

- **Vue 3** (Composition API, `<script setup>`)
- **Vue Router** - Home, login, and protected notebook (`/app`)
- **Vite** - Dev server and production build (`/api` proxy to backend in dev)
- **Tailwind CSS** - Styling
- **@vueup/vue-quill** - Rich text where used
- **@heroicons/vue** - Icons

### Data store

- **PostgreSQL** - Users, sessions, courses (with `user_id`), workbooks, JSON content for sections

### Tooling

- **npm** - Package management
- **Git** - Version control

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
│   ├── app.js             # Express app, session, CORS, route mounts
│   ├── config.js          # Environment-driven config
│   ├── db/                # Pool, init/migrations, repositories
│   ├── routes/            # auth, courses, workbooks, translate
│   ├── services/          # DeepL, email
│   ├── middleware/        # async handler, errors, 404, requireAuth
│   └── utils/             # Language helpers
│   package.json
│   .env.example
├── frontend/
│   src/
│   ├── App.vue            # Root: router-view
│   ├── NotebookApp.vue    # Main notebook UI (protected)
│   ├── main.js
│   ├── router/
│   ├── views/             # Home, Login
│   ├── api/               # API client (credentials)
│   ├── components/        # Sidebar, TranslatorView, sections, vocabulary panel, video embed
│   └── constants/         # e.g. languages.js
│   package.json
│   .env.example
└── README.md
```

---

## Dependencies

### Backend (`backend/package.json`)

| Package                            | Role                          |
| ---------------------------------- | ----------------------------- |
| express                            | Web framework                 |
| pg                                 | PostgreSQL driver             |
| express-session, connect-pg-simple | Session store in PostgreSQL   |
| passport, passport-google-oauth20  | Google OAuth                  |
| nodemailer                         | SMTP email for OTP            |
| express-rate-limit                 | Rate limiting on auth         |
| dotenv                             | Load `.env`                   |
| cors                               | CORS middleware               |
| helmet                             | Security headers (production) |

### Frontend (`frontend/package.json`)

| Package                        | Role                |
| ------------------------------ | ------------------- |
| vue                            | UI framework        |
| vue-router                     | Client-side routing |
| vite                           | Build tool          |
| @vitejs/plugin-vue             | Vue SFC support     |
| tailwindcss, @tailwindcss/vite | Styling             |
| @vueup/vue-quill               | Editor integration  |
| @heroicons/vue                 | Icons               |

---

## Environment Configuration

### Backend

Copy **`backend/.env.example`** to **`backend/.env`** and set:

| Variable                                    | Purpose                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL` or `DATABASE_*` / `PG*`      | PostgreSQL connection                                                  |
| `SESSION_SECRET`                            | **Required in production** (32+ random chars); signs session cookies   |
| `FRONTEND_URL`                              | Browser app URL for OAuth redirect (e.g. `https://app.example.com`)    |
| `PUBLIC_API_URL`                            | Public API base URL (used for Google callback default)                 |
| `COOKIE_SECURE`                             | `true` in production behind HTTPS (default when `NODE_ENV=production`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (optional)                                                |
| `GOOGLE_CALLBACK_URL`                       | Full callback URL if not `{PUBLIC_API_URL}/auth/google/callback` (must match Google Console) |
| `SMTP_*`                                    | SMTP for email OTP; in production, required for email sign-in          |
| `DEEPL_AUTH_KEY`                            | DeepL API key (required for translation)                               |
| `DEEPL_API_URL`                             | Optional; default free-tier DeepL URL                                  |
| `PORT`                                      | API port (default `3000`)                                              |
| `NODE_ENV`                                  | `production` enables stricter logging and Helmet                       |
| `CORS_ORIGIN`                               | Comma-separated allowed origins when using cross-origin SPA + cookies  |
| `JSON_LIMIT`                                | Optional; max JSON body size (default `2mb`)                           |

### Frontend

Copy **`frontend/.env.example`** to **`frontend/.env`** if needed:

| Variable       | Purpose                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VITE_API_URL` | Leave **empty** for local dev so the Vite **`/api` proxy** is used (same-origin cookies). Or set the full backend URL if you call the API directly (then configure backend `CORS_ORIGIN`). |

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
copy .env.example .env   # Windows; or cp on Unix - then edit .env
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
copy .env.example .env   # optional - set VITE_API_URL if API is not on localhost:3000
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`). You will land on the **home** page; use **Sign in** to open the notebook at **`/app`** (sessions and API calls use `credentials: 'include'`; with the default empty `VITE_API_URL`, the dev server proxies `/api` to the backend).

---

## Git / repo hygiene

- Do **not** commit: `.env`, `node_modules/`, build output, logs, local uploads under `data/uploads/`.
- The repo includes `.env.example` templates under `backend/` and `frontend/`.

### 4. Production build (frontend)

```bash
cd frontend
npm run build
```

Serve the **`frontend/dist`** static files with any static host or reverse proxy, and point **`VITE_API_URL`** (at build time) to your public API URL.

### 5. Production API

- Set **`NODE_ENV=production`**
- Set a strong **`SESSION_SECRET`**, **`FRONTEND_URL`**, and **`PUBLIC_API_URL`** (or explicit **`GOOGLE_CALLBACK_URL`**)
- Configure **`CORS_ORIGIN`** to your frontend origin(s) when the SPA and API are on different sites
- Configure **SMTP** for email OTP, or rely on **Google-only** sign-in
- Run **`npm start`** behind a process manager (systemd, PM2, Docker, etc.)
- Use **`GET /health`** for load balancer health checks
- Terminate TLS at the edge; set **`COOKIE_SECURE=true`** so session cookies are only sent over HTTPS

---

## Deployment guide (AWS EC2)

This is a practical “single VM” deployment pattern:
- **Nginx** serves the frontend and proxies `/api` to the backend
- **Backend** runs as a **systemd** service
- **PostgreSQL** runs on **RDS** (recommended) or locally on the instance

### Architecture (recommended)
- **Frontend**: `https://yourdomain.com/` (static files)
- **API**: `https://yourdomain.com/api/*` (same domain → simpler cookie/session behavior)

### Step-by-step (Ubuntu 22.04 example)

1) **Provision**
- EC2 instance + security group allowing inbound **80/443** and **22**.

2) **Install packages**
- Node.js 18+, nginx, and optionally PostgreSQL (skip if using RDS).

3) **Deploy code**
- Clone the repository to e.g. `/opt/duenote`.

4) **Configure backend**
- Copy `backend/.env.example` → `backend/.env`.
- Minimum production values:
  - `NODE_ENV=production`
  - `DATABASE_URL=...` (RDS or local)
  - `SESSION_SECRET=...` (32+ random chars)
  - `FRONTEND_URL=https://yourdomain.com`
  - `PUBLIC_API_URL=https://yourdomain.com`
  - `COOKIE_SECURE=true`
  - `DEEPL_AUTH_KEY=...`
  - SMTP vars if you want email OTP in production

5) **Build frontend**

```bash
cd frontend
npm ci
npm run build
```

Copy `frontend/dist` to a web directory, e.g. `/var/www/duenote/`.

6) **Run backend with systemd**
- Create a service that runs `npm ci` (once) and `npm start` in `backend/`.
- Ensure it loads environment from `backend/.env` (or equivalent).

7) **Nginx**
- Serve `/var/www/duenote` at `/`
- Proxy `/api/` to the backend (e.g. `http://127.0.0.1:3000`)
- **SPA fallback is required** so routes like `/app` return `index.html` (Vue Router history mode)

An example config is included in this repo:
- `deploy/nginx/duenote.conf`

8) **HTTPS**
- Use Let’s Encrypt (certbot) or your preferred method.
- Keep `COOKIE_SECURE=true` behind HTTPS.

9) **Verify**
- `GET /health` returns `{ ok: true, env: "production" }`
- Login works (Google and/or email OTP)
- Translation works (DeepL key set)

### Why `/app` must be handled by nginx
Google OAuth redirects to `${FRONTEND_URL}/app` after sign-in. `/app` is a **client-side route** (Vue Router) and not a physical file. Your web server must serve `index.html` for `/app` via an SPA fallback like:

```
try_files $uri $uri/ /index.html;
```

Without that line, `/app` will 404 in production.

---

## Git / repo hygiene

- Do **not** commit: `.env`, `node_modules/`, build output, logs, local uploads under `data/uploads/`.
- The repo includes `.env.example` templates under `backend/` and `frontend/`.

## Security notes

- **Never commit** real `.env` files; use `.env.example` as a template.
- **DeepL keys**, **`SESSION_SECRET`**, and **database credentials** stay on the server only.
- **Courses and workbooks** are scoped by `user_id`; API routes do not trust client-supplied user ids for authorization.
- Rate limits apply to **auth** and **OTP** endpoints; prefer **HTTPS** and **`COOKIE_SECURE`** in production.

---

## License

Private / project-specific - add a license file if you distribute the code.
