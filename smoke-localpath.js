// Self-contained smoke test for the local-path import + healing feature.
// Run with: node smoke-localpath.js
//
// What it does:
//   1. Backs up db.json and uploads/ into a temp directory.
//   2. Seeds db.json with a "broken" lesson whose resource is a Windows path.
//   3. Spawns `node server.js` on a free port.
//   4. POSTs a temp file's absolute path to /api/upload-path and asserts
//      that the response includes a /uploads/... URL and that the file
//      is actually served at that URL.
//   5. GETs /api/courses and asserts the seeded "broken" lesson was healed
//      (its resource now starts with /uploads/).
//   6. Restores db.json and uploads/ from the backup, regardless of pass/fail.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'db.json');
const UPLOADS = path.join(ROOT, 'uploads');
const BACKUP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ocb-smoke-'));
const BACKUP_DB = path.join(BACKUP_DIR, 'db.json');
const BACKUP_UPLOADS = path.join(BACKUP_DIR, 'uploads');
const TEST_PORT = 4567;

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  PASS  ' + msg); }
  else      { failed++; console.log('  FAIL  ' + msg); }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}
function emptyDirSync(dir) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

function backup() {
  console.log('Backing up db.json and uploads/ to', BACKUP_DIR);
  if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, BACKUP_DB);
  if (fs.existsSync(UPLOADS)) copyDirSync(UPLOADS, BACKUP_UPLOADS);
}
function restore() {
  console.log('Restoring db.json and uploads/');
  if (fs.existsSync(BACKUP_DB)) fs.copyFileSync(BACKUP_DB, DB_PATH);
  else fs.writeFileSync(DB_PATH, JSON.stringify({ courses: [] }, null, 2));
  if (fs.existsSync(BACKUP_UPLOADS)) {
    emptyDirSync(UPLOADS);
    copyDirSync(BACKUP_UPLOADS, UPLOADS);
  } else {
    emptyDirSync(UPLOADS);
  }
}

function waitForServer(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.request({ host, port, method: 'GET', path: '/api/courses' }, (res) => {
        res.resume();
        if (res.statusCode) return resolve();
        retry();
      });
      req.on('error', retry);
      req.end();
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error('server never came up'));
      setTimeout(tick, 150);
    };
    tick();
  });
}

