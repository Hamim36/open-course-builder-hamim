# Open Course Builder

A simple CRUD app that collects every kind of learning resource for a course in one place: YouTube links, articles, website URLs, PDFs, audio, video, images, and plain text notes. Backed by a single `db.json` file and a tiny Node/Express server.

## Stack
- **Frontend:** HTML, Bootstrap 5, vanilla JS (no build step).
- **Backend:** Node + Express, `multer` for file uploads, `uuid` for IDs.
- **Storage:** `db.json` (auto-created) + `uploads/` directory for uploaded files.

## Run
```bash
npm install
npm start
```
Then open http://localhost:3000

## Project layout
```
open-course-builder/
├── server.js        # Express API + static server
├── package.json
├── db.json          # JSON database (auto-created)
├── public/          # Static frontend
│   ├── index.html
│   ├── app.js
│   └── styles.css
└── uploads/         # Uploaded files land here
```

## API
- `GET    /api/courses` — list courses
- `POST   /api/courses` — create a course (with optional `lessons[]`)
- `GET    /api/courses/:id` — get one course
- `PUT    /api/courses/:id` — update title/description
- `DELETE /api/courses/:id` — delete a course
- `POST   /api/courses/:id/lessons` — add a lesson
- `PUT    /api/courses/:id/lessons/:lessonId` — update a lesson
- `PATCH  /api/courses/:id/lessons/:lessonId/toggle` — toggle `isCompleted`
- `DELETE /api/courses/:id/lessons/:lessonId` — delete a lesson
- `POST   /api/upload` (multipart `file`) — returns `{ name, path, size, mimetype }`

## Lesson shape
```json
{
  "id": "uuid",
  "title": "Flexbox basics",
  "type": "youtube | article | website | pdf | audio | video | image | text",
  "resource": "https://... or /uploads/file.pdf or ''",
  "notes": "free-form notes",
  "isCompleted": false,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

Resource type is auto-detected from the URL/extension. You can override it explicitly.
