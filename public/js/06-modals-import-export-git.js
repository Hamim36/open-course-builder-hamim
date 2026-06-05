/* ============================================================================
   06-modals-import-export-git.js — Import/Export/Git + global wiring
   ============================================================================ */
'use strict';

const Import = {
  el: null, bsModal: null,
  _pendingFile: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('importModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: true, keyboard: true });

    const dropzone = $('#import-dropzone');
    const fileInput = $('#import-file-input');
    const uploadBtn = $('#import-upload');
    const fileInfo = $('#import-file-info');

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) this._setPendingFile(f);
      });
    }
    if (dropzone && fileInput) {
      // Click-to-browse: clicking the dropzone (but not the inner input) opens the file picker
      dropzone.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'import-file-input') return;
        fileInput.click();
      });
      // Drag & drop
      ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.add('drag');
      }));
      ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.remove('drag');
      }));
      dropzone.addEventListener('drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) {
          // Mirror the file into the hidden input so subsequent selection-change events behave
          try {
            const dt = new DataTransfer();
            dt.items.add(f);
            fileInput.files = dt.files;
          } catch (_) { /* jsdom/older browsers may not support DataTransfer; fall through */ }
          this._setPendingFile(f);
        }
      });
    }
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        if (this._pendingFile) this._upload(this._pendingFile);
      });
    }

    // Reset state when modal is dismissed
    this.el.addEventListener('hidden.bs.modal', () => {
      this._pendingFile = null;
      if (fileInput) fileInput.value = '';
      if (fileInfo) fileInfo.textContent = '';
      const err = $('#import-error'); if (err) { err.style.display = 'none'; err.textContent = ''; }
      const warn = $('#import-warning'); if (warn) warn.style.display = 'none';
      if (uploadBtn) uploadBtn.disabled = true;
    });
  },
  _setPendingFile(file) {
    this._pendingFile = file;
    const fileInfo = $('#import-file-info');
    if (fileInfo) fileInfo.textContent = `${file.name} (${formatBytes(file.size)})`;
    const uploadBtn = $('#import-upload');
    if (uploadBtn) uploadBtn.disabled = false;
    const err = $('#import-error'); if (err) { err.style.display = 'none'; err.textContent = ''; }
    const warn = $('#import-warning');
    if (warn && AppState.course) warn.style.display = '';
  },
  open() {
    this.init();
    const warn = $('#import-warning');
    if (warn) warn.style.display = AppState.course ? '' : 'none';
    this.bsModal.show();
  },
  async _upload(file) {
    if (!file) return;
    const errBox = $('#import-error');
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
    const uploadBtn = $('#import-upload');
    if (uploadBtn) uploadBtn.disabled = true;
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await API.upload('/api/course/import', fd);
      // Server response shape: { success: true, course: <wrapped> } where <wrapped> = { schema_version, last_modified, course: { ... } }
      const wrapped = r && r.course;
      const innerCourse = wrapped && wrapped.course ? wrapped.course : wrapped;
      if (!innerCourse || !Array.isArray(innerCourse.modules)) throw new Error('Server returned unexpected payload');
      AppState.course = innerCourse;
      // Refresh stats from server (the import handler resets progress/heatmap fields server-side)
      if (typeof loadInitialData === 'function') {
        try { await loadInitialData(); } catch (_) { /* non-fatal: keep current stats */ }
      }
      AppState.selectedModuleId = innerCourse.modules[0] ? innerCourse.modules[0].id : null;
      Navbar.render(); Sidebar.render(); Main.render();
      Toast.success('Course imported');
      this.bsModal.hide();
    } catch (e) {
      if (errBox) { errBox.textContent = e.message || String(e); errBox.style.display = ''; }
      Toast.error('Import failed', e.message);
      if (uploadBtn) uploadBtn.disabled = false;
    }
  }
};