function postJson(port, p, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: p,
      headers: { 'content-type': 'application/json', 'content-length': data.length },
    }, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function getJson(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode, body: chunks }); }
      });
    }).on('error', reject);
  });
}
function getBuffer(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  backup();
  // Make sure uploads starts clean (except .gitkeep)
  emptyDirSync(UPLOADS);
  fs.writeFileSync(path.join(UPLOADS, '.gitkeep'), '');

  // Seed a "broken" lesson with a Windows path that we WILL actually create
  // on disk so the heal step can succeed.
  const seedFile = path.join(os.tmpdir(), 'ocb-seed-' + Date.now() + '.txt');
  const seedContent = 'hello from the seeded broken lesson';
  fs.writeFileSync(seedFile, seedContent);
  const brokenPath = seedFile.replace(/\//g, '\\'); // pretend the user pasted a Windows path

  const seeded = {
    courses: [{
      id: 'c1', title: 'Smoke', description: '', createdAt: new Date().toISOString(),
      lessons: [
        { id: 'l1', title: 'Seeded broken lesson', type: 'text',
          resource: brokenPath, notes: '', isCompleted: false, createdAt: new Date().toISOString() },
      ],
    }],
  };
  fs.writeFileSync(DB_PATH, JSON.stringify(seeded, null, 2));

  // Create a fresh file we will import via /api/upload-path
  const importFile = path.join(os.tmpdir(), 'ocb-import-' + Date.now() + '.bin');
  const importBytes = Buffer.from('local path import test ' + Date.now());
  fs.writeFileSync(importFile, importBytes);

  // Spawn the server
  console.log('Starting server on port', TEST_PORT);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(TEST_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (c) => serverLog += c.toString());
  child.stderr.on('data', (c) => serverLog += c.toString());

  const cleanup = () => { try { child.kill(); } catch {} try { fs.unlinkSync(seedFile); } catch {} try { fs.unlinkSync(importFile); } catch {} restore(); };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  try {
    await waitForServer(TEST_PORT, '127.0.0.1', 8000);
    console.log('Server is up');

    // 1) /api/upload-path with a Windows-style path
    console.log('\n[1] /api/upload-path with Windows path');
    const r1 = await postJson(TEST_PORT, '/api/upload-path', { path: importFile.replace(/\//g, '\\') });
    assert(r1.status === 200, `200 OK (got ${r1.status})`);
    assert(typeof r1.body.path === 'string' && r1.body.path.startsWith('/uploads/'),
      'response has /uploads/... path');
    assert(r1.body.name === path.basename(importFile), 'response name matches source basename');
    assert(typeof r1.body.size === 'number' && r1.body.size === importBytes.length, 'response size matches');

    // 2) the file is actually served from that URL
    console.log('\n[2] file served at the returned URL');
    const r2 = await getBuffer(TEST_PORT, r1.body.path);
    assert(r2.status === 200, `200 OK at uploaded URL (got ${r2.status})`);
    assert(r2.body && r2.body.length === importBytes.length, 'served bytes match source length');
    assert(r2.body && r2.body.equals(importBytes), 'served bytes match source content');

    // 3) /api/upload-path rejects http URLs
    console.log('\n[3] /api/upload-path rejects http URLs');
    const r3 = await postJson(TEST_PORT, '/api/upload-path', { path: 'http://example.com/foo.pdf' });
    assert(r3.status === 400, `400 for URL (got ${r3.status})`);

    // 4) /api/upload-path 404 for missing file
    console.log('\n[4] /api/upload-path 404 for missing file');
    const r4 = await postJson(TEST_PORT, '/api/upload-path', { path: 'C:\\does\\not\\exist\\nope.txt' });
    assert(r4.status === 404, `404 for missing (got ${r4.status})`);

    // 5) /api/upload-path with file:// URL form
    console.log('\n[5] /api/upload-path accepts file:///C:/... form');
    const r5 = await postJson(TEST_PORT, '/api/upload-path', { path: 'file:///' + importFile.replace(/\\/g, '/') });
    assert(r5.status === 200, `200 OK for file:// form (got ${r5.status})`);
    assert(r5.body.path && r5.body.path.startsWith('/uploads/'), 'response has /uploads/... path');

    // 6) Healing: the seeded broken-path lesson should be rewritten to /uploads/...
    console.log('\n[6] healing on read rewrites raw local paths');
    const r6 = await getJson(TEST_PORT, '/api/courses/c1');
    assert(r6.status === 200, `200 OK (got ${r6.status})`);
    const healed = r6.body && r6.body.lessons && r6.body.lessons[0];
    assert(healed, 'lesson present after heal');
    if (healed) {
      assert(typeof healed.resource === 'string' && healed.resource.startsWith('/uploads/'),
        `lesson.resource was healed to /uploads/... (got ${healed.resource})`);
    }
    // ...and db.json on disk should also be updated
    const onDisk = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    const onDiskLesson = onDisk.courses[0].lessons[0];
    assert(onDiskLesson.resource.startsWith('/uploads/'),
      'db.json on disk was rewritten by heal');

    console.log('\nServer log tail:\n' + serverLog.split('\n').slice(-15).join('\n'));
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    console.error('Smoke test error:', err);
    console.error('Server log:\n' + serverLog);
    process.exitCode = 1;
  } finally {
    try { child.kill(); } catch {}
    setTimeout(() => {
      try { fs.rmSync(BACKUP_DIR, { recursive: true, force: true }); } catch {}
      try { fs.unlinkSync(seedFile); } catch {}
      try { fs.unlinkSync(importFile); } catch {}
      restore();
      process.exit(process.exitCode || 0);
    }, 300);
  }
}

main();
