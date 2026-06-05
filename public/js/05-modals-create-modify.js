/* ============================================================================
   05-modals-create-modify.js — Create course wizard, Modify course editor
   ============================================================================ */
'use strict';

const CreateCourse = {
  el: null, bsModal: null,
  draft: null,        // { name, description, modules:[{name,topics:[{name,type,url}]}] }
  activeModule: 0,
  autosaveTimer: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('createCourseModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: 'static', keyboard: false });
    this.el.addEventListener('hidden.bs.modal', () => { this.draft = null; if (this.autosaveTimer) clearTimeout(this.autosaveTimer); });
  },
  async open() {
    this.init();
    if (AppState.tempCourse) { this.draft = JSON.parse(JSON.stringify(AppState.tempCourse)); }
    else { this.draft = { name: '', description: '', modules: [{ name: 'Module 1', topics: [] }] }; }
    this.activeModule = 0;
    this._renderShell();
    this.bsModal.show();
    this._renderContent();
    this._loadTemp();
  },
  async _loadTemp() {
    try {
      const r = await API.get('/api/temp-course');
      if (r && r.draft) { this.draft = r.draft; this._renderContent(); Toast.info('Restored unsaved draft'); }
    } catch (e) { /* no draft */ }
  },
  _scheduleAutosave() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => this._autosave(), AUTOSAVE_DEBOUNCE_MS);
  },
  async _autosave() {
    try { await API.put('/api/temp-course', { draft: this.draft }); } catch (e) { /* silent */ }
  },
  _renderShell() {
    const body = $('#cc-body'); if (!body) return;
    body.innerHTML = `
      <div class="cc-layout">
        <aside class="cc-side">
          <div class="cc-section-title">Step 1 · Name</div>
          <input id="cc-name" class="form-control" placeholder="Course name">
          <textarea id="cc-desc" class="form-control" rows="3" placeholder="Description (optional)" style="margin-top:8px;"></textarea>
          <div class="cc-section-title" style="margin-top:18px;">Step 2 · Modules</div>
          <div id="cc-modules"></div>
          <button class="btn btn-sm btn-outline-secondary" id="cc-add-mod" style="margin-top:8px;"><i class="bi bi-plus"></i> Add module</button>
          <div class="cc-section-title" style="margin-top:18px;">Step 3 · Topics</div>
          <div id="cc-mod-select"></div>
        </aside>
        <main class="cc-main" id="cc-main"></main>
      </div>
    `;
    const name = $('#cc-name'), desc = $('#cc-desc');
    name.value = this.draft.name || '';
    desc.value = this.draft.description || '';
    name.addEventListener('input', () => { this.draft.name = name.value; this._scheduleAutosave(); this._renderModules(); });
    desc.addEventListener('input', () => { this.draft.description = desc.value; this._scheduleAutosave(); });
    $('#cc-add-mod').addEventListener('click', () => this._addModule());
  },
  _renderContent() {
    this._renderModules();
    this._renderSelectModule();
    this._renderMain();
  },
  _renderModules() {
    const wrap = $('#cc-modules'); if (!wrap) return;
    if (!this.draft.modules.length) { wrap.innerHTML = '<div class="text-muted-2" style="font-size:12px;">No modules yet.</div>'; return; }
    wrap.innerHTML = this.draft.modules.map((m, i) => `
      <div class="cc-mod-row ${i === this.activeModule ? 'active' : ''}" data-idx="${i}">
        <input class="form-control form-control-sm cc-mod-name" data-idx="${i}" value="${escapeHtml(m.name)}">
        <button class="btn btn-sm btn-link text-danger cc-del-mod" data-idx="${i}" title="Delete module"><i class="bi bi-trash"></i></button>
      </div>
    `).join('');
    $$('.cc-mod-name', wrap).forEach(inp => {
      inp.addEventListener('focus', () => { this.activeModule = +inp.dataset.idx; this._renderModules(); this._renderSelectModule(); this._renderMain(); });
      inp.addEventListener('input', () => { this.draft.modules[+inp.dataset.idx].name = inp.value; this._scheduleAutosave(); this._renderMain(); });
    });
    $$('.cc-del-mod', wrap).forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.dataset.idx;
      if (this.draft.modules.length === 1) { Toast.warning('Need at least one module'); return; }
      this.draft.modules.splice(i, 1);
      if (this.activeModule >= this.draft.modules.length) this.activeModule = this.draft.modules.length - 1;
      this._scheduleAutosave(); this._renderContent();
    }));
  },
  _renderSelectModule() {
    const wrap = $('#cc-mod-select'); if (!wrap) return;
    wrap.innerHTML = `
      <select class="form-select form-select-sm" id="cc-active-sel">
        ${this.draft.modules.map((m, i) => `<option value="${i}" ${i === this.activeModule ? 'selected' : ''}>${escapeHtml(m.name || `Module ${i + 1}`)}</option>`).join('')}
      </select>
    `;
    $('#cc-active-sel').addEventListener('change', (e) => { this.activeModule = +e.target.value; this._renderModules(); this._renderMain(); });
  },
  _renderMain() {
    const main = $('#cc-main'); if (!main) return;
    const m = this.draft.modules[this.activeModule];
    if (!m) { main.innerHTML = ''; return; }
    main.innerHTML = `
      <div class="d-flex align-items-center gap-2 mb-3">
        <h6 class="m-0 flex-grow-1">Topics in: <span class="text-accent">${escapeHtml(m.name || 'Module')}</span></h6>
        <span class="text-muted-2" style="font-size:12px;">${(m.topics || []).length} topic(s)</span>
      </div>
      <div class="cc-topic-add">
        <div class="row g-2">
          <div class="col-md-4"><input id="cc-t-name" class="form-control form-control-sm" placeholder="Topic name"></div>
          <div class="col-md-3"><select id="cc-t-type" class="form-select form-select-sm"></select></div>
          <div class="col-md-4" id="cc-t-dyn"></div>
          <div class="col-md-1"><button class="btn btn-sm btn-accent w-100" id="cc-t-add"><i class="bi bi-plus-lg"></i></button></div>
        </div>
      </div>
      <div id="cc-topics-preview" class="mt-3"></div>
    `;
    const typeSel = $('#cc-t-type');
    typeSel.innerHTML = Object.keys(CONTENT_TYPE_LABEL).map(k => `<option value="${k}">${escapeHtml(CONTENT_TYPE_LABEL[k])}</option>`).join('');
    typeSel.value = 'website';
    this._renderTypeFields('website');
    typeSel.addEventListener('change', () => this._renderTypeFields(typeSel.value));
    $('#cc-t-add').addEventListener('click', () => this._addTopic());
    this._renderTopicsPreview();
  },
  _renderTypeFields(type) {
    const dyn = $('#cc-t-dyn'); if (!dyn) return;
    if (type === 'youtube' || type === 'website' || type === 'video' || type === 'audio' || type === 'image' || type === 'pdf' || type === 'document') {
      dyn.innerHTML = `<input id="cc-t-url" class="form-control form-control-sm" placeholder="${type === 'website' ? 'https://…' : type === 'youtube' ? 'YouTube URL' : 'https://… or /offline-files/…'}">`;
    } else if (type === 'markdown' || type === 'text' || type === 'text_content') {
      dyn.innerHTML = `<input id="cc-t-url" class="form-control form-control-sm" placeholder="Paste content or path">`;
    } else {
      dyn.innerHTML = `<input id="cc-t-url" class="form-control form-control-sm" placeholder="URL or path">`;
    }
  },
  _addTopic() {
    const name = $('#cc-t-name').value.trim();
    const type = $('#cc-t-type').value;
    const val = ($('#cc-t-url') && $('#cc-t-url').value) || '';
    if (!name) { Toast.warning('Topic name is required'); return; }
    const t = { id: uuid(), name, content_type: type };
    if (type === 'markdown' || type === 'text' || type === 'text_content') {
      if (val.startsWith('http')) t.url = val; else t.content = val;
    } else t.url = val;
    const m = this.draft.modules[this.activeModule];
    m.topics = m.topics || []; m.topics.push(t);
    $('#cc-t-name').value = ''; if ($('#cc-t-url')) $('#cc-t-url').value = '';
    this._scheduleAutosave();
    this._renderTopicsPreview();
    this._renderModules();
  },
  _renderTopicsPreview() {
    const wrap = $('#cc-topics-preview'); if (!wrap) return;
    const m = this.draft.modules[this.activeModule]; if (!m) return;
    const topics = m.topics || [];
    if (!topics.length) { wrap.innerHTML = '<div class="text-muted-2" style="font-size:12px;">No topics yet. Add one above.</div>'; return; }
    wrap.innerHTML = topics.map((t, i) => `
      <div class="cc-topic-row">
        <i class="bi bi-${TYPE_BADGE_ICON[t.content_type] || 'link-45deg'}"></i>
        <span class="flex-grow-1">${escapeHtml(t.name)}</span>
        <span class="text-muted-2" style="font-size:11px;">${escapeHtml(CONTENT_TYPE_LABEL[t.content_type] || '')}</span>
        <button class="btn btn-sm btn-link text-danger" data-idx="${i}"><i class="bi bi-x"></i></button>
      </div>
    `).join('');
    $$('button[data-idx]', wrap).forEach(btn => btn.addEventListener('click', () => {
      const i = +btn.dataset.idx;
      this.draft.modules[this.activeModule].topics.splice(i, 1);
      this._scheduleAutosave();
      this._renderTopicsPreview();
    }));
  },
  _addModule() {
    this.draft.modules.push({ name: `Module ${this.draft.modules.length + 1}`, topics: [] });
    this.activeModule = this.draft.modules.length - 1;
    this._scheduleAutosave(); this._renderContent();
  },
  async _save() {
    if (!this.draft.name || !this.draft.name.trim()) { Toast.warning('Course name is required'); return; }
    if (!this.draft.modules.length) { Toast.warning('Add at least one module'); return; }
    try {
      DS.showLoader('Saving…');
      const r = await API.post('/api/courses', this.draft);
      DS.hideLoader();
      AppState.course = r.course; AppState.stats = r.stats; AppState.selectedModuleId = r.course.modules[0] ? r.course.modules[0].id : null;
      try { await API.del('/api/temp-course'); } catch (e) {}
      this.draft = null;
      this.bsModal.hide();
      Navbar.render(); Sidebar.render(); Main.render();
      Toast.success('Course created');
    } catch (e) { DS.hideLoader(); Toast.error('Save failed', e.message); }
  }
};

