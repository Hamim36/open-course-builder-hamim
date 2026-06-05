# Open Course Builder

A self-hosted, single-page learning management system for building and studying courses
**offline**. No database, no cloud dependency — just Node.js and your local files.

Open Course Builder lets you create courses made of modules and topics, attach
YouTube videos, local media (video / audio / image / PDF / markdown / text) or
external websites, and track your study time with a GitHub-style 90-day heatmap,
weekly bar chart, completion streaks, and per-topic notes.

---

## Features

- **Courses** — Create, edit, and delete courses with nested modules and topics.
- **Rich content** — YouTube embeds, local file uploads, or external websites
  (with embeddability check).
- **Progress tracking** — 90-day heatmap, weekly bar chart, completion streaks,
  and per-module progress.
- **Sessions** — Automatic study-session tracker with 30-second heartbeats.
- **Notes** — Per-topic notes with 1.5-second debounced autosave.
- **Git sync** — Save progress to a Git repository with intelligent, diff-aware
  commit messages.
- **Export / Import** — Full course JSON roundtrip for backup or sharing.
- **Offline-first** — All uploaded files live in `offline-files/` and are
  served directly by Node.
- **Desktop-first responsive UI** with dark theme.

---

## Tech Stack

| Layer       | Tools                                                                |
| ----------- | -------------------------------------------------------------------- |
| Frontend    | Vanilla JS (no framework), Bootstrap 5, Bootstrap Icons, Chart.js,   |
|             | `marked` + `DOMPurify` for safe markdown rendering.                  |
| Backend     | Node.js + Express, `multer` for uploads, `simple-git` for Git sync,  |
|             | `fs-extra` for atomic file writes, `uuid` for ID generation.         |
| Storage     | JSON files in `db/`, binary files in `offline-files/<topicId>/`.     |

---

## Installation

Requirements: **Node.js 18+** and **npm**.

```bash
# 1. Clone
git clone https://github.com/rayan2162/open-course-builder.git
cd open-course-builder

# 2. Install dependencies
npm install

# 3. (Optional) Configure Git sync
cp .env.example .env
#   then edit .env and set GIT_REMOTE_URL / GIT_USER_NAME / GIT_USER_EMAIL

# 4. Start the server
npm start
```

The server boots on **http://localhost:3000** by default (override with `PORT`
in `.env`).

For live-reload during development:

```bash
npm run dev
```

---

## Usage

1. **Create a course** — open the *Course* dropdown in the navbar and pick
   *Create Course*. Add modules and topics; topic types are auto-detected from
   the URL or local-file picker.
2. **Study** — click any topic card to open the viewer. Watch the content, take
   notes (autosaved), and click *Mark Complete* when done.
3. **Track progress** — the circular progress widget, streak counter, and
   mini-heatmap in the navbar all update live. Click the progress circle to
   open the full heatmap panel.
4. **Configure Git sync** — open *Git Config* from the navbar, paste your
   remote URL, and save. The next time you click *Save Progress*, the server
   commits the latest `db/*.json` and pushes with a meaningful message
   (e.g. *“Completed: Topic 1”* or *“Updated notes for Topic 1”*).
5. **Export / Import** — use the *Export* and *Import* menu items to back up
   or restore a course as JSON. *With Progress* preserves completion state;
   *Template* exports a clean copy.

---

## Project Structure

```
open-course-builder/
├── db/                          JSON data files (course, stats, temp)
│   ├── course-info.json         Authoritative course state
│   ├── stats.json               Progress, streak, heatmap, sessions
│   ├── create-temp.json         Draft state for course creation
│   └── modify-temp.json         Draft state for course modification
├── offline-files/               Uploaded topic media (gitignored)
├── public/
│   └── js/                      Split frontend modules (no bundler)
│       ├── 00-core.js           AppState, API client, helpers
│       ├── 01-toast-session-navbar.js
│       ├── 02-heatmap.js        Heatmap panel + weekly chart
│       ├── 03-sidebar-main.js   Sidebar list + main content area
│       ├── 04-topic-viewer.js   Topic viewer modal
│       ├── 05-modals-create-modify.js
│       ├── 06-modals-import-export-git.js
│       └── 07-init.js           DOMContentLoaded bootstrap
├── index.html                   Frontend shell
├── server.js                    Express backend
├── package.json
├── .env.example                 Environment template
├── .gitignore
└── README.md
```

