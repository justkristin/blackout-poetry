(async function() {

  // ── STATE ──────────────────────────────────────────────────────────
  let manifest = [];
  let selectedGenres    = new Set();
  let selectedCenturies = new Set();
  let selectedBookId    = null;   // set when user picks from autocomplete

  let currentBookData = null;     // { id, title, author, text, gutenberg_url, wikipedia }
  let currentPage     = null;     // result of extractPage()
  let blackoutCanvas  = null;

  // ── ELEMENTS ───────────────────────────────────────────────────────
  const loadingEl        = document.getElementById('loading-state');
  const errorEl          = document.getElementById('error-state');
  const errorMsgEl       = document.getElementById('error-message');
  const bookPageEl       = document.getElementById('book-page');
  const pageNavEl        = document.getElementById('page-nav');
  const pageNavTopEl     = document.getElementById('page-nav-top');
  const pageNavDividerEl = document.getElementById('page-nav-divider');
  const bookTitleEl      = document.getElementById('book-title');
  const bookChapterEl    = document.getElementById('book-chapter');
  const bookAuthorEl     = document.getElementById('book-author');
  const pageNumEl        = document.getElementById('page-number');
  const canvasEl         = document.getElementById('blackout-canvas');
  const bookInfoEl       = document.getElementById('book-info');
  const sidebarTitleEl   = document.getElementById('sidebar-book-title');
  const sidebarAuthorEl  = document.getElementById('sidebar-book-author');
  const sidebarLinksEl   = document.getElementById('sidebar-book-links');
  const genreChipsEl     = document.getElementById('genre-chips');
  const centuryChipsEl   = document.getElementById('century-chips');
  const clearFiltersEl   = document.getElementById('clear-filters');
  const filtersCountBadgeEl = document.getElementById('filters-count-badge');
  const bookInputEl      = document.getElementById('book-search');
  const autocompleteEl   = document.getElementById('autocomplete-list');

  // ── CANVAS WIDTH HELPER ── add it right here ──────────────────────
  function canvasWidth() {
    const style = getComputedStyle(bookPageEl);
    return bookPageEl.clientWidth 
      - parseFloat(style.paddingLeft) 
      - parseFloat(style.paddingRight);
  }

  // ── INIT ───────────────────────────────────────────────────────────
  blackoutCanvas = new BlackoutCanvas(canvasEl);

  // On a narrow (mobile) viewport, every accordion starts collapsed —
  // the markup defaults them all to `open` so desktop, and anyone
  // without JS, just sees everything expanded as before.
  if (window.matchMedia('(max-width: 768px)').matches) {
    document.querySelectorAll('.sidebar-section, .filters-accordion').forEach(d => {
      if (d.id !== 'book-info') d.removeAttribute('open'); // Source stays open — a visible link to what you're already working on
    });
  }

  const sidebarEl = document.querySelector('.sidebar');
  const fabMainEl = document.getElementById('sidebar-open-fab');
  let sidebarSavedScrollY = 0;

  function openSidebar() {
    fabMainEl.classList.remove('expanded'); // cluster collapses behind the drawer
    sidebarSavedScrollY = window.scrollY;
    // iOS Safari doesn't reliably respect `overflow:hidden` on body to
    // stop background scroll — pinning it with `position:fixed` does.
    document.body.style.position = 'fixed';
    document.body.style.top = `-${sidebarSavedScrollY}px`;
    document.body.style.width = '100%';
    sidebarEl.classList.add('sidebar-open');
  }

  function closeSidebar() {
    sidebarEl.classList.remove('sidebar-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    window.scrollTo(0, sidebarSavedScrollY);
  }

  // Main ▓: idle → reveals the quick-access cluster (toggle/undo/drawer).
  // Tapped again while the cluster is showing, it collapses back to idle —
  // it does NOT open the drawer itself anymore; that's #fab-drawer's job.
  fabMainEl.addEventListener('click', () => {
    fabMainEl.classList.toggle('expanded');
  });

  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('fab-drawer').addEventListener('click', openSidebar);

  const storageWarningEl = document.getElementById('storage-warning');
  document.getElementById('storage-warning-dismiss').addEventListener('click', () => {
    storageWarningEl.style.display = 'none';
  });
  blackoutCanvas.onStorageError = () => {
    storageWarningEl.style.display = 'flex';
  };

  try {
    manifest = await loadManifest();
    buildFilterUI();
  } catch(e) {
    showError('Could not load the book list. Please refresh.');
    return;
  }

  // Try to restore saved session
  const saved = blackoutCanvas.loadState();
  if (saved && saved.text) {
    if (saved.meta && saved.meta.book) {
      currentBookData = saved.meta.book;
      currentPage = saved.meta.page;
      populateBookUI();
    }
    showPage();
    blackoutCanvas.setText(saved.text, canvasWidth());
    blackoutCanvas.render();
    // Lock fonts if restored session has strokes
    if (blackoutCanvas.strokes.length > 0) {
      document.querySelectorAll('.font-btn').forEach(b => b.classList.add('locked'));
    }
  } else {
    await loadRandomPage();
  }

  // ── FILTER UI ──────────────────────────────────────────────────────
  function buildFilterUI() {
    // Genre chips
    genreChipsEl.innerHTML = allGenres(manifest).map(g =>
      `<button class="filter-chip" data-genre="${escAttr(g)}">${escHtml(g)}</button>`
    ).join('');

    // Century chips
    centuryChipsEl.innerHTML = allCenturies(manifest).map(c =>
      `<button class="filter-chip" data-century="${escAttr(c)}">${escHtml(c)}</button>`
    ).join('');

    // Chip click handlers
    genreChipsEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const g = btn.dataset.genre;
        if (selectedGenres.has(g)) selectedGenres.delete(g);
        else { selectedGenres.add(g); clearBookSelection(); }
        updateFilterUI();
        scheduleFilteredLoad();
      });
    });

    centuryChipsEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.century;
        if (selectedCenturies.has(c)) selectedCenturies.delete(c);
        else { selectedCenturies.add(c); clearBookSelection(); }
        updateFilterUI();
        scheduleFilteredLoad();
      });
    });

    clearFiltersEl.addEventListener('click', () => {
      selectedGenres.clear();
      selectedCenturies.clear();
      updateFilterUI();
      scheduleFilteredLoad();
    });
  }

  // Filter changes trigger a new random page automatically, debounced
  // slightly so clicking several chips in a row doesn't fire a page
  // load per click.
  let filterLoadTimeout = null;
  function scheduleFilteredLoad() {
    clearTimeout(filterLoadTimeout);
    filterLoadTimeout = setTimeout(() => {
      loadRandomPage();
    }, 200);
  }

  function updateFilterUI() {
    genreChipsEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.classList.toggle('active', selectedGenres.has(btn.dataset.genre));
    });
    centuryChipsEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.classList.toggle('active', selectedCenturies.has(btn.dataset.century));
    });
    const count = selectedGenres.size + selectedCenturies.size;
    const hasFilters = count > 0;
    clearFiltersEl.style.display = hasFilters ? '' : 'none';
    filtersCountBadgeEl.textContent = count;
    filtersCountBadgeEl.style.display = hasFilters ? '' : 'none';
  }

  // ── BOOK AUTOCOMPLETE ──────────────────────────────────────────────
  let acTimeout = null;

  bookInputEl.addEventListener('input', () => {
    selectedBookId = null;
    selectedGenres.clear();
    selectedCenturies.clear();
    updateFilterUI();
    clearTimeout(acTimeout);
    acTimeout = setTimeout(showAutocomplete, 120);
  });

  bookInputEl.addEventListener('focus', () => {
    if (bookInputEl.value) showAutocomplete();
  });

  bookInputEl.addEventListener('blur', () => {
    setTimeout(() => autocompleteEl.classList.remove('open'), 180);
  });

  function showAutocomplete() {
    const q = bookInputEl.value.toLowerCase().trim();
    if (!q) { autocompleteEl.classList.remove('open'); return; }

    const matches = manifest.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.author.toLowerCase().includes(q)
    ).slice(0, 8);

    if (!matches.length) { autocompleteEl.classList.remove('open'); return; }

    autocompleteEl.innerHTML = matches.map(b => `
      <div class="ac-item" data-id="${escAttr(b.id)}">
        <span class="ac-title">${escHtml(b.title)}</span>
        <span class="ac-author">${escHtml(b.author)}, ${b.year < 0 ? 'c.' + Math.abs(b.year) + ' BCE' : b.year}</span>
      </div>`
    ).join('');

    autocompleteEl.querySelectorAll('.ac-item').forEach(item => {
      item.addEventListener('mousedown', () => {
        selectedBookId = item.dataset.id;
        const book = manifest.find(b => b.id === selectedBookId);
        if (book) bookInputEl.value = book.title + ' — ' + book.author;
        autocompleteEl.classList.remove('open');
        selectedGenres.clear();
        selectedCenturies.clear();
        updateFilterUI();
        loadRandomPage();
      });
    });

    autocompleteEl.classList.add('open');
  }

  function clearBookSelection() {
    selectedBookId = null;
    bookInputEl.value = '';
  }

  // ── PAGE LOADING ───────────────────────────────────────────────────
  async function loadRandomPage() {
    showLoading();
    try {
      let book;
      if (selectedBookId) {
        book = manifest.find(b => b.id === selectedBookId);
      } else {
        book = getRandomBook(
          manifest,
          [...selectedGenres],
          [...selectedCenturies]
        );
      }

      if (!book) {
        showError('No books match your filters. Try clearing some.');
        return;
      }

      // Only fetch text if different book
      if (!currentBookData || currentBookData.id !== book.id) {
        currentBookData = await fetchBookText(book);
      }

      const offset = getRandomOffset(currentBookData.text.length);
      currentPage = extractPage(currentBookData.text, offset);
      await renderPage();
    } catch(e) {
      console.error(e);
      showError('Couldn\'t load a page. Please try again.');
    }
  }

  async function renderPage() {
    if (!currentBookData || !currentPage) return;
    populateBookUI();
    showPage();
    blackoutCanvas.strokes = [];
    blackoutCanvas.highlights = [];
    blackoutCanvas.meta = { book: currentBookData, page: currentPage };
    blackoutCanvas.setText(currentPage.text, canvasWidth());
    // Fresh page, fresh strokes — the font picker shouldn't still look
    // locked from whatever you did on the previous page.
    document.querySelectorAll('.font-btn').forEach(b => b.classList.remove('locked'));
  }

  function populateBookUI() {
    if (!currentBookData) return;
    const year = currentBookData.year < 0
      ? 'c.' + Math.abs(currentBookData.year) + ' BCE'
      : currentBookData.year;

    bookTitleEl.textContent   = currentBookData.title;
    bookChapterEl.textContent = (currentPage && currentPage.chapter) || '';
    bookAuthorEl.textContent  = currentBookData.author + ', ' + year;
    pageNumEl.textContent     = currentPage ? ('p. ' + currentPage.pageNum) : '';

    // Sidebar
    sidebarTitleEl.textContent  = currentBookData.title;
    sidebarAuthorEl.textContent = currentBookData.author;

    // Sidebar links
    let links = `<a href="${escAttr(currentBookData.gutenberg_url)}" target="_blank" class="sidebar-link">Gutenberg ↗</a>`;
    if (currentBookData.wikipedia) {
      links += `<a href="${escAttr(currentBookData.wikipedia)}" target="_blank" class="sidebar-link">Wikipedia ↗</a>`;
    }
    sidebarLinksEl.innerHTML = links;
  }

  // ── NAVIGATION ─────────────────────────────────────────────────────
  async function goPrev() {
    if (!currentBookData || !currentPage) return;
    showLoading();
    const newOffset = Math.max(0, currentPage.charOffset - 1800);
    currentPage = extractPage(currentBookData.text, newOffset);
    await renderPage();
  }

  async function goNext() {
    if (!currentBookData || !currentPage) return;
    showLoading();
    const newOffset = currentPage.charOffset + 1800;
    currentPage = extractPage(currentBookData.text, newOffset);
    await renderPage();
  }

  async function goSameRandom() {
    if (!currentBookData) return;
    showLoading();
    const offset = getRandomOffset(currentBookData.text.length);
    currentPage = extractPage(currentBookData.text, offset);
    await renderPage();
  }

  // Wire both the top and bottom nav rows to the same functions, so
  // they can never drift out of sync with each other.
  ['btn-prev', 'btn-prev-top'].forEach(id =>
    document.getElementById(id).addEventListener('click', goPrev)
  );
  ['btn-next', 'btn-next-top'].forEach(id =>
    document.getElementById(id).addEventListener('click', goNext)
  );
  ['btn-same-random', 'btn-same-random-top'].forEach(id =>
    document.getElementById(id).addEventListener('click', goSameRandom)
  );

  document.getElementById('btn-new-random').addEventListener('click', () => {
    loadRandomPage();
  });

  document.getElementById('btn-retry').addEventListener('click', () => {
    loadRandomPage();
  });

  // ── TOOLBAR ────────────────────────────────────────────────────────
  const unbrushInkBtn       = document.getElementById('btn-unbrush-ink');
  const unbrushHighlightBtn = document.getElementById('btn-unbrush-highlight');
  const sectionBlackoutEl   = document.getElementById('section-blackout');
  const sectionHighlightEl  = document.getElementById('section-highlight');
  const fabToggleEl         = document.getElementById('fab-toggle');
  const fabToggleDotEl      = document.getElementById('fab-toggle-dot');

  // The Tool toggle is gone — instead, whichever section (blackout or
  // highlighter) matches the current mode gets a subtle background tint,
  // so "what's currently active" reads from the section itself. The
  // mobile quick-toggle dot rides along here too, so every existing
  // call site keeps it in sync for free — black for ink, or whatever
  // highlighter color is actually currently selected.
  function syncActiveSection() {
    const isHighlight = blackoutCanvas.mode === 'highlight';
    sectionBlackoutEl.classList.toggle('tool-section-active', !isHighlight);
    sectionHighlightEl.classList.toggle('tool-section-active', isHighlight);
    fabToggleDotEl.style.background = isHighlight ? blackoutCanvas.highlightColor : '#1a1a1a';
  }
  syncActiveSection(); // reflect the default ('ink') on load

  fabToggleEl.addEventListener('click', () => {
    blackoutCanvas.setMode(blackoutCanvas.mode === 'highlight' ? 'ink' : 'highlight');
    exitUnbrush();
    syncActiveSection();
  });

  document.getElementById('fab-undo').addEventListener('click', () => {
    if (blackoutCanvas.mode === 'highlight') {
      blackoutCanvas.undoHighlight();
    } else {
      blackoutCanvas.undo();
    }
  });

  // Leaving unbrush mode whenever a drawing action is chosen — picking a
  // brush or a highlighter color both mean "I want to draw."
  function exitUnbrush() {
    blackoutCanvas.setUnbrush(false);
    unbrushInkBtn.classList.remove('active');
    unbrushHighlightBtn.classList.remove('active');
    bookPageEl.classList.remove('unbrush-active');
  }

  // Each unbrush button is self-contained: it both picks its layer and
  // arms unbrush.
  function enterUnbrush(mode, btn) {
    blackoutCanvas.setMode(mode);
    blackoutCanvas.setUnbrush(true);
    unbrushInkBtn.classList.toggle('active', btn === unbrushInkBtn);
    unbrushHighlightBtn.classList.toggle('active', btn === unbrushHighlightBtn);
    bookPageEl.classList.add('unbrush-active');
    syncActiveSection();
  }

  unbrushInkBtn.addEventListener('click', () => {
    if (blackoutCanvas.unbrushActive && blackoutCanvas.mode === 'ink') {
      exitUnbrush();
    } else {
      enterUnbrush('ink', unbrushInkBtn);
    }
  });

  unbrushHighlightBtn.addEventListener('click', () => {
    if (blackoutCanvas.unbrushActive && blackoutCanvas.mode === 'highlight') {
      exitUnbrush();
    } else {
      enterUnbrush('highlight', unbrushHighlightBtn);
    }
  });

  document.querySelectorAll('.linemode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.linemode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setLineMode(btn.dataset.linemode === 'line');
    });
  });

  document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setExportShape(btn.dataset.shape);
    });
  });

  document.querySelectorAll('.brush-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setBrushSize(parseInt(btn.dataset.size));
      // Picking a blackout brush size implies you want to draw with it
      blackoutCanvas.setMode('ink');
      exitUnbrush();
      syncActiveSection();
    });
  });

  document.querySelectorAll('.highlight-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.highlight-color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setHighlightColor(btn.dataset.color);
      // Picking a highlighter color implies you want to highlight
      blackoutCanvas.setMode('highlight');
      exitUnbrush();
      syncActiveSection();
    });
  });

  document.getElementById('btn-clear-highlights').addEventListener('click', () => {
    blackoutCanvas.clearHighlights();
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
      if (blackoutCanvas.strokes.length > 0) return; // locked after first stroke
      document.querySelectorAll('.font-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setFont(btn.dataset.font);
    });
  });

  document.getElementById('btn-undo').addEventListener('click', () => {
    blackoutCanvas.undo();
  });

  document.getElementById('btn-micro-undo').addEventListener('click', () => {
    blackoutCanvas.microUndo();
  });

  // ── SAVE / SHARE ───────────────────────────────────────────────────
  // iOS Safari has no way to save a file straight into Photos — the
  // share sheet's "Save Image" is the only path there. So "save poem"
  // goes through share() on iOS specifically (worth the extra tap to
  // land in Photos), and stays a plain direct download everywhere else.
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac
  }

  const doSave  = () => {
    if (isIOS()) {
      blackoutCanvas.share(currentBookData?.title);
    } else {
      blackoutCanvas.download(currentBookData?.title);
    }
  };
  const doShare = () => blackoutCanvas.share(currentBookData?.title);
  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('btn-save-sidebar').addEventListener('click', doSave);
  document.getElementById('btn-share').addEventListener('click', doShare);

  document.getElementById('btn-start-over').addEventListener('click', () => {
    if (confirm('Start over? Your current poem will be lost.')) {
      localStorage.removeItem('blackout_state');
      loadRandomPage();
    }
  });

  // ── UI STATE ───────────────────────────────────────────────────────
  function showLoading() {
    loadingEl.style.display  = 'block';
    errorEl.style.display    = 'none';
    bookPageEl.style.display = 'none';
    pageNavEl.style.display  = 'none';
    pageNavTopEl.style.display = 'none';
    pageNavDividerEl.style.display = 'none';
    bookInfoEl.style.display = 'none';
  }

  function showPage() {
    loadingEl.style.display  = 'none';
    errorEl.style.display    = 'none';
    bookPageEl.style.display = 'block';
    pageNavEl.style.display  = 'flex';
    pageNavTopEl.style.display = 'flex';
    pageNavDividerEl.style.display = 'block';
    bookInfoEl.style.display = 'block';
  }

  function showError(msg) {
    loadingEl.style.display  = 'none';
    errorEl.style.display    = 'block';
    bookPageEl.style.display = 'none';
    pageNavEl.style.display  = 'none';
    pageNavTopEl.style.display = 'none';
    pageNavDividerEl.style.display = 'none';
    errorMsgEl.textContent   = msg;
  }

  // ── UTILS ──────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) { return escHtml(s); }

})();
