/* ============================================================================
   04-topic-viewer.js — Topic modal: content rendering for 9 types, notes, nav
   ============================================================================ */
'use strict';

const TopicViewer = {
  el: null,
  bsModal: null,
  current: null, // { mid, tid, m, t }
  navOrder: [], // [{mid,tid}]
  navIndex: -1,
  notesTimer: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('topicViewerModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: true, keyboard: true });
    this.el.addEventListener('hidden.bs.modal', () => this._onClose());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') this.navigate(-1);
      else if (e.key === 'ArrowRight') this.navigate(1);
    });
  },
  async open(mid, tid) {
    this.init();
    if (!AppState.course) return;
    const m = AppState.course.modules.find(x => x.id === mid);
    if (!m) return;
    const t = (m.topics || []).find(x => x.id === tid);
    if (!t) return;

    this.navOrder = [];
    AppState.course.modules.forEach(mm => (mm.topics || []).forEach(tt => this.navOrder.push({ mid: mm.id, tid: tt.id })));
    this.navIndex = this.navOrder.findIndex(x => x.mid === mid && x.tid === tid);
    this.current = { mid, tid, m, t };
    this._render();
    this.bsModal.show();
    this._loadNotes(tid);
    try {
      const res = await API.post(`/api/topics/${encodeURIComponent(tid)}/visit`, {});
      AppState.stats = res.stats;
      Navbar.render();
    } catch (e) { /* non-fatal */ }
  },
  navigate(dir) {
    if (!this.navOrder.length) return;
    const i = this.navIndex + dir;
    if (i < 0 || i >= this.navOrder.length) return;
    this.navIndex = i;
    const { mid, tid } = this.navOrder[i];
    const m = AppState.course.modules.find(x => x.id === mid);
    const t = m && (m.topics || []).find(x => x.id === tid);
    if (!m || !t) return;
    AppState.selectedModuleId = mid;
    this.current = { mid, tid, m, t };
    this._render();
    this._loadNotes(tid);
    Sidebar.render();
    Main.render();
  },
  _render() {
    const { m, t } = this.current;
    const titleEl = $('#tv-title');
    const breadcrumbEl = $('#tv-breadcrumb');
    const bodyEl = $('#tv-body');
    if (!titleEl || !bodyEl) return;
    titleEl.textContent = t.name || 'Topic';
    breadcrumbEl.textContent = `${AppState.course.name || ''} / ${m.name || ''}`;

    bodyEl.innerHTML = `
      <div class="tv-content" id="tv-content"></div>
      <div class="tv-side" id="tv-side">
        <div class="tv-side-tabs">
          <button class="tv-tab active" data-tab="notes"><i class="bi bi-journal-text"></i> Notes</button>
          <button class="tv-tab" data-tab="meta"><i class="bi bi-info-circle"></i> Details</button>
        </div>
        <div class="tv-tab-pane active" data-pane="notes">
          <textarea id="tv-notes" class="form-control" placeholder="Write your notes here…"></textarea>
          <div class="tv-notes-status text-muted-2" id="tv-notes-status"></div>
        </div>
        <div class="tv-tab-pane" data-pane="meta">
          <div id="tv-meta"></div>
        </div>
      </div>
    `;

    $$('.tv-tab', bodyEl).forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.tv-tab').forEach(b => b.classList.remove('active'));
        $$('.tv-tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const pane = btn.dataset.tab;
        bodyEl.querySelector(`.tv-tab-pane[data-pane="${pane}"]`).classList.add('active');
      });
    });

    $('#tv-meta', bodyEl).innerHTML = `
      <div class="meta-row"><span>Type</span><span>${escapeHtml(CONTENT_TYPE_LABEL[t.content_type] || 'Other')}</span></div>
      ${t.url ? `<div class="meta-row"><span>URL</span><a href="${escapeHtml(sanitizeUrl(t.url))}" target="_blank" rel="noopener noreferrer">open <i class="bi bi-box-arrow-up-right"></i></a></div>` : ''}
      ${t.local_path ? `<div class="meta-row"><span>File</span><span>${escapeHtml(t.local_path)}</span></div>` : ''}
      <div class="meta-row"><span>ID</span><span style="font-family:var(--font-mono);font-size:11px;">${escapeHtml(t.id)}</span></div>
    `;

    const notesEl = $('#tv-notes');
    notesEl.addEventListener('input', () => this._scheduleSaveNotes(t.id, notesEl.value));

    this._renderContent();
    this._updateNavBtns();
  },
  _updateNavBtns() {
    const prev = $('#tv-prev'), next = $('#tv-next');
    if (prev) prev.disabled = this.navIndex <= 0;
    if (next) next.disabled = this.navIndex < 0 || this.navIndex >= this.navOrder.length - 1;
  },
  _renderContent() {
    const wrap = $('#tv-content');
    if (!wrap) return;
    const { t } = this.current;
    const type = t.content_type || 'website';
    wrap.innerHTML = '';
    wrap.className = 'tv-content';
    if (type === 'youtube') {
      const url = getYouTubeEmbedUrl(t.url);
      if (url) {
        wrap.innerHTML = `<iframe src="${escapeHtml(url)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      } else {
        wrap.innerHTML = `<div class="alert alert-warning">Invalid YouTube URL: ${escapeHtml(t.url || '')}</div>`;
      }
    } else if (type === 'video' || type === 'audio') {
      const src = t.url || this._fileUrl(t);
      if (src) {
        wrap.innerHTML = `<${type === 'audio' ? 'audio' : 'video'} controls src="${escapeHtml(src)}" style="width:100%;max-height:480px;background:#000;"></${type === 'audio' ? 'audio' : 'video'}>`;
      } else wrap.innerHTML = '<div class="alert alert-warning">No media source.</div>';
    } else if (type === 'image') {
      const src = t.url || this._fileUrl(t);
      wrap.innerHTML = `<img src="${escapeHtml(src || '')}" alt="${escapeHtml(t.name || '')}">`;
    } else if (type === 'pdf') {
      const src = t.url || this._fileUrl(t);
      wrap.innerHTML = `<iframe src="${escapeHtml(src || '')}" title="PDF"></iframe>`;
    } else if (type === 'markdown') {
      const html = DOMPurify.sanitize(marked.parse(t.content || t.url || ''));
      wrap.innerHTML = `<div class="md-rendered">${html}</div>`;
    } else if (type === 'text' || type === 'text_content') {
      const text = t.content || t.url || '';
      wrap.innerHTML = `<pre class="text-content">${escapeHtml(text)}</pre>`;
    } else if (type === 'document') {
      const src = t.url || this._fileUrl(t);
      wrap.innerHTML = `<iframe src="${escapeHtml(src || '')}" title="Document"></iframe>`;
    } else if (type === 'website') {
      this._renderWebsite(wrap, t);
    } else {
      const src = t.url || this._fileUrl(t);
      if (src) wrap.innerHTML = `<iframe src="${escapeHtml(src)}" title="${escapeHtml(t.name || '')}"></iframe>`;
      else wrap.innerHTML = `<div class="alert alert-warning">No source provided.</div>`;
    }
  },
  _renderWebsite(wrap, t) {
    const url = t.url;
    if (!url) { wrap.innerHTML = '<div class="alert alert-warning">No URL.</div>'; return; }
    const safe = sanitizeUrl(url);
    wrap.innerHTML = `
      <div class="web-frame">
        <div class="web-frame-head">
          <img src="${escapeHtml(getFaviconUrl(safe))}" alt="" onerror="this.style.visibility='hidden'">
          <a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safe)}</a>
          <a class="btn btn-sm btn-outline-secondary ms-auto" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right"></i> Open</a>
        </div>
        <iframe src="${escapeHtml(safe)}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
      </div>
    `;
  },
  _fileUrl(t) {
    if (t.local_path && t.local_path.startsWith('offline-files/')) {
      return '/' + t.local_path;
    }
    if (t.local_path) return '/offline-files/' + t.local_path.replace(/^\/+/, '');
    return '';
  },
  async _loadNotes(tid) {
    try {
      const r = await API.get(`/api/topics/${encodeURIComponent(tid)}/notes`);
      const el = $('#tv-notes'); if (el) el.value = r.notes || '';
      const st = $('#tv-notes-status');
      if (st && r.updated_at) st.textContent = `Last saved ${NOTE_TS_FORMATTER.format(new Date(r.updated_at))}`;
    } catch (e) { Toast.error('Failed to load notes', e.message); }
  },
  _scheduleSaveNotes(tid, value) {
    if (this.notesTimer) clearTimeout(this.notesTimer);
    const st = $('#tv-notes-status'); if (st) st.textContent = 'Saving…';
    this.notesTimer = setTimeout(() => this._saveNotes(tid, value), NOTES_DEBOUNCE_MS);
  },
  async _saveNotes(tid, value) {
    Session.trackNoteEdit();
    try {
      const r = await API.put(`/api/topics/${encodeURIComponent(tid)}/notes`, { notes: value });
      const st = $('#tv-notes-status');
      if (st) st.textContent = r.updated_at ? `Saved ${NOTE_TS_FORMATTER.format(new Date(r.updated_at))}` : 'Saved';
    } catch (e) { Toast.error('Failed to save notes', e.message); }
  },
  _onClose() {
    if (this.notesTimer) { clearTimeout(this.notesTimer); this.notesTimer = null; }
    Session.end();
  },
  toggleComplete() {
    const { m, t } = this.current; Main.toggleComplete(m.id, t.id);
  }
};