---

## API Endpoints

### Course and stats

| Method | Path                  | Description                          |
| ------ | --------------------- | ------------------------------------ |
| GET    | `/api/course`         | Get current course (wrapped).        |
| GET    | `/api/courses`        | List all available courses.          |
| GET    | `/api/stats`          | Get stats (progress, heatmap, etc.). |
| GET    | `/api/config`         | Get server configuration.            |
| GET    | `/api/settings`       | Get public settings (port, git user, |
|        |                       | git email, version, etc.).           |
| GET    | `/api/temp-course`    | Get the temporary / preview course.  |
| POST   | `/api/course/create`  | Create a new course.                 |
| POST   | `/api/course/import`  | Import a course from JSON file.      |
| GET    | `/api/course/export`  | Export current course as JSON.       |

### Topics

| Method | Path                                  | Description                  |
| ------ | ------------------------------------- | ---------------------------- |
| PATCH  | `/api/topics/:topicId/complete`       | Toggle topic completion.     |
| PATCH  | `/api/topics/:topicId/notes`          | Save topic notes.            |
| POST   | `/api/topics/:topicId/visit`          | Record a topic visit.        |

### Sessions

| Method | Path                                       | Description            |
| ------ | ------------------------------------------ | ---------------------- |
| POST   | `/api/session/start`                       | Begin a study session. |
| PATCH  | `/api/session/:sessionId/heartbeat`        | Heartbeat tick.        |
| POST   | `/api/session/:sessionId/end`              | End a study session.   |

### Temp drafts (autosave)

| Method | Path                  | Description                          |
| ------ | --------------------- | ------------------------------------ |
| GET    | `/api/temp/create`    | Get the create-course draft.         |
| PUT    | `/api/temp/create`    | Save the create-course draft.        |
| DELETE | `/api/temp/create`    | Clear the create-course draft.       |
| GET    | `/api/temp/modify`    | Get the modify-course draft.         |
| POST   | `/api/temp/modify/start` | Begin a modify session.            |
| PUT    | `/api/temp/modify`    | Save the modify-course draft.        |
| POST   | `/api/temp/modify/save` | Commit modify changes to course.    |
| DELETE | `/api/temp/modify`    | Clear the modify-course draft.       |

### File uploads

| Method | Path                                  | Description                          |
| ------ | ------------------------------------- | ------------------------------------ |
| POST   | `/api/files/upload`                   | Upload a file for a topic.           |
| GET    | `/api/files/list/:topicId`            | List files for a topic.              |
| DELETE | `/api/files/:topicId/:filename`       | Delete a file (with path-traversal   |
|        |                                       | protection).                         |

### Git sync

| Method | Path                  | Description                                |
| ------ | --------------------- | ------------------------------------------ |
| GET    | `/api/git/status`     | Get current Git status (remote, branch).   |
| GET    | `/api/git/config`     | Get Git configuration.                     |
| POST   | `/api/git/config`     | Update Git configuration.                  |
| POST   | `/api/git/save`       | Commit and push progress with intelligent  |
|        |                       | commit message.                            |
| POST   | `/api/git/sync`       | One-shot sync (alias).                     |

### Misc

| Method | Path                              | Description                              |
| ------ | --------------------------------- | ---------------------------------------- |
| POST   | `/api/proxy/check-embeddable`     | Check whether a URL is iframe-embeddable.|

All responses follow the shape `{ success: true, … }` on success or
`{ success: false, error, details }` on failure.

---

## Data Schemas

### `db/course-info.json`