const Export = {
  el: null, bsModal: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('exportModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: true, keyboard: true });

    const tplBtn = $('#export-template');
    const progBtn = $('#export-progress');
    if (tplBtn) tplBtn.addEventListener('click', () => this._export(false));
    if (progBtn) progBtn.addEventListener('click', () => this._export(true));
  },
  open() {
    this.init();
    if (!AppState.course) { Toast.warning('No course to export'); return; }
    this.bsModal.show();
  },
  async _export(includeStats) {
    if (!AppState.course) { Toast.warning('No course to export'); return; }
    try {
      DS.showLoader(includeStats ? 'Exporting with progress…' : 'Exporting template…');
      const url = `/api/course/export?include_stats=${includeStats ? 'true' : 'false'}`;
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`Export failed: HTTP ${r.status} ${body.slice(0, 120)}`);
      }
      const blob = await r.blob();
      const baseName = sanitizeFilename(AppState.course.name || 'course');
      downloadBlob(blob, `${baseName}-${includeStats ? 'with-progress' : 'template'}.json`);
      DS.hideLoader();
      Toast.success(includeStats ? 'Exported with progress' : 'Template exported');
      this.bsModal.hide();
    } catch (e) {
      DS.hideLoader();
      Toast.error('Export failed', e.message);
    }
  }
};

const GitModal = {
  el: null, bsModal: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('gitConfigModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: true, keyboard: true });
    const saveBtn = $('#git-save-config');
    if (saveBtn) saveBtn.addEventListener('click', () => this._saveConfig());
  },
  open() {
    this.init();
    if (!this.el) return; // modal not present in DOM
    this._loadConfig();
    this.bsModal.show();
  },
  async _loadConfig() {
    try {
      const cfg = await API.get('/api/git/config');
      $('#git-url').value = cfg.repo || '';
      $('#git-name').value = cfg.author_name || '';
      $('#git-email').value = cfg.author_email || '';
      this._renderStatus(cfg.last_status || null);
    } catch (e) { Toast.error('Failed to load git config', e.message); }
  },
  _renderStatus(st) {
    const wrap = $('#git-status-info'); if (!wrap) return;
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
      branch: 'main',
      token: '',
      enabled: $('#git-url').value.trim().length > 0,
      author_name: $('#git-name').value.trim(),
      author_email: $('#git-email').value.trim()
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

function formatBytes(n) {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function wireGlobal() {
  // Navbar dropdown menu items
  const m1 = $('#menu-create-course');  if (m1) m1.addEventListener('click', () => CreateCourse.open());
  const m2 = $('#menu-manage-course');   if (m2) m2.addEventListener('click', () => ModifyCourse.open());
  const m3 = $('#menu-import-course');   if (m3) m3.addEventListener('click', () => Import.open());
  const m4 = $('#menu-export-course');   if (m4) m4.addEventListener('click', () => Export.open());

  // Navbar stat click (heatmap toggle, etc.) — keep for legacy safety
  $$('.nav-stat').forEach(el => el.addEventListener('click', () => {
    const act = el.dataset.act;
    if (act === 'toggle-heat') Heatmap.toggle();
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
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    // Ctrl+Shift+S → save to git
    if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      if (AppState.course) GitModal.save();
      e.preventDefault();
      return;
    }
    // Ctrl+S → also save to git (common muscle memory)
    if (e.ctrlKey && !e.shiftKey && (e.key === 'S' || e.key === 's')) {
      if (AppState.course) GitModal.save();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'n' || e.key === 'N') { CreateCourse.open(); e.preventDefault(); }
    else if (e.key === 'm' || e.key === 'M') { if (AppState.course) ModifyCourse.open(); e.preventDefault(); }
    else if (e.key === 'i' || e.key === 'I') { Import.open(); e.preventDefault(); }
    else if (e.key === 'e' || e.key === 'E') { if (AppState.course) Export.open(); e.preventDefault(); }
    else if (e.key === 'g' || e.key === 'G') { GitModal.open(); e.preventDefault(); }
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
