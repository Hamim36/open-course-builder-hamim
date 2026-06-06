// Smoke test for markdown + drop zone UI changes
// Verifies:
//   1. Server: detectType('.md') -> 'markdown'
//   2. Server: create course with markdown lesson via API
//   3. Server: get course back, verify type==='markdown' and notes preserved
//   4. HTML: served index.html has #resourceMarkdownInput, #dropZone, marked+dompurify CDN
//   5. CSS:  served styles.css contains .preview-markdown and .drop-zone
//   6. App.js: contains renderMarkdown, dropZone handlers, markdown branches

const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    fail++;
    console.log(`  FAIL ${name}: ${err.message}`);
  }
};

const req = (method, urlPath, body) => new Promise((resolve, reject) => {
  const u = new URL(urlPath, BASE);
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const r = http.request({
    method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
    headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
  }, (res) => {
    let chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const buf = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try { json = JSON.parse(buf); } catch {}
      resolve({ status: res.statusCode, body: buf, json });
    });
  });
  r.on('error', reject);
  if (data) r.write(data);
  r.end();
});

(async () => {
  console.log('--- markdown smoke test ---');

  // Snapshot db.json
  const dbPath = path.join(__dirname, 'db.json');
  const dbBackup = fs.readFileSync(dbPath, 'utf8');
  const uploadsDir = path.join(__dirname, 'uploads');
  const uploadsBackup = fs.readdirSync(uploadsDir);

  try {
    let course, lesson;

    await t('POST /api/courses with markdown lesson', async () => {
      const md = '# Hello\n\nThis is **bold** and `code` and a [link](https://example.com).';
      const r = await req('POST', '/api/courses', {
        title: 'Markdown Test Course',
        description: 'Tests markdown rendering',
        lessons: [{ title: 'MD Lesson', type: 'markdown', notes: md, resource: '' }],
      });
      if (r.status !== 201) throw new Error(`status ${r.status}: ${r.body}`);
      course = r.json;
      if (!course.lessons || course.lessons.length !== 1) throw new Error('expected 1 lesson');
      lesson = course.lessons[0];
      if (lesson.type !== 'markdown') throw new Error(`expected type=markdown, got ${lesson.type}`);
      if (lesson.notes !== md) throw new Error('notes not preserved');
    });

    await t('GET /api/courses/:id returns markdown lesson', async () => {
      const r = await req('GET', `/api/courses/${course.id}`);
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      const md = r.json.lessons[0];
      if (md.type !== 'markdown') throw new Error(`type=${md.type}`);
      if (!md.notes.startsWith('# Hello')) throw new Error('notes lost');
    });

    await t('index.html has #resourceMarkdownInput', async () => {
      const r = await req('GET', '/');
      if (!r.body.includes('id="resourceMarkdownInput"')) throw new Error('missing markdown textarea');
    });

    await t('index.html has #dropZone', async () => {
      const r = await req('GET', '/');
      if (!r.body.includes('id="dropZone"')) throw new Error('missing drop zone');
    });

    await t('index.html has marked CDN', async () => {
      const r = await req('GET', '/');
      if (!/cdn.*marked/i.test(r.body)) throw new Error('missing marked CDN');
    });

    await t('index.html has dompurify CDN', async () => {
      const r = await req('GET', '/');
      if (!/cdn.*dompurify|dompurify.*cdn/i.test(r.body)) throw new Error('missing dompurify CDN');
    });

    await t('index.html has Markdown tab', async () => {
      const r = await req('GET', '/');
      if (!r.body.includes('data-tab="markdown"')) throw new Error('missing markdown tab button');
      if (!r.body.includes('data-pane="markdown"')) throw new Error('missing markdown tab pane');
    });

    await t('styles.css has .preview-markdown', async () => {
      const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
      if (!css.includes('.preview-markdown')) throw new Error('missing preview-markdown styles');
    });

    await t('styles.css has .drop-zone', async () => {
      const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
      if (!css.includes('.drop-zone')) throw new Error('missing drop-zone styles');
    });

    await t('styles.css has .type-pill.markdown', async () => {
      const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
      if (!/\.type-pill\.markdown/.test(css)) throw new Error('missing markdown type pill');
    });

    await t('app.js has renderMarkdown helper', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/function\s+renderMarkdown\s*\(/.test(js)) throw new Error('missing renderMarkdown');
      if (!js.includes('window.marked') || !js.includes('DOMPurify')) throw new Error('missing marked/dompurify usage');
    });

    await t('app.js has markdown icon', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/markdown:\s*'bi-markdown'/.test(js)) throw new Error('missing markdown icon in typeIcon');
    });

    await t('app.js has dropZone event handlers', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/els\.dropZone/.test(js)) throw new Error('missing els.dropZone');
      if (!/dragover/.test(js) || !/drop/.test(js)) throw new Error('missing dragover/drop handlers');
    });

    await t('app.js has markdown branch in saveLessonFromModal', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/activeTab\s*===\s*['"]markdown['"]/.test(js)) throw new Error('missing markdown branch in save');
    });

    await t('app.js has markdown branch in openPreview', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/type\s*===\s*['"]markdown['"]/.test(js)) throw new Error('missing markdown branch in openPreview');
    });

    await t('app.js has course draft type selector', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/lesson-draft-type/.test(js)) throw new Error('missing draft type selector');
      if (!/lesson-draft-notes/.test(js)) throw new Error('missing draft notes textarea');
    });

    await t('app.js renders markdown inline in renderCourseDetail', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      // find renderCourseDetail block
      if (!/renderMarkdown\(l\.notes\)/.test(js)) throw new Error('renderCourseDetail does not render markdown inline');
    });

    await t('app.js has lesson-open-btn for text/markdown', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/lesson-open-btn/.test(js)) throw new Error('missing lesson-open-btn');
      if (!/Open note/.test(js)) throw new Error('missing "Open note" label for text/markdown');
    });

    await t('app.js has lesson snippet for text/markdown', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/lesson-snippet/.test(js)) throw new Error('missing lesson-snippet');
    });

    await t('app.js openPreview skips loading for sync types', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/isSync\s*=\s*\(type\s*===\s*['"]text['"]\s*\|\|\s*type\s*===\s*['"]markdown['"]\)/.test(js)) {
        throw new Error('openPreview should skip loading for text/markdown');
      }
    });

    await t('styles.css has lesson-snippet styles', async () => {
      const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
      if (!/\.lesson-snippet/.test(css)) throw new Error('missing .lesson-snippet');
    });

    await t('styles.css has lesson-open-btn styles', async () => {
      const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
      if (!/\.lesson-open-btn/.test(css)) throw new Error('missing .lesson-open-btn');
    });

    // ---- Delete-course button on each card ----
    await t('app.js renderCourses has course-card-delete-btn', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/course-card-delete-btn/.test(js)) throw new Error('missing course-card-delete-btn in template');
      if (!/data-course-id=/.test(js)) throw new Error('missing data-course-id attribute');
    });

    await t('app.js wires card delete click handler with stopPropagation', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/course-card-delete-btn/.test(js)) throw new Error('missing handler binding');
      if (!/stopPropagation\s*\(\s*\)/.test(js)) throw new Error('card delete must stopPropagation to avoid opening course');
      if (!/deleteCourse\s*\(\s*btn\.dataset\.courseId\s*\)/.test(js)) {
        throw new Error('card delete must call deleteCourse(btn.dataset.courseId)');
      }
    });

    await t('app.js deleteCourse accepts an id parameter', async () => {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      if (!/async\s+function\s+deleteCourse\s*\(\s*id\s*\)/.test(js)) {
        throw new Error('deleteCourse should accept an optional id parameter');
      }
    });

    await t('styles.css has .course-card-delete-btn', async () => {
      const css = fs.readFileSync(path.join(__dirname, 'public', 'styles.css'), 'utf8');
      if (!/\.course-card-delete-btn/.test(css)) throw new Error('missing .course-card-delete-btn styles');
    });

    await t('DELETE /api/courses/:id works for card delete path', async () => {
      // Create + delete via the same path the card button uses.
      const c = await req('POST', '/api/courses', {
        title: 'Card Delete Test',
        description: 'created and deleted by smoke test',
        lessons: [],
      });
      if (c.status !== 201) throw new Error(`create failed status ${c.status}`);
      const d = await req('DELETE', `/api/courses/${c.json.id}`);
      if (d.status !== 200) throw new Error(`delete failed status ${d.status}: ${d.body}`);
      const g = await req('GET', `/api/courses/${c.json.id}`);
      if (g.status !== 404) throw new Error(`expected 404 after delete, got ${g.status}`);
    });

    // Cleanup
    await t('DELETE test course', async () => {
      const r = await req('DELETE', `/api/courses/${course.id}`);
      if (r.status !== 200) throw new Error(`status ${r.status}`);
    });

  } finally {
    // Restore db.json and uploads/
    fs.writeFileSync(dbPath, dbBackup, 'utf8');
    for (const f of fs.readdirSync(uploadsDir)) {
      if (!uploadsBackup.includes(f)) {
        try { fs.unlinkSync(path.join(uploadsDir, f)); } catch {}
      }
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
})();
