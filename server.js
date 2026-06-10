// Open Course Builder - Express + JSON file DB
const express = require('express');
const { v4: uuid } = require('uuid');
const fs = require('fs');
const path = require('path');
// dotenv loads .env into process.env before we read GROQ_API_KEY below.
require('dotenv').config();
// Groq SDK is CommonJS-compatible (type=commonjs in its package.json), so
// `require()` works alongside the rest of this file. The client is only
// constructed when GROQ_API_KEY is set; routes surface a clear 503 if not.
const Groq = require('groq-sdk');

const ROOT = __dirname;
const DB_DIR = path.join(ROOT, 'db');
const PORT = process.env.PORT || 3000;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Lazily-built singleton. We only construct once and only when the key is
// present, so a misconfigured env does not crash server startup.
let _groq = null;
function getGroq() {
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) return null;
  if (!_groq) _groq = new Groq({ apiKey: key });
  return _groq;
}

// --- Ensure folders / db exist ---------------------------------------------
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

// --- Storage layer ---------------------------------------------------------
// Each course lives in its own file at db/<courseId>.json. The full course
// object (id, title, description, createdAt, updatedAt, lessons) is stored
// verbatim. This makes individual courses trivially copy-pasteable / shareable
// and avoids rewriting the whole DB for every lesson change.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coursePath(id) {
  // Defence-in-depth: refuse to build a path that escapes db/.
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    const err = new Error('Invalid course id');
    err.status = 400;
    throw err;
  }
  return path.join(DB_DIR, `${id}.json`);
}

function readCourse(id) {
  const file = coursePath(id);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const course = JSON.parse(raw);
    if (!course || typeof course !== 'object' || !course.id) {
      const err = new Error('Corrupt course file');
      err.status = 500;
      throw err;
    }
    // Backwards-compat: courses created before the tasks feature don't have
    // a `tasks` field. Always hand callers a valid array so the rest of the
    // code (and the frontend) can iterate without null checks.
    if (!Array.isArray(course.tasks)) course.tasks = [];
    // Same idea for the new metadata fields: authors / tags / courseLanguage
    // were added later, so old course files won't have them. We materialise
    // them as empty arrays on every read so the UI can render them
    // unconditionally and `JSON.stringify` of a round-trip is stable.
    if (!Array.isArray(course.authors)) course.authors = [];
    if (!Array.isArray(course.tags)) course.tags = [];
    if (!Array.isArray(course.courseLanguage)) course.courseLanguage = [];
    return course;
  } catch (err) {
    if (err.code === 'ENOENT') {
      const e = new Error('Course not found');
      e.status = 404;
      throw e;
    }
    throw err;
  }
}

function writeCourse(course) {
  if (!course || !course.id) {
    const err = new Error('Course must have an id');
    err.status = 400;
    throw err;
  }
  const file = coursePath(course.id);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(course, null, 2));
  fs.renameSync(tmp, file);
  return course;
}

function deleteCourseFile(id) {
  const file = coursePath(id);
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function listAllCourses() {
  const entries = fs.readdirSync(DB_DIR, { withFileTypes: true });
  const courses = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    // Skip stray temp files from interrupted writes
    if (entry.name.includes('.tmp-')) continue;
    const id = entry.name.replace(/\.json$/, '');
    if (!UUID_RE.test(id)) continue;
    try {
      courses.push(readCourse(id));
    } catch (err) {
      console.error(`Skipping unreadable course file ${entry.name}:`, err.message);
    }
  }
  // Newest-updated first, so the UI's default ordering is intuitive.
  courses.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return courses;
}

function findLesson(course, lessonId) {
  return course.lessons.find((l) => l.id === lessonId);
}

// Detect resource type. Only three resource types are supported: `link` (any
// web URL), `text` (plain text resource body), and `markdown` (markdown
// resource body). Local file uploads are intentionally not supported.

