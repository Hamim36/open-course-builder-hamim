/* ============================================================================
   03-sidebar-main.js — Sidebar + Main content renderers
   ============================================================================ */
'use strict';

const Sidebar = {
  render() {
    const list = $('#sidebar-list');
    if (!list) return;
    if (!AppState.course || !AppState.course.modules) {
      list.innerHTML = '<div class="sidebar-empty">No course loaded</div>';
      return;
    }
    const q = (AppState.sidebarSearch || '').toLowerCase().trim();
    const mp = (AppState.stats && AppState.stats.module_progress) || {};
    const modules = AppState.course.modules.filter(m => !q || (m.name || '').toLowerCase().includes(q));
    if (!modules.length) {
      list.innerHTML = '<div class="sidebar-empty">No modules match</div>';
      return;
    }
    list.innerHTML = modules.map(m => {
      const p = mp[m.id] || { completed: 0, total: 0 };
      const pct = p.total ? Math.round((p.completed / p.total) * 100) : 0;
      const active = m.id === AppState.selectedModuleId;
      return `
        <div class="module-item ${active ? 'active' : ''}" data-mod="${escapeHtml(m.id)}">
          <div class="name">${escapeHtml(m.name)}</div>
          <div class="meta"><span>${p.completed}/${p.total} topics</span><span>${pct}%</span></div>
          <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');
    $$('.module-item', list).forEach(el => {
      el.addEventListener('click', () => {
        AppState.selectedModuleId = el.dataset.mod;
        Sidebar.render();
        Main.render();
      });
    });

    if (!AppState.selectedModuleId || !AppState.course.modules.find(m => m.id === AppState.selectedModuleId)) {
      AppState.selectedModuleId = modules[0] ? modules[0].id : null;
    }
  }
};

const Main = {
  render() {
    const main = $('#app-main');
    if (!main) return;
    if (!AppState.course) {
      main.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-mortarboard"></i>
          <h2>Welcome to Open Course Builder</h2>
          <p>You don't have a course yet. Create one or import an existing course JSON to get started.</p>
          <div class="d-flex gap-2">
            <button class="btn btn-accent" id="main-create"><i class="bi bi-plus-lg"></i> Create Course</button>
            <button class="btn btn-outline-secondary" id="main-import"><i class="bi bi-upload"></i> Import JSON</button>
          </div>
        </div>
      `;
      const c = $('#main-create'); if (c) c.addEventListener('click', () => CreateCourse.open());
      const i = $('#main-import'); if (i) i.addEventListener('click', () => Import.open());
      return;
    }
    const m = (AppState.course.modules || []).find(x => x.id === AppState.selectedModuleId);
    if (!m) {
      main.innerHTML = '<div class="empty-state"><i class="bi bi-collection"></i><h2>Select a module</h2></div>';
      return;
    }
    Session.trackModuleVisit(m.id);
    const mp = (AppState.stats && AppState.stats.module_progress && AppState.stats.module_progress[m.id]) || { completed: 0, total: (m.topics || []).length };
    const pct = mp.total ? Math.round((mp.completed / mp.total) * 100) : 0;
    const completedSet = new Set((AppState.stats && AppState.stats.completed_topics_list) || []);
    const topics = m.topics || [];
    const cards = topics.map(t => {
      const done = completedSet.has(t.id);
      const type = t.content_type || 'website';
      const typeLbl = CONTENT_TYPE_LABEL[type] || 'Other';
      const icon = TYPE_BADGE_ICON[type] || 'link-45deg';
      const desc = (t.description || t.url || t.local_path || '').toString();
      return `
        <div class="topic-card ${done ? 'completed' : ''}" data-mod="${escapeHtml(m.id)}" data-top="${escapeHtml(t.id)}">
          <div class="topic-check ${done ? 'checked' : ''}" data-act="toggle" data-mod="${escapeHtml(m.id)}" data-top="${escapeHtml(t.id)}"><i class="bi ${done ? 'bi-check-circle-fill' : 'bi-circle'}"></i></div>
          <div class="topic-info">
            <div class="topic-name">${escapeHtml(t.name)}</div>
            <div class="topic-desc">${escapeHtml(desc)}</div>
          </div>
          <span class="type-badge ${escapeHtml(type)}"><i class="bi bi-${icon}"></i> ${escapeHtml(typeLbl)}</span>
          <button class="btn btn-sm btn-outline-secondary btn-open-topic" data-act="open" data-mod="${escapeHtml(m.id)}" data-top="${escapeHtml(t.id)}">Open <i class="bi bi-arrow-right"></i></button>
        </div>
      `;
    }).join('');

    main.innerHTML = `
      <div class="module-header">
        <h4>${escapeHtml(m.name)}</h4>
        <div class="text-muted-2" style="font-size:12px;">${mp.completed} / ${mp.total} completed · ${pct}%</div>
      </div>
      <div class="module-progress"><div class="bar" style="width:${pct}%"></div></div>
      <div>${cards || '<div class="text-muted-2" style="text-align:center; padding:30px;">No topics in this module yet.</div>'}</div>
    `;

    $$('.topic-card', main).forEach(card => {
      card.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        if (!act) { TopicViewer.open(card.dataset.mod, card.dataset.top); return; }
        e.stopPropagation();
        if (act.dataset.act === 'open') TopicViewer.open(card.dataset.mod, card.dataset.top);
        else if (act.dataset.act === 'toggle') Main.toggleComplete(act.dataset.mod, act.dataset.top);
      });
    });
  },
  async toggleComplete(mid, tid) {
    const completedSet = new Set((AppState.stats && AppState.stats.completed_topics_list) || []);
    const isDone = completedSet.has(tid);
    try {
      const res = await API.patch(`/api/topics/${encodeURIComponent(tid)}/complete`, { completed: !isDone });
      AppState.stats = res.stats;
      Session.trackComplete();
      Main.render();
      Sidebar.render();
      Navbar.render();
      Toast.success(!isDone ? 'Marked complete' : 'Marked incomplete');
    } catch (e) { Toast.error('Failed to update', e.message); }
  }
};
