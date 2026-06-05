/* ============================================================================
   06-modals-import-export-git.js — Import/Export/Git + global wiring
   ============================================================================ */
'use strict';

const Import = {
  el: null, bsModal: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('importModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: true, keyboard: true });
    const dz = $('#import-drop');
    if (dz) {
      ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
      dz.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) this._upload(e.dataTransfer.files[0]); });
    }
    const fi = $('#import-file');
    if (fi) fi.addEventListener('change', (e) => { if (e.target.files.length) this._upload(e.target.files[0]); });
  },
  open() {
    this.init();
    const status = $('#import-status'); if (status) status.textContent = '';
    this.bsModal.show();
  },
  async _upload(file) {
    if (!file) return;
    const status = $('#import-status'); if (status) status.textContent = 'Uploading…';
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await API.upload('/api/courses/import', fd);
      AppState.course = r.course; AppState.stats = r.stats;
      AppState.selectedModuleId = r.course.modules[0] ? r.course.modules[0].id : null;
      Navbar.render(); Sidebar.render(); Main.render();
      if (status) status.innerHTML = '<span class="text-success">Imported.</span>';
      Toast.success('Course imported');
      setTimeout(() => this.bsModal.hide(), 700);
    } catch (e) { if (status) status.innerHTML = `<span class="text-danger">${escapeHtml(e.message)}</span>`; Toast.error('Import failed', e.message); }
  }
};

const Export = {
  el: null, bsModal: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('exportModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: true, keyboard: true });
  },
  open() {
    this.init();
    if (!AppState.course) { Toast.warning('No course to export'); return; }
    this._render();
    this.bsModal.show();
  },
  _render() {
    const body = $('#export-body'); if (!body) return;
    body.innerHTML = `
      <div class="mb-3">
        <label class="form-label">Course name</label>
        <input id="ex-name" class="form-control" value="${escapeHtml(AppState.course.name || '')}">
      </div>
      <div class="form-check mb-3">
        <input class="form-check-input" type="checkbox" id="ex-include-progress" checked>
        <label class="form-check-label" for="ex-include-progress">Include progress / notes / heatmap</label>
      </div>
      <div class="alert alert-info" style="font-size:13px;"><i class="bi bi-info-circle"></i> Exports a single JSON file with your full course. Use Import to load it on another machine.</div>
    `;
  },
  async _export() {
    const includeProgress = $('#ex-include-progress').checked;
    const name = $('#ex-name').value.trim() || (AppState.course.name || 'course');
    const payload = { course: AppState.course, progress: includeProgress ? (AppState.stats || {}) : null, exported_at: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, sanitizeFilename(`${name}.json`));
    Toast.success('Exported');
    this.bsModal.hide();
  }
};

const GitModal = {
  el: null, bsModal: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('gitModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: true, keyboard: true });
    const saveBtn = $('#git-save');
    if (saveBtn) saveBtn.addEventListener('click', () => this._saveConfig());
  },
  open() {
    this.init();
    this._loadConfig();
    this.bsModal.show();
  },
  async _loadConfig() {
    try {
      const cfg = await API.get('/api/git/config');
      $('#git-url').value = cfg.repo || '';
      $('#git-branch').value = cfg.branch || 'main';
      $('#git-token').value = cfg.token || '';
      $('#git-enabled').checked = !!cfg.enabled;
      $('#git-author-name').value = cfg.author_name || '';
      $('#git-author-email').value = cfg.author_email || '';
      this._renderStatus(cfg.last_status || null);
    } catch (e) { Toast.error('Failed to load git config', e.message); }
  },
  _renderStatus(st) {
    const wrap = $('#git-status'); if (!wrap) return;
    if (!st) { wrap.innerHTML = '<div class="text-muted-2" style="font-size:12px;">No sync history yet.</div>'; return; }
    wrap.innerHTML = `
      <div class="git-status-row"><span>Last sync</span><span>${st.last_sync_at ? new Date(st.last_sync_at).toLocaleString() : '—'}</span></div>
      <div class="git-status-row"><span>Status</span><span class="${st.last_error ? 'text-danger' : 'text-success'}">${st.last_error ? 'Error' : 'OK'}</span></div>
      ${st.last_error ? `<div class="git-status-row"><span>Error</span><span class="text-danger" style="font-size:11px;">${escapeHtml(st.last_error)}</span></div>` : ''}
    `;
  },
  async _saveConfig() {
    const payload = {
      repo: $('#git-url').value.trim(),
      branch: $('#git-branch').value.trim() || 'main',
      token: $('#git-token').value.trim(),
      enabled: $('#git-enabled').checked,
      author_name: $('#git-author-name').value.trim(),
      author_email: $('#git-author-email').value.trim()
    };
    if (payload.enabled && !GITHUB_RE.test(payload.repo)) { Toast.warning('Invalid GitHub repo URL'); return; }
    try {
      DS.showLoader('Saving git config…');
      const r = await API.put('/api/git/config', payload);
      DS.hideLoader();
      this._renderStatus(r.last_status || null);
      Toast.success('Git config saved');
    } catch (e) { DS.hideLoader(); Toast.error('Save failed', e.message); }
  },
  async save() {
    // One-click save = pull + push
    try {
      DS.showLoader('Syncing to git…');
      const r = await API.post('/api/git/sync', {});
      DS.hideLoader();
      this._renderStatus(r.status);
      Toast.success('Synced to git');
    } catch (e) { DS.hideLoader(); Toast.error('Sync failed', e.message); }
  }
};