// --- Course metadata normalisers ------------------------------------------
// `authors` is an array of { authorName, authorLink }. We accept whatever the
// client sends and clamp it to that shape:
//   - drop entries without a non-empty authorName (the link alone is useless)
//   - trim the name
//   - if authorLink is empty, the entry is kept as name-only (no icon shown)
//   - if authorLink is present, it must be a safe http(s) URL or we drop the
//     link (we still keep the author name) so a bad input can't open javascript:
//     or file:// URIs in a new tab
// `tags` and `courseLanguage` are flat string arrays. We trim, drop empties,
// de-dupe (case-insensitive for tags, case-sensitive for languages — "en" and
// "EN" are different languages but the same tag), and cap the total length of
// a single item so a pathological paste can't bloat the file.
function normalizeAuthors(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const name = String(raw.authorName || '').trim();
    if (!name) continue;
    if (name.length > 120) continue;
    let link = String(raw.authorLink || '').trim();
    if (link) {
      if (!isSafeHttpUrl(link)) {
        // Bad URL — keep the name but discard the link rather than rejecting
        // the whole author, so a typo in one field doesn't lose the rest.
        link = '';
      } else if (link.length > 500) {
        link = '';
      }
    }
    const key = `${name.toLowerCase()}|${link.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ authorName: name, authorLink: link });
    if (out.length >= 20) break; // hard cap
  }
  return out;
}

function isSafeHttpUrl(value) {
  if (typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch (_) { return false; }
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function normalizeTagList(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (raw == null) continue;
    const tag = String(raw).trim();
    if (!tag) continue;
    if (tag.length > 40) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= 30) break;
  }
  return out;
}

function normalizeLanguageList(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (raw == null) continue;
    const lang = String(raw).trim();
    if (!lang) continue;
    if (lang.length > 40) continue;
    if (seen.has(lang)) continue;
    seen.add(lang);
    out.push(lang);
    if (out.length >= 20) break;
  }
  return out;
}
function detectType(input) {
  if (!input) return 'text';
  const value = String(input).trim();
  const lower = value.toLowerCase();

  // Markdown file extension
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';

  // Plain-text file extension
  if (lower.endsWith('.txt')) return 'text';

  // Any http(s) URL is a `link`
  if (/^https?:\/\//.test(lower)) return 'link';

  // Anything else that looks like a path/identifier is also a `link` so the
  // user can still save it (e.g. a domain without scheme: "example.com/foo").
  return 'link';
}

// --- App -------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(ROOT, 'public')));

// --- Courses ---------------------------------------------------------------
app.get('/api/courses', (_req, res) => {
  res.json(listAllCourses());
});

app.get('/api/courses/:id', (req, res) => {
  try {
    res.json(readCourse(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post('/api/courses', (req, res) => {
  const {
    title = 'Untitled Course',
    description = '',
    lessons = [],
    authors,
    tags,
    courseLanguage,
  } = req.body || {};
  if (!title.trim()) return res.status(400).json({ error: 'Title is required' });

  const now = new Date().toISOString();
  const course = {
    id: uuid(),
    title: title.trim(),
    description: description.trim(),
    createdAt: now,
    updatedAt: now,
    lessons: (Array.isArray(lessons) ? lessons : []).map((l) => normalizeLesson(l)),
    authors: normalizeAuthors(authors),
    tags: normalizeTagList(tags),
    courseLanguage: normalizeLanguageList(courseLanguage),
    tasks: [],
  };

  writeCourse(course);
  res.status(201).json(course);
});

app.put('/api/courses/:id', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const { title, description, authors, tags, courseLanguage } = req.body || {};
  if (typeof title === 'string') course.title = title.trim() || course.title;
  if (typeof description === 'string') course.description = description.trim();
  // Only overwrite the metadata arrays when the client actually sends them,
  // so an edit that only changes the title/description doesn't wipe the
  // authors/tags/languages that were already stored.
  if (Array.isArray(authors)) course.authors = normalizeAuthors(authors);
  if (Array.isArray(tags)) course.tags = normalizeTagList(tags);
  if (Array.isArray(courseLanguage)) course.courseLanguage = normalizeLanguageList(courseLanguage);
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.json(course);
});

app.delete('/api/courses/:id', (req, res) => {
  try {
    // readCourse validates the id; if it doesn't exist we still treat that
    // as a 404 even though the file is gone.
    readCourse(req.params.id);
    deleteCourseFile(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// --- Lessons ---------------------------------------------------------------
function normalizeLesson(input) {
  const title = (input.title || 'Untitled lesson').toString().trim() || 'Untitled lesson';
  const notes = (input.notes || '').toString();
  // User-authored learning note (markdown). Distinct from `notes` which is the
  // resource's own text content for text/markdown lessons.
  const lessonNote = (input.lessonNote || '').toString();
  // resource can be a string URL/path OR an object {type, value, name}
  let resource = input.resource ?? '';
  let type = (input.type || '').toString().toLowerCase();

  if (typeof resource === 'string') {
    if (!type) type = detectType(resource);
  } else if (resource && typeof resource === 'object') {
    type = (resource.type || type || 'text').toString().toLowerCase();
    resource = resource.value || resource.url || resource.path || '';
  }

  // Clamp the type to one of the three supported resource types. Legacy data
  // (e.g. `youtube`, `video`, `pdf`, `image`, `audio`, `website`, `article`)
  // is mapped to the closest equivalent so old lessons keep rendering.
  const allowed = new Set(['link', 'text', 'markdown']);
  const legacyMap = {
    youtube: 'link',
    website: 'link',
    article: 'link',
    image: 'link',
    video: 'link',
    audio: 'link',
    pdf: 'link',
  };
  let normalisedType = (legacyMap[type] || type || 'text').toString().toLowerCase();
  if (!allowed.has(normalisedType)) normalisedType = 'text';

  return {
    id: uuid(),
    title,
    type: normalisedType,
    resource: typeof resource === 'string' ? resource : '',
    notes,
    lessonNote,
    isCompleted: Boolean(input.isCompleted),
    completeDate: input.isCompleted ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  };
}

app.post('/api/courses/:id/lessons', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const lesson = normalizeLesson(req.body || {});
  course.lessons.push(lesson);
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.status(201).json(lesson);
});

app.put('/api/courses/:id/lessons/:lessonId', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const lesson = findLesson(course, req.params.lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

  const { title, type, resource, notes, isCompleted } = req.body || {};
  if (typeof title === 'string' && title.trim()) lesson.title = title.trim();
  if (typeof notes === 'string') lesson.notes = notes;
  if (req.body && typeof req.body.lessonNote === 'string') lesson.lessonNote = req.body.lessonNote;
  if (typeof isCompleted === 'boolean') {
    const was = lesson.isCompleted;
    lesson.isCompleted = isCompleted;
    // Only set a completeDate the first time the lesson flips true. Clearing
    // isCompleted wipes completeDate so the heatmap reflects the new state.
    if (isCompleted && !was) lesson.completeDate = new Date().toISOString();
    else if (!isCompleted) lesson.completeDate = null;
  }

  if (resource !== undefined) {
    if (resource && typeof resource === 'object') {
      lesson.type = (resource.type || lesson.type || 'text').toString().toLowerCase();
      lesson.resource = resource.value || resource.url || resource.path || '';
    } else {
      lesson.resource = String(resource);
      if (type) lesson.type = String(type).toLowerCase();
      else if (!lesson.resource) lesson.type = 'text';
      else lesson.type = detectType(lesson.resource);
    }
  } else if (type) {
    lesson.type = String(type).toLowerCase();
  }

  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.json(lesson);
});

app.patch('/api/courses/:id/lessons/:lessonId/toggle', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const lesson = findLesson(course, req.params.lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  lesson.isCompleted = !lesson.isCompleted;
  // Stamp completeDate when flipping on, clear it when flipping off.
  if (lesson.isCompleted) lesson.completeDate = new Date().toISOString();
  else lesson.completeDate = null;
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.json(lesson);
});

// Real-time save for the lesson's own learning note (markdown). Called on
// every keystroke (debounced client-side). Only updates the `lessonNote`
// field so we don't have to read/rewrite the whole course to persist typing.
app.put('/api/courses/:id/lessons/:lessonId/note', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const lesson = findLesson(course, req.params.lessonId);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

  const note = (req.body && typeof req.body.lessonNote === 'string') ? req.body.lessonNote : null;
  if (note === null) return res.status(400).json({ error: 'lessonNote must be a string' });

  // Cap to a generous size to keep individual course files small + sane.
  if (note.length > 500 * 1024) {
    return res.status(413).json({ error: 'lessonNote too large (>500KB)' });
  }

  lesson.lessonNote = note;
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.json({ ok: true, lessonNote: lesson.lessonNote, updatedAt: course.updatedAt });
});

// Reorder the lessons within a course. The client sends the full new order
// as `{ order: [lessonId, lessonId, ...] }`. Any lessons not mentioned are
// appended at the end in their previous relative order, so a missing id is
// never silently dropped. Unknown ids are ignored.
app.patch('/api/courses/:id/lessons/reorder', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const order = Array.isArray(req.body && req.body.order) ? req.body.order : null;
  if (!order) return res.status(400).json({ error: 'order must be an array of lesson ids' });

  const byId = new Map(course.lessons.map((l) => [l.id, l]));
  const seen = new Set();
  const next = [];
  for (const id of order) {
    if (typeof id !== 'string') continue;
    const lesson = byId.get(id);
    if (lesson && !seen.has(id)) {
      next.push(lesson);
      seen.add(id);
    }
  }
  // Append anything the client didn't mention, preserving existing order.
  for (const lesson of course.lessons) {
    if (!seen.has(lesson.id)) next.push(lesson);
  }
  course.lessons = next;
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.json(course);
});

app.delete('/api/courses/:id/lessons/:lessonId', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const before = course.lessons.length;
  course.lessons = course.lessons.filter((l) => l.id !== req.params.lessonId);
  if (course.lessons.length === before) return res.status(404).json({ error: 'Lesson not found' });
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.json({ ok: true });
});

// --- Tasks -----------------------------------------------------------------
// A task is an LLM-graded exercise: an instructor writes a Markdown question
// and a hidden "LLM instruction" (system prompt). A learner submits a free-
// text answer, the server asks Groq to evaluate it, and the resulting feedback
// is stored on the task so the learner can review it later. Submissions are
// kept (with timestamps) so the learner sees history, not just the latest try.

function ensureTasksArray(course) {
  // Defensive: courses imported from older exports may not have a `tasks`
  // field. We always read/write through this helper so the rest of the
  // route handlers can assume `course.tasks` is an array.
  if (!Array.isArray(course.tasks)) course.tasks = [];
  return course.tasks;
}

function findTask(course, taskId) {
  return ensureTasksArray(course).find((t) => t.id === taskId);
}

function normalizeTask(input) {
  // Title is the only required user-facing field. The question and instruction
  // can technically be empty, but in practice the instructor must fill them in
  // for the task to be useful. We do not enforce that here so the API stays
  // forgiving; the UI validates.
  const title = (input.title || 'Untitled task').toString().trim() || 'Untitled task';
  const question = (input.question || '').toString();
  const instruction = (input.instruction || '').toString();
  return {
    id: uuid(),
    title,
    question,
    instruction,
    createdAt: new Date().toISOString(),
    submissions: [],
  };
}

function normalizeSubmission(input) {
  // Truncate very long learner answers so a single submission can't bloat the
  // course file. 200KB is far above any reasonable short answer and well under
  // any practical model context window.
  let answer = (input && typeof input.answer === 'string') ? input.answer : '';
  if (answer.length > 200 * 1024) answer = answer.slice(0, 200 * 1024);
  return {
    id: uuid(),
    answer,
    createdAt: new Date().toISOString(),
  };
}

app.post('/api/courses/:id/tasks', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const task = normalizeTask(req.body || {});
  ensureTasksArray(course).push(task);
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.status(201).json(task);
});

app.delete('/api/courses/:id/tasks/:taskId', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const tasks = ensureTasksArray(course);
  const before = tasks.length;
  course.tasks = tasks.filter((t) => t.id !== req.params.taskId);
  if (course.tasks.length === before) return res.status(404).json({ error: 'Task not found' });
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.json({ ok: true });
});

// Submit a learner's answer to a task. Calls Groq with the task's instruction
// (system role) and the question + answer (user role), then stores the
// model's feedback on the task as a new submission. Returns the saved
// submission (with feedback) so the UI can render it immediately.
app.post('/api/courses/:id/tasks/:taskId/submit', async (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const task = findTask(course, req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const groq = getGroq();
  if (!groq) {
    return res.status(503).json({
      error: 'GROQ_API_KEY is not configured on the server. Set it in .env and restart.',
    });
  }

  const submission = normalizeSubmission(req.body || {});
  if (!submission.answer.trim()) {
    return res.status(400).json({ error: 'Answer cannot be empty' });
  }

  // Build the prompt. The instructor's instruction is the system message so
  // it always wins over user content if the learner tries to inject
  // instructions of their own. The user message carries the question and
  // the learner's attempt, with clear delimiters so the model can find them.
  const systemMsg = (task.instruction && task.instruction.trim())
    ? task.instruction.trim()
    : 'You are a helpful tutor. Read the learner\'s answer to the question and give concise, constructive feedback. Be kind, specific, and brief.';
  const userMsg =
    `Question:\n${task.question || '(no question provided)'}\n\n` +
    `Learner's answer:\n${submission.answer}\n\n` +
    `Reply with feedback only.`;

  let feedback = '';
  try {
    const completion = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.4,
    });
    feedback = (completion.choices && completion.choices[0] && completion.choices[0].message
      && typeof completion.choices[0].message.content === 'string')
      ? completion.choices[0].message.content.trim()
      : '';
    if (!feedback) feedback = '(The model returned an empty response.)';
  } catch (err) {
    // Surface a clean error to the client. The Groq SDK throws a single Error
    // whose message usually includes the HTTP status (e.g. "401 ..." or
    // "429 ...") and the human-readable reason. We pass it through.
    const status = (err && err.status) ? err.status : 502;
    return res.status(status).json({
      error: 'Groq request failed: ' + ((err && err.message) ? err.message : String(err)),
    });
  }

  submission.feedback = feedback;
  if (!Array.isArray(task.submissions)) task.submissions = [];
  task.submissions.push(submission);
  course.updatedAt = new Date().toISOString();
  writeCourse(course);
  res.status(201).json({ submission, taskId: task.id });
});

