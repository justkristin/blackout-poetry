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
      });
    });

    centuryChipsEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.century;
        if (selectedCenturies.has(c)) selectedCenturies.delete(c);
        else { selectedCenturies.add(c); clearBookSelection(); }
        updateFilterUI();
      });
    });

    clearFiltersEl.addEventListener('click', () => {
      selectedGenres.clear();
      selectedCenturies.clear();
      updateFilterUI();
    });
  }

  function updateFilterUI() {
    genreChipsEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.classList.toggle('active', selectedGenres.has(btn.dataset.genre));
    });
    centuryChipsEl.querySelectorAll('.filter-chip').forEach(btn => {
      btn.classList.toggle('active', selectedCenturies.has(btn.dataset.century));
    });
    const hasFilters = selectedGenres.size > 0 || selectedCenturies.size > 0;
    clearFiltersEl.style.display = hasFilters ? '' : 'none';
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
    blackoutCanvas.meta = { book: currentBookData, page: currentPage };
    blackoutCanvas.setText(currentPage.text, canvasWidth());
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
  document.getElementById('btn-prev').addEventListener('click', async () => {
    if (!currentBookData || !currentPage) return;
    showLoading();
    const newOffset = Math.max(0, currentPage.charOffset - 1800);
    currentPage = extractPage(currentBookData.text, newOffset);
    await renderPage();
  });

  document.getElementById('btn-next').addEventListener('click', async () => {
    if (!currentBookData || !currentPage) return;
    showLoading();
    const newOffset = currentPage.charOffset + 1800;
    currentPage = extractPage(currentBookData.text, newOffset);
    await renderPage();
  });

  document.getElementById('btn-same-random').addEventListener('click', async () => {
    if (!currentBookData) return;
    showLoading();
    const offset = getRandomOffset(currentBookData.text.length);
    currentPage = extractPage(currentBookData.text, offset);
    await renderPage();
  });

  document.getElementById('btn-new-random').addEventListener('click', () => {
    loadRandomPage();
  });

  document.getElementById('btn-retry').addEventListener('click', () => {
    loadRandomPage();
  });

  // ── TOOLBAR ────────────────────────────────────────────────────────
  const unbrushBtn = document.getElementById('tool-unbrush');

  // Leaving unbrush mode whenever a drawing action is chosen — picking a
  // brush, a highlighter color, or a tool button all mean "I want to draw."
  function exitUnbrush() {
    blackoutCanvas.setUnbrush(false);
    unbrushBtn.classList.remove('active');
    bookPageEl.classList.remove('unbrush-active');
  }

  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setMode(btn.dataset.tool);
      exitUnbrush();
    });
  });

  unbrushBtn.addEventListener('click', () => {
    const next = !blackoutCanvas.unbrushActive;
    blackoutCanvas.setUnbrush(next);
    unbrushBtn.classList.toggle('active', next);
    bookPageEl.classList.toggle('unbrush-active', next);
  });

  document.querySelectorAll('.brush-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.brush-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setBrushSize(parseInt(btn.dataset.size));
      // Picking a blackout brush size implies you want to draw with it
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tool-ink').classList.add('active');
      blackoutCanvas.setMode('ink');
      exitUnbrush();
    });
  });

  document.querySelectorAll('.highlight-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.highlight-color-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      blackoutCanvas.setHighlightColor(btn.dataset.color);
      // Picking a highlighter color implies you want to highlight
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tool-highlight').classList.add('active');
      blackoutCanvas.setMode('highlight');
      exitUnbrush();
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
  const doSave = () => blackoutCanvas.download(currentBookData?.title);
  document.getElementById('btn-save').addEventListener('click', doSave);
  document.getElementById('btn-save-sidebar').addEventListener('click', doSave);
  document.getElementById('btn-share').addEventListener('click', doSave);

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
    bookInfoEl.style.display = 'none';
  }

  function showPage() {
    loadingEl.style.display  = 'none';
    errorEl.style.display    = 'none';
    bookPageEl.style.display = 'block';
    pageNavEl.style.display  = 'flex';
    bookInfoEl.style.display = 'block';
  }

  function showError(msg) {
    loadingEl.style.display  = 'none';
    errorEl.style.display    = 'block';
    bookPageEl.style.display = 'none';
    pageNavEl.style.display  = 'none';
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