function wireGlobal() {
  // Navbar buttons
  $$('.nav-stat').forEach(el => el.addEventListener('click', () => {
    const act = el.dataset.act;
    if (act === 'toggle-heat') Heatmap.toggle();
  }));
  $$('[data-action]').forEach(el => el.addEventListener('click', () => {
    const a = el.dataset.action;
    if (a === 'create') CreateCourse.open();
    else if (a === 'modify') ModifyCourse.open();
    else if (a === 'import') Import.open();
    else if (a === 'export') Export.open();
    else if (a === 'git') GitModal.open();
    else if (a === 'save') GitModal.save();
  }));

  // Topic viewer navigation buttons
  const prev = $('#tv-prev'), next = $('#tv-next');
  if (prev) prev.addEventListener('click', () => TopicViewer.navigate(-1));
  if (next) next.addEventListener('click', () => TopicViewer.navigate(1));
  const tvToggle = $('#tv-toggle-complete');
  if (tvToggle) tvToggle.addEventListener('click', () => TopicViewer.toggleComplete());

  // Create course save / cancel
  const ccSave = $('#cc-save'), ccCancel = $('#cc-cancel');
  if (ccSave) ccSave.addEventListener('click', () => CreateCourse._save());
  if (ccCancel) ccCancel.addEventListener('click', () => {
    if (confirm('Discard unsaved changes? Drafts are auto-saved to the server.')) CreateCourse.bsModal.hide();
  });

  // Modify course save / discard
  const mcSave = $('#mc-save'), mcDiscard = $('#mc-discard');
  if (mcSave) mcSave.addEventListener('click', () => ModifyCourse._save());
  if (mcDiscard) mcDiscard.addEventListener('click', () => ModifyCourse._discard());

  // Export
  const exBtn = $('#export-go');
  if (exBtn) exBtn.addEventListener('click', () => Export._export());
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') { CreateCourse.open(); e.preventDefault(); }
    else if (e.key === 'm' || e.key === 'M') { if (AppState.course) ModifyCourse.open(); e.preventDefault(); }
    else if (e.key === 'i' || e.key === 'I') { Import.open(); e.preventDefault(); }
    else if (e.key === 'e' || e.key === 'E') { if (AppState.course) Export.open(); e.preventDefault(); }
    else if (e.key === 'g' || e.key === 'G') { GitModal.open(); e.preventDefault(); }
    else if (e.key === 's' || e.key === 'S') { if (AppState.course) GitModal.save(); e.preventDefault(); }
    else if (e.key === 'h' || e.key === 'H') { Heatmap.toggle(); e.preventDefault(); }
    else if (e.key === 'Escape') { Heatmap.close(); }
  });
}

function wireErrorHandlers() {
  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled promise rejection', e.reason);
    Toast.error('Unexpected error', e.reason && e.reason.message ? e.reason.message : 'Unknown');
  });
  window.addEventListener('error', (e) => {
    console.error('Runtime error', e.error || e.message);
  });
}