// --- Sync the db/ folder to the remote (git add/commit/push) ---------------
// Runs `git add db/ && git commit -m "synced" && git push origin main` from
// the server's cwd. Returns a small JSON report so the UI can toast the result.
// If there's nothing to commit, the commit step is skipped (no error). If the
// push fails (e.g. no network), the commit is kept locally and the error is
// reported back to the caller.
app.post('/api/sync', (_req, res) => {
  const { execFile } = require('child_process');

  function run(cmd, args) {
    return new Promise((resolve) => {
      execFile(cmd, args, { cwd: ROOT, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    });
  }

  (async () => {
    try {
      // Make sure git sees a change worth committing.
      const status = await run('git', ['status', '--porcelain', '--', 'db/']);
      if (status.err) {
        return res.status(500).json({ ok: false, error: 'git status failed: ' + status.stderr.trim() });
      }
      const dirty = status.stdout.trim().length > 0;

      if (dirty) {
        const add = await run('git', ['add', 'db/']);
        if (add.err) return res.status(500).json({ ok: false, error: 'git add failed: ' + add.stderr.trim() });

        const commit = await run('git', ['commit', '-m', 'synced']);
        // Non-zero exit from commit is usually "nothing to commit" (race) — treat as skip.
        if (commit.err && !/nothing to commit/i.test(commit.stderr + commit.stdout)) {
          return res.status(500).json({ ok: false, error: 'git commit failed: ' + (commit.stderr || commit.stdout).trim() });
        }
      }

      const push = await run('git', ['push', 'origin', 'main']);
      if (push.err) {
        return res.json({
          ok: false,
          committed: dirty,
          pushed: false,
          pushSkipped: false,
          error: 'git push failed: ' + (push.stderr || push.stdout).trim(),
        });
      }

      return res.json({
        ok: true,
        committed: dirty,
        commitSkipped: !dirty,
        pushed: true,
        pushSkipped: false,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  })();
});

// --- Export / import individual course JSON files -------------------------
// GET /api/courses/:id/export
//   Sends the course object back as a downloadable .json file. Filename is
//   derived from the title (sanitised) so it lands sensibly in the user's
//   downloads folder.
// POST /api/courses/import
//   Accepts a course JSON in the body, mints a fresh id / lesson ids so the
//   imported course never collides with the recipient's existing data, and
//   writes it into db/. Returns the new course.

function safeFilenameBase(title) {
  return (title || 'course')
    .toString()
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'course';
}

app.get('/api/courses/:id/export', (req, res) => {
  let course;
  try { course = readCourse(req.params.id); }
  catch (err) { return res.status(err.status || 500).json({ error: err.message }); }

  const filename = `${safeFilenameBase(course.title)}-${course.id.slice(0, 8)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(course, null, 2));
});

app.post('/api/courses/import', (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'A course JSON object is required in the request body' });
  }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return res.status(400).json({ error: 'Imported course is missing a title' });
  }

  const now = new Date().toISOString();
  const lessons = Array.isArray(body.lessons) ? body.lessons : [];
  // Re-normalise so every lesson gets a fresh id and any missing fields are
  // filled in. This keeps the imported course consistent with courses created
  // through the normal UI.
  const normalisedLessons = lessons.map((l) => normalizeLesson(l));

  const course = {
    id: uuid(),
    title: body.title.trim(),
    description: typeof body.description === 'string' ? body.description.trim() : '',
    createdAt: now,
    updatedAt: now,
    lessons: normalisedLessons,
    authors: normalizeAuthors(body.authors),
    tags: normalizeTagList(body.tags),
    courseLanguage: normalizeLanguageList(body.courseLanguage),
    tasks: [],
  };

  writeCourse(course);
  res.status(201).json(course);
});

// --- Fallback to index.html for client routes ------------------------------
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Open Course Builder running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use.\n` +
        `  - Find the process:  netstat -ano | findstr :${PORT}\n` +
        `  - Kill it:           taskkill /PID <pid> /F\n` +
        `  - Or use a different port:  set PORT=3001  (cmd)  /  $env:PORT=3001  (powershell), then npm start\n`
    );
    process.exit(1);
  }
  throw err;
});
