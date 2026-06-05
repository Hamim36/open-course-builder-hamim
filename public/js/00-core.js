/* ============================================================================
   00-core.js — Constants, AppState, API client, utilities
   ============================================================================ */
'use strict';

const API_BASE = '';
const NOTES_DEBOUNCE_MS = 800;
const SESSION_HEARTBEAT_MS = 60_000;
const SESSION_INACTIVITY_LIMIT_MS = 10 * 60_000;
const AUTOSAVE_DEBOUNCE_MS = 1500;
const SESSION_TIMER_TICK_MS = 1000;
const HEATMAP_DAYS = 365;
const HEATMAP_LEVELS = 4;
const GITHUB_RE = /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+?(\.git)?\/?$/i;
const EMBED_CHECK_TIMEOUT_MS = 4000;
const NOTE_TS_FORMATTER = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const HEATMAP_TS_FORMATTER = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

const CONTENT_TYPE_LABEL = {
  youtube: 'YouTube', video: 'Video', audio: 'Audio', image: 'Image',
  pdf: 'PDF', markdown: 'Markdown', text: 'Text', text_content: 'Text',
  website: 'Website', document: 'Document', other: 'Other'
};

const TYPE_BADGE_ICON = {
  youtube: 'youtube', video: 'film', audio: 'music-note', image: 'image',
  pdf: 'file-earmark-pdf', markdown: 'markdown', text: 'card-text', text_content: 'card-text',
  website: 'globe', document: 'file-earmark-text', other: 'link-45deg'
};

const AppState = {
  course: null,
  stats: null,
  config: { git: null },
  selectedModuleId: null,
  sidebarSearch: '',
  heatmapOpen: false,
  notesByTopic: {},
  topicViewer: {
    modal: null,
    moduleId: null,
    topicId: null,
    notesSaveTimer: null,
    lastContentType: null,
    openSeq: 0
  },
  session: {
    id: null, startTime: null, elapsedSec: 0, lastHeartbeat: null,
    tickTimer: null, heartbeatTimer: null,
    completedTopicsThisSession: 0, notesEditedThisSession: 0,
    modulesStudied: new Set(), initialStreak: null
  },
  ui: {
    createCourse: { tempId: null, pollTimer: null, modules: [], course: null, activeModuleId: null, pendingFile: null },
    modifyCourse: { tempId: null, pollTimer: null, course: null }
  }
};

const API = {
  async _fetch(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      if (body instanceof FormData) { opts.body = body; }
      else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    }
    const res = await fetch(API_BASE + path, opts);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) { try { data = await res.json(); } catch { data = null; } }
    else { data = await res.text(); }
    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || res.statusText);
      err.status = res.status; err.data = data; throw err;
    }
    return data;
  },
  get(path) { return this._fetch('GET', path); },
  post(path, body) { return this._fetch('POST', path, body); },
  patch(path, body) { return this._fetch('PATCH', path, body); },
  put(path, body) { return this._fetch('PUT', path, body); },
  del(path) { return this._fetch('DELETE', path); },
  upload(path, formData) { return this._fetch('POST', path, formData); }
};

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function sanitizeUrl(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return '';
  return trimmed;
}

function sanitizeFilename(name) {
  if (!name) return 'file';
  return String(name).replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'file';
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '0m';
  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatClock(now) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
}

function ymd(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function downloadBlob(content, filename, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function arrayMove(arr, fromIdx, toIdx) {
  const out = arr.slice();
  if (fromIdx < 0 || fromIdx >= out.length) return out;
  const [item] = out.splice(fromIdx, 1);
  out.splice(Math.max(0, Math.min(toIdx, out.length)), 0, item);
  return out;
}

function detectContentType(url) {
  if (!url) return 'other';
  const u = String(url).toLowerCase().trim();
  if (/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)/.test(u)) return 'youtube';
  if (/\.pdf(\?|$)/.test(u)) return 'pdf';
  if (/\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/.test(u)) return 'audio';
  if (/\.(mp4|webm|mov|avi|mkv|ogv)(\?|$)/.test(u)) return 'video';
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|avif)(\?|$)/.test(u)) return 'image';
  if (/\.(md|markdown)(\?|$)/.test(u)) return 'markdown';
  if (/\.(txt|json|log|csv)(\?|$)/.test(u)) return 'text';
  if (/\.(docx?|pptx?|xlsx?)(\?|$)/.test(u)) return 'document';
  return 'website';
}

function getYouTubeEmbedUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    let id = null;
    if (u.hostname.includes('youtu.be')) { id = u.pathname.replace(/^\//, '').split('/')[0]; }
    else if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/watch')) id = u.searchParams.get('v');
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2];
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2];
    }
    if (!id) return '';
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  } catch { return ''; }
}

function getFaviconUrl(url) {
  try { const u = new URL(url); return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`; }
  catch { return ''; }
}

const DS = {
  showLoader() { const el = $('#global-loader'); if (el) el.style.display = 'flex'; },
  hideLoader() { const el = $('#global-loader'); if (el) el.style.display = 'none'; },
  setText(sel, text) { const el = $(sel); if (el) el.textContent = text; }
};

function heatLevelClass(min) {
  if (min <= 0) return '';
  if (min < 15) return 'l1';
  if (min < 45) return 'l2';
  if (min < 90) return 'l3';
  return 'l4';
}