const ModifyCourse = {
  el: null, bsModal: null,
  init() {
    if (this.el) return;
    this.el = document.getElementById('modifyCourseModal');
    if (!this.el) return;
    this.bsModal = new bootstrap.Modal(this.el, { backdrop: true, keyboard: true });
  },
  open() {
    this.init();
    if (!AppState.course) { Toast.warning('No course loaded'); return; }
    this._render();
    this.bsModal.show();
  },
  _render() {
    const body = $('#mc-body'); if (!body) return;
    body.innerHTML = `
      <div class="d-flex align-items-center mb-3">
        <input id="mc-name" class="form-control form-control-lg" value="${escapeHtml(AppState.course.name || '')}">
      </div>
      <textarea id="mc-desc" class="form-control mb-3" rows="2" placeholder="Description">${escapeHtml(AppState.course.description || '')}</textarea>
      <div class="d-flex gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" id="mc-add-mod"><i class="bi bi-plus-lg"></i> Add module</button>
        <span class="text-muted-2 ms-auto" style="font-size:12px;">${(AppState.course.modules || []).length} module(s)</span>
      </div>
      <div id="mc-accordion"></div>
    `;
    $('#mc-name').addEventListener('input', () => { AppState.course.name = $('#mc-name').value; });
    $('#mc-desc').addEventListener('input', () => { AppState.course.description = $('#mc-desc').value; });
    $('#mc-add-mod').addEventListener('click', () => this._addModule());
    this._renderAccordion();
  },
  _renderAccordion() {
    const wrap = $('#mc-accordion'); if (!wrap) return;
    const modules = AppState.course.modules || [];
    wrap.innerHTML = modules.map((m, mi) => `
      <div class="accordion-item mc-mod" data-mi="${mi}">
        <div class="accordion-header">
          <input class="form-control form-control-sm mc-mod-name" data-mi="${mi}" value="${escapeHtml(m.name)}">
          <div class="d-flex gap-1">
            <button class="btn btn-sm btn-link mc-up" data-mi="${mi}" title="Move up"><i class="bi bi-arrow-up"></i></button>
            <button class="btn btn-sm btn-link mc-down" data-mi="${mi}" title="Move down"><i class="bi bi-arrow-down"></i></button>
            <button class="btn btn-sm btn-link text-danger mc-del" data-mi="${mi}" title="Delete"><i class="bi bi-trash"></i></button>
          </div>
        </div>
        <div class="accordion-body" id="mc-mod-${mi}">
          <div class="d-flex gap-2 mb-2">
            <button class="btn btn-sm btn-outline-secondary mc-add-top" data-mi="${mi}"><i class="bi bi-plus"></i> Add topic</button>
          </div>
          <div class="mc-topics"></div>
        </div>
      </div>
    `).join('');

    $$('.mc-mod-name', wrap).forEach(inp => inp.addEventListener('input', () => { AppState.course.modules[+inp.dataset.mi].name = inp.value; }));
    $$('.mc-up', wrap).forEach(btn => btn.addEventListener('click', () => this._moveMod(+btn.dataset.mi, -1)));
    $$('.mc-down', wrap).forEach(btn => btn.addEventListener('click', () => this._moveMod(+btn.dataset.mi, 1)));
    $$('.mc-del', wrap).forEach(btn => btn.addEventListener('click', () => this._delMod(+btn.dataset.mi)));
    $$('.mc-add-top', wrap).forEach(btn => btn.addEventListener('click', () => this._addTopic(+btn.dataset.mi)));

    modules.forEach((m, mi) => this._renderTopicList(mi));
  },
  _renderTopicList(mi) {
    const wrap = $(`#mc-mod-${mi} .mc-topics`); if (!wrap) return;
    const topics = AppState.course.modules[mi].topics || [];
    if (!topics.length) { wrap.innerHTML = '<div class="text-muted-2" style="font-size:12px;">No topics.</div>'; return; }
    wrap.innerHTML = topics.map((t, ti) => this._topicRow(t, mi, ti)).join('');
    $$('.mc-t-name', wrap).forEach(inp => inp.addEventListener('input', () => { AppState.course.modules[+inp.dataset.mi].topics[+inp.dataset.ti].name = inp.value; }));
    $$('.mc-t-type', wrap).forEach(sel => sel.addEventListener('change', () => { AppState.course.modules[+sel.dataset.mi].topics[+sel.dataset.ti].content_type = sel.value; }));
    $$('.mc-t-url', wrap).forEach(inp => inp.addEventListener('input', () => { AppState.course.modules[+inp.dataset.mi].topics[+inp.dataset.ti].url = inp.value; }));
    $$('.mc-t-up', wrap).forEach(btn => btn.addEventListener('click', () => this._moveTopic(+btn.dataset.mi, +btn.dataset.ti, -1)));
    $$('.mc-t-down', wrap).forEach(btn => btn.addEventListener('click', () => this._moveTopic(+btn.dataset.mi, +btn.dataset.ti, 1)));
    $$('.mc-t-del', wrap).forEach(btn => btn.addEventListener('click', () => this._delTopic(+btn.dataset.mi, +btn.dataset.ti)));
  },
  _topicRow(t, mi, ti) {
    const types = Object.keys(CONTENT_TYPE_LABEL).map(k => `<option value="${k}" ${k === t.content_type ? 'selected' : ''}>${escapeHtml(CONTENT_TYPE_LABEL[k])}</option>`).join('');
    return `
      <div class="mc-topic-row">
        <input class="form-control form-control-sm mc-t-name" data-mi="${mi}" data-ti="${ti}" value="${escapeHtml(t.name || '')}" placeholder="Name">
        <select class="form-select form-select-sm mc-t-type" data-mi="${mi}" data-ti="${ti}">${types}</select>
        <input class="form-control form-control-sm mc-t-url" data-mi="${mi}" data-ti="${ti}" value="${escapeHtml(t.url || '')}" placeholder="URL or path">
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-link mc-t-up" data-mi="${mi}" data-ti="${ti}"><i class="bi bi-arrow-up"></i></button>
          <button class="btn btn-sm btn-link mc-t-down" data-mi="${mi}" data-ti="${ti}"><i class="bi bi-arrow-down"></i></button>
          <button class="btn btn-sm btn-link text-danger mc-t-del" data-mi="${mi}" data-ti="${ti}"><i class="bi bi-trash"></i></button>
        </div>
      </div>
    `;
  },
  _addModule() { AppState.course.modules.push({ id: uuid(), name: 'New module', topics: [] }); this._renderAccordion(); },
  _moveMod(i, dir) {
    const j = i + dir; if (j < 0 || j >= AppState.course.modules.length) return;
    arrayMove(AppState.course.modules, i, j); this._renderAccordion();
  },
  _delMod(i) {
    if (AppState.course.modules.length === 1) { Toast.warning('Need at least one module'); return; }
    if (!confirm('Delete this module and all its topics?')) return;
    AppState.course.modules.splice(i, 1); this._renderAccordion();
  },
  _addTopic(mi) {
    AppState.course.modules[mi].topics = AppState.course.modules[mi].topics || [];
    AppState.course.modules[mi].topics.push({ id: uuid(), name: 'New topic', content_type: 'website', url: '' });
    this._renderTopicList(mi);
  },
  _moveTopic(mi, ti, dir) {
    const arr = AppState.course.modules[mi].topics;
    const j = ti + dir; if (j < 0 || j >= arr.length) return;
    arrayMove(arr, ti, j); this._renderTopicList(mi);
  },
  _delTopic(mi, ti) {
    if (!confirm('Delete this topic?')) return;
    AppState.course.modules[mi].topics.splice(ti, 1); this._renderTopicList(mi);
  },
  async _save() {
    try {
      DS.showLoader('Saving…');
      const r = await API.put('/api/courses', AppState.course);
      DS.hideLoader();
      AppState.course = r.course; AppState.stats = r.stats;
      this.bsModal.hide();
      Navbar.render(); Sidebar.render(); Main.render();
      Toast.success('Course updated');
    } catch (e) { DS.hideLoader(); Toast.error('Save failed', e.message); }
  },
  async _discard() {
    if (!confirm('Discard all changes and reload from server?')) return;
    try {
      DS.showLoader('Reloading…');
      const r = await API.get('/api/courses');
      DS.hideLoader();
      AppState.course = r.course; AppState.stats = r.stats;
      this.bsModal.hide();
      Navbar.render(); Sidebar.render(); Main.render();
    } catch (e) { DS.hideLoader(); Toast.error('Reload failed', e.message); }
  }
};
