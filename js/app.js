(async function() {

  // ── STATE ──────────────────────────────────
  let currentBookId = null;
  let currentBookData = null;
  let currentOffset = 0;
  let currentEra = 'all';
  let blackoutCanvas = null;
  let currentPage = null;

  // ── ELEMENTS ───────────────────────────────
  const loadingEl = document.getElementById('loading-state');
  const errorEl = document.getElementById('error-state');
  const errorMsgEl = document.getElementById('error-message');
  const bookPageEl = document.getElementById('book-page');
  const pageNavEl = document.getElementById('page-nav');
  const bookTitleEl = document.getElementById('book-title');
  const bookChapterEl = document.getElementById('book-chapter');
  const bookAuthorEl = document.getElementById('book-author');
  const pageNumEl = document.getElementById('page-number');
  const canvasEl = document.getElementById('blackout-canvas');
  const bookInfoEl = document.getElementById('book-info');
  const sidebarBookTitleEl = document.getElementById('sidebar-book-title');
  const sidebarBookAuthorEl = document.getElementById('sidebar-book-author');

  // ── INIT ───────────────────────────────────
  blackoutCanvas = new BlackoutCanvas(canvasEl);

  // Try to restore saved state
  const saved = blackoutCanvas.loadState();
  if (saved && saved.text) {
    // Restore previous session
    showPage();
    blackoutCanvas.setText(saved.text, bookPageEl.clientWidth - 80);
    blackoutCanvas.render();
  } else {
    // Load a fresh random page
    await loadRandomPage();
  }

  // ── LOAD PAGE ──────────────────────────────
  async function loadRandomPage(era = currentEra) {
    showLoading();
    try {
      currentBookId = getRandomBook(era);
      currentBookData = await fetchBookText(currentBookId);
      currentOffset = getRandomOffset(currentBookData.text.length);
      await renderPage();
    } catch(e) {
      showError('Couldn\'t load a page. Please try again.');
    }
  }

  async function renderPage() {
    currentPage = extractPage(currentBookData.text, currentOffset);

    // Update header info
    bookTitleEl.textContent = currentBookData.title;
    bookChapterEl.textContent = currentPage.chapter || '';
    bookAuthorEl.textContent = currentBookData.author;
    pageNumEl.textContent = `p. ${currentPage.pageNum}`;

    // Update sidebar
    sidebarBookTitleEl.textContent = currentBookData.title;
    sidebarBookAuthorEl.textContent = currentBookData.author;

    showPage();

    // Render canvas
    const width = bookPageEl.clientWidth - 80;
    blackoutCanvas.strokes = [];
    blackoutCanvas.setText(currentPage.text, width);
  }

  // ── NAVIGATION ─────────────────────────────
  document.getElementById('btn-prev').addEventListener('click', async () => {
    if (!currentBookData || !currentPage) return;
    currentOffset = Math.max(0, currentPage.charOffset - 1800);
    showLoading();
    await renderPage();
  });

  document.getElementById('btn-next').addEventListener('click', async () => {
    if (!currentBookData || !currentPage) return;
    currentOffset = currentPage.charOffset + 1800;
    showLoading();
    await renderPage();
  });

  document.getElementById('btn-same-random').addEventListener('click', async () => {
    if (!currentBookData) return;
    currentOffset = getRandomOffset(currentBookData.text.length);
    showLoading();
    await renderPage();
  });

  document.getElementById('btn-new-random').addEventListener('click', () => {
    loadRandomPage();
  });

  document.getElementById('btn-retry').addEventListener('click', () => {
    loadRandomPage();
  });

  // ── ERA FILTERS ────────────────────────────
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEra = btn.dataset.filter;
      loadRandomPage(currentEra);
    });
  });

  // ── REDACT-O-MATIC ─────────────────────────
  document.querySelectorAll('.brush-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setBrushSize(parseInt(btn.dataset.size));
    });
  });

  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setPageColor(btn.dataset.color);
    });
  });

  document.querySelectorAll('.font-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.font-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setFont(btn.dataset.font);
    });
  });

  document.getElementById('btn-undo').addEventListener('click', () => {
    blackoutCanvas.undo();
  });

  // ── SAVE / SHARE ───────────────────────────
  const doSave = () => {
    blackoutCanvas.download(currentBookData?.title);
  };

  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('btn-save-sidebar').addEventListener('click', doSave);

  document.getElementById('btn-share').addEventListener('click', () => {
    blackoutCanvas.download(currentBookData?.title);
  });

  document.getElementById('btn-start-over').addEventListener('click', () => {
    if (confirm('Start over? Your current poem will be lost.')) {
      localStorage.removeItem('blackout_state');
      loadRandomPage();
    }
  });

  // ── UI HELPERS ─────────────────────────────
  function showLoading() {
    loadingEl.style.display = 'block';
    errorEl.style.display = 'none';
    bookPageEl.style.display = 'none';
    pageNavEl.style.display = 'none';
    bookInfoEl.style.display = 'none';
  }

  function showPage() {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'none';
    bookPageEl.style.display = 'block';
    pageNavEl.style.display = 'flex';
    bookInfoEl.style.display = 'block';
  }

  function showError(msg) {
    loadingEl.style.display = 'none';
    errorEl.style.display = 'block';
    bookPageEl.style.display = 'none';
    pageNavEl.style.display = 'none';
    errorMsgEl.textContent = msg;
  }

})();