```json
{
  "schema_version": "1.0.0",
  "last_modified": "ISO-8601",
  "course": {
    "id": "uuid",
    "name": "string",
    "description": "string",
    "modules": [
      { "id": "uuid", "name": "string", "order": 0,
        "topics": [ /* see Topic */ ] }
    ]
  }
}
```

### `db/stats.json`

```json
{
  "schema_version": "1.0.0",
  "last_modified": "ISO-8601",
  "progress": { "total_topics": 0, "completed_topics": 0,
                "completion_percentage": 0,
                "module_progress": { /* moduleId -> {total, completed, percentage} */ },
                "upcoming_lessons": [ /* topicId */ ] },
  "streak": { "current": 0, "longest": 0, "last_study_date": "YYYY-MM-DD" },
  "heatmap": { "YYYY-MM-DD": { "total_seconds": 0, "sessions": 0 } },
  "weekly_study": { "week_starting": "YYYY-MM-DD", "days": [0,0,0,0,0,0,0] },
  "sessions": [],
  "upcoming_lessons": [ /* topicId */ ]
}
```

### Topic shape

```json
{
  "id": "uuid",
  "name": "string",
  "description": "string",
  "order": 0,
  "content_type": "youtube|website|video|audio|image|pdf|markdown|text",
  "url": "string",
  "local_file_path": "string",
  "local_file_name": "string",
  "text_content": "string",
  "is_completed": false,
  "completed_at": null,
  "notes": "string",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

---

## Environment Variables

| Variable          | Default                | Description                         |
| ----------------- | ---------------------- | ----------------------------------- |
| `PORT`            | `3000`                 | HTTP port.                          |
| `GIT_REMOTE_URL`  | *(empty)*              | Git remote to push progress to.     |
| `GIT_USER_NAME`   | *(empty)*              | Git author name.                    |
| `GIT_USER_EMAIL`  | *(empty)*              | Git author email.                   |

Copy `.env.example` to `.env` to set them.

---

## Keyboard Shortcuts

| Shortcut        | Action                                |
| --------------- | ------------------------------------- |
| `n`             | New course                            |
| `m`             | Manage course                         |
| `i`             | Import course                         |
| `e`             | Export course                         |
| `g`             | Git config                            |
| `h`             | Toggle heatmap panel                  |
| `Ctrl + S`      | Save Git progress                     |
| `Ctrl + Shift + S` | Save Git progress (alternative)    |
| `Esc`           | Close any open modal                  |

Shortcuts are suppressed when typing in form fields.

---

## Security Notes

- **Path traversal** is blocked in file deletion and serving endpoints
  (`path.resolve(OFFLINE_FILES_DIR, …)`).
- **File type** is restricted to an allow-list
  (`mp4, mkv, webm, avi, mov, m4v, mp3, m4a, wav, ogg, flac, aac, jpg, jpeg,
  png, gif, svg, webp, heif, heic, avif, pdf, md, txt`) plus a 500 MB size cap.
- **Atomic writes** — `safeWriteJSON` writes to `*.tmp`, verifies the JSON
  parses back, then renames over the target and keeps a `*.backup`.
- **Course import** uses an in-memory `multer` instance, so uploaded JSON
  never touches the disk.

---

## Development

```bash
npm install
npm run dev     # nodemon, auto-restart on save
```

The frontend has no build step — `public/js/*.js` is loaded directly by
`index.html` in numeric order (`00-` through `07-`).

A jsdom-based smoke test lives at the project root (`smoke-ui.js`, gitignored)
and exercises every global, every modal wiring, and the real `POST /import`
and `GET /export` endpoints against a live server.

---

## Contributing

Pull requests are welcome. Please:

1. Keep API changes backward compatible (or bump `schema_version`).
2. Add / update the smoke test in `smoke-ui.js` for any new behaviour.
3. Run `node --check` on any touched JS file before committing.

---

## License

MIT — see `LICENSE` if present, or treat as MIT-licensed by default.