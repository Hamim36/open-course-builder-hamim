/* ============================================================================
   07-init.js — Bootstrap application: load data, render, attach handlers
   ============================================================================ */
'use strict';

async function loadInitialData() {
  try {
    const [course, stats, settings] = await Promise.all([
      API.get('/api/courses'),
      API.get('/api/stats'),
      API.get('/api/settings').catch(() => ({}))
    ]);
    AppState.course = course.course;
    AppState.stats = stats;
    AppState.settings = settings || {};
    if (AppState.course && AppState.course.modules && AppState.course.modules.length) {
      AppState.selectedModuleId = AppState.course.modules[0].id;
    }
  } catch (e) {
    Toast.error('Failed to load course', e.message);
  }
}

function startClocks() {
  Navbar.updateClock();
  setInterval(() => Navbar.updateClock(), 1000);
}

document.addEventListener('DOMContentLoaded', async () => {
  wireErrorHandlers();
  wireGlobal();
  wireKeyboard();

  // Initialize all modals (creates bsModal instances)
  CreateCourse.init();
  ModifyCourse.init();
  Import.init();
  Export.init();
  GitModal.init();
  TopicViewer.init();

  // Sidebar search
  const search = $('#sidebar-search');
  if (search) {
    let t = null;
    search.addEventListener('input', () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { AppState.sidebarSearch = search.value; Sidebar.render(); }, 150);
    });
  }

  // Heatmap close button
  const heatClose = $('#heatmap-close');
  if (heatClose) heatClose.addEventListener('click', () => Heatmap.close());

  await loadInitialData();
  Navbar.render();
  Sidebar.render();
  Main.render();
  Heatmap._renderGrid();
  startClocks();
  Session.start();
});
