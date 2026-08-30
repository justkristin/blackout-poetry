class BlackoutCanvas {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.painting = false;
    this.brushSize = 16;
    this.strokes = []; // for undo
    this.highlights = []; // highlighter marks, drawn under text
    this.highlightSize = 16; // fixed size for highlighter — not user-selectable
    this.currentStroke = [];
    this.mode = 'ink'; // 'ink' (blackout) | 'highlight'
    this.highlightColor = '#fff176';
    this.pageColor = '#faf8f3';
    this.font = 'Lora';
    this.fontSize = 13;
    this.lineHeight = 1.8;
    this.text = '';
    this.meta = null; // book/page metadata, owned by app.js, persisted here for session restore
    this.unbrushActive = false; // when true, taps remove the tapped stroke instead of drawing
    this.lineMode = false; // when true, taps place straight-line endpoints instead of freehand painting
    this.pendingLineStart = null; // first click of a pending line, waiting for the second
    this.exportShape = 'portrait'; // 'portrait' (natural height) | 'square' (padded to a square)
    this.storageWarned = false; // fires onStorageError at most once per session
    this.onStorageError = null; // set by app.js to show a UI warning
    document.getElementById('book-page').style.background = this.pageColor;
    this.bindEvents();
  }

  setFont(font) {
    this.font = font;
    // Each font has different metrics — adjust size accordingly
    const fontSizes = {
      'Lora': 13,
      'IM Fell English': 15,
      'Lexend': 12
    };
    this.fontSize = fontSizes[font] || 13;
    this.layoutText();
    this.render();
  }

  setPageColor(color) {
    this.pageColor = color;
    document.getElementById('book-page').style.background = color;
    this.render();
  }

  setBrushSize(size) {
    this.brushSize = size;
  }

  setMode(mode) {
    this.mode = mode;
    this.cancelPendingLine(); // a pending line belongs to the tool that started it
  }

  setUnbrush(active) {
    this.unbrushActive = active;
    this.cancelPendingLine();
  }

  setLineMode(active) {
    this.lineMode = active;
    this.cancelPendingLine();
  }

  setExportShape(shape) {
    this.exportShape = shape;
  }

  cancelPendingLine() {
    if (this.pendingLineStart) {
      this.pendingLineStart = null;
      this.render();
    }
  }

  setHighlightColor(color) {
    this.highlightColor = color;
  }

  clearHighlights() {
    this.highlights = [];
    this.render();
    this.saveState();
  }

  setText(text, width) {
    this.text = text;
    this.canvas.width = width;
    this.cancelPendingLine(); // don't carry a half-placed line onto a new page
    this.layoutText();
    this.render();
  }

  layoutText() {
    const ctx = this.ctx;
    ctx.font = `${this.fontSize}px '${this.font}', Georgia, serif`;
    const maxWidth = this.canvas.width - 40;
    const lineH = this.fontSize * this.lineHeight;
    const blankLineH = lineH * 0.6; // blank lines are slightly smaller gap
  
    // Split text into paragraphs/stanzas on double newlines
    const blocks = this.text.split(/\n\n+/);
    
    let lines = []; // each entry: { text, isBlank, indent }
  
    for (const block of blocks) {
      // Add blank line between blocks
      if (lines.length > 0) {
        lines.push({ text: '', isBlank: true });
      }
  
      // Split block into individual lines
      const blockLines = block.split('\n');
  
      for (const rawLine of blockLines) {
        const trimmed = rawLine.trimEnd();
        if (!trimmed) {
          lines.push({ text: '', isBlank: true });
          continue;
        }
  
        // Detect leading whitespace for indent
        const leadingSpaces = rawLine.match(/^(\s*)/)[1].length;
        const indent = leadingSpaces > 0 ? ctx.measureText('\u00a0').width * leadingSpaces * 0.5 : 0;
  
        // Detect if line is short enough to be a poetic line (don't wrap)
        const lineWidth = ctx.measureText(trimmed).width;
        if (lineWidth <= maxWidth - indent) {
          // Fits on one line — keep as-is (poetic line)
          lines.push({ text: trimmed, isBlank: false, indent, center: false });
        } else {
          // Too long — word wrap it (prose)
          const words = trimmed.split(/\s+/);
          let current = '';
          for (const word of words) {
            const test = current ? `${current} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth - indent && current) {
              lines.push({ text: current, isBlank: false, indent, center: false });
              current = word;
            } else {
              current = test;
            }
          }
          if (current) lines.push({ text: current, isBlank: false, indent, center: false });
        }
      }
    }
  
    this.lines = lines;
    this.lineH = lineH;
    this.blankLineH = blankLineH;
  
    // Calculate total canvas height
    let totalH = 40;
    for (const line of lines) {
      totalH += line.isBlank ? blankLineH : lineH;
    }
    this.canvas.height = Math.max(300, totalH);
  }
  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Background
    ctx.fillStyle = this.pageColor;
    ctx.fillRect(0, 0, w, h);

    // Highlights (translucent, drawn under the text like a real marker)
    for (const hl of this.highlights) {
      this.drawColoredStroke(hl.points, hl.color);
    }
    if (this.mode === 'highlight' && this.currentStroke.length) {
      this.drawColoredStroke(this.currentStroke, this.highlightColor);
    }

    // Text
    ctx.fillStyle = '#2a2a2a';
    ctx.font = `${this.fontSize}px '${this.font}', Georgia, serif`;
    ctx.textBaseline = 'top';

    const padding = 20;
    let y = padding;
    for (const line of this.lines) {
      if (!line.isBlank) {
        ctx.fillText(line.text, padding + (line.indent || 0), y);
      }
      y += line.isBlank ? this.blankLineH : this.lineH;
    }

    // Redraw all ink (blackout) strokes, on top of the text
    ctx.fillStyle = '#1a1a1a';
    for (const stroke of this.strokes) {
      this.drawStroke(stroke);
    }
    if (this.mode === 'ink' && this.currentStroke.length) {
      this.drawStroke(this.currentStroke);
    }

    // Marker for a pending line's start point — no live preview, just a
    // static dot so you don't lose track of being mid-line.
    if (this.pendingLineStart) {
      const p = this.pendingLineStart;
      ctx.save();
      ctx.fillStyle = '#e05252';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#faf8f3';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawStroke(points) {
    if (!points.length) return;
    const ctx = this.ctx;
    ctx.fillStyle = '#1a1a1a';
    for (const pt of points) {
      ctx.fillRect(
        pt.x - pt.size / 2,
        pt.y - pt.size / 2,
        pt.size,
        pt.size
      );
    }
  }

  drawColoredStroke(points, color, alpha = 0.45) {
    if (!points.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (const pt of points) {
      ctx.fillRect(
        pt.x - pt.size / 2,
        pt.y - pt.size / 2,
        pt.size,
        pt.size
      );
    }
    ctx.restore();
  }

  // Finds the index of the topmost stroke in `arr` (a strokes[] or
  // highlights[] array) with any point near (x, y). Highlights wrap their
  // points in { points, color }; strokes are plain point arrays.
  findStrokeAt(arr, x, y) {
    const tolerance = 6; // a little slack beyond the point radius, easier to tap
    for (let i = arr.length - 1; i >= 0; i--) {
      const points = Array.isArray(arr[i]) ? arr[i] : arr[i].points;
      for (const pt of points) {
        const dx = x - pt.x;
        const dy = y - pt.y;
        const r = pt.size / 2 + tolerance;
        if (dx * dx + dy * dy <= r * r) return i;
      }
    }
    return -1;
  }

  // Removes the whole stroke tapped at (x, y), from whichever layer
  // ('ink' or 'highlight') is currently the active tool.
  tryUnbrushAt(x, y) {
    const targetArr = this.mode === 'highlight' ? this.highlights : this.strokes;
    const idx = this.findStrokeAt(targetArr, x, y);
    if (idx === -1) return;
    targetArr.splice(idx, 1);
    this.render();
    this.saveState();
    if (this.mode === 'ink' && this.strokes.length === 0) {
      document.querySelectorAll('.font-btn').forEach(b => b.classList.remove('locked'));
    }
  }

  // Builds evenly-spaced points along a straight line between two clicks,
  // dense enough to render as a continuous stroke via the same per-point
  // fillRect drawing that freehand strokes use.
  buildLinePoints(p1, p2, size) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const spacing = Math.max(2, size * 0.35);
    const steps = Math.max(1, Math.round(dist / spacing));
    const points = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      points.push({ x: p1.x + dx * t, y: p1.y + dy * t, size });
    }
    return points;
  }

  // Commits the line from the pending start point to (x, y) as a normal
  // stroke — same array, same undo/unbrush/font-locking behavior as any
  // freehand stroke.
  commitLine(x, y) {
    const start = this.pendingLineStart;
    this.pendingLineStart = null;
    const size = start.size;
    const points = this.buildLinePoints(start, { x, y }, size);
    if (this.mode === 'highlight') {
      this.highlights.push({ points, color: this.highlightColor });
    } else {
      this.strokes.push(points);
      document.querySelectorAll('.font-btn').forEach(b => b.classList.add('locked'));
    }
    this.render();
    this.saveState();
  }


  getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
      size: this.mode === 'highlight' ? this.highlightSize : this.brushSize
    };
  }

  bindEvents() {
    const start = (e) => {
      e.preventDefault();
      const pt = this.getPos(e);
      if (this.unbrushActive) {
        this.tryUnbrushAt(pt.x, pt.y);
        return; // erasing, not drawing — don't start a stroke
      }
      if (this.lineMode) {
        if (!this.pendingLineStart) {
          this.pendingLineStart = pt; // first click — mark it and wait for the second
          this.render();
        } else {
          this.commitLine(pt.x, pt.y); // second click — draw the straight line
        }
        return;
      }
      this.painting = true;
      this.currentStroke = [];
      this.currentStroke.push(pt);
      this.render();
    };

    const move = (e) => {
      e.preventDefault();
      if (!this.painting) return;
      const pt = this.getPos(e);
      this.currentStroke.push(pt);
      this.render();
    };

    const end = (e) => {
      if (!this.painting) return;
      this.painting = false;
      if (this.currentStroke.length) {
        if (this.mode === 'highlight') {
          this.highlights.push({ points: [...this.currentStroke], color: this.highlightColor });
        } else {
          this.strokes.push([...this.currentStroke]);
          // Lock fonts after first ink stroke (highlights don't lock — they're non-destructive)
          document.querySelectorAll('.font-btn').forEach(b => b.classList.add('locked'));
        }
        this.currentStroke = [];
        this.saveState();
      }
    };

    this.canvas.addEventListener('mousedown', start);
    this.canvas.addEventListener('mousemove', move);
    this.canvas.addEventListener('mouseup', end);
    this.canvas.addEventListener('mouseleave', end);
    this.canvas.addEventListener('touchstart', start, { passive: false });
    this.canvas.addEventListener('touchmove', move, { passive: false });
    this.canvas.addEventListener('touchend', end);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.cancelPendingLine();
    });
  }

  undo() {
    if (this.strokes.length) {
      this.strokes.pop();
      this.render();
      this.saveState();
      // Unlock fonts if no strokes remain
      if (this.strokes.length === 0) {
        document.querySelectorAll('.font-btn').forEach(b => b.classList.remove('locked'));
      }
    }
  }

  // Mirrors undo() for the highlight layer — no font-lock concerns since
  // highlighting is non-destructive to the text.
  undoHighlight() {
    if (this.highlights.length) {
      this.highlights.pop();
      this.render();
      this.saveState();
    }
  }

  // Removes just the last point-square of the last ink stroke. If that
  // empties the stroke, the stroke itself is removed too — so holding
  // micro-undo eats through the current stroke, then rolls into the
  // previous one, square by square, just like undo() but fine-grained.
  microUndo() {
    if (!this.strokes.length) return;
    const lastStroke = this.strokes[this.strokes.length - 1];
    lastStroke.pop();
    if (lastStroke.length === 0) {
      this.strokes.pop();
    }
    this.render();
    this.saveState();
    if (this.strokes.length === 0) {
      document.querySelectorAll('.font-btn').forEach(b => b.classList.remove('locked'));
    }
  }

  saveState() {
    try {
      const state = {
        strokes: this.strokes,
        highlights: this.highlights,
        text: this.text,
        font: this.font,
        pageColor: this.pageColor,
        brushSize: this.brushSize,
        highlightColor: this.highlightColor,
        meta: this.meta
      };
      localStorage.setItem('blackout_state', JSON.stringify(state));
    } catch(e) {
      console.warn('Could not save to localStorage:', e);
      // Only surface this once per session — no point nagging on every stroke
      if (!this.storageWarned) {
        this.storageWarned = true;
        if (typeof this.onStorageError === 'function') this.onStorageError();
      }
    }
  }

  loadState() {
    try {
      const saved = localStorage.getItem('blackout_state');
      if (!saved) return false;
      const state = JSON.parse(saved);
      this.strokes = state.strokes || [];
      this.highlights = state.highlights || [];
      this.font = state.font || 'Lora';
      this.pageColor = state.pageColor || '#faf8f3';
      this.brushSize = state.brushSize || 16;
      this.highlightColor = state.highlightColor || '#fff176';
      this.meta = state.meta || null;
      return state;
    } catch(e) {
      return false;
    }
  }

  download(title) {
    this.exportImage(title, false);
  }

  share(title) {
    this.exportImage(title, true);
  }

  // allowShare=true opens the OS share sheet when the browser supports it
  // (nice for AirDrop/Messages); allowShare=false always saves the file
  // straight to disk, no sheet, no prompt.
  // Finds the Y position (in fullCanvas space) closest to idealY that
  // still falls in the gap between two lines of the poem, rather than
  // through the middle of one — used so the square split never slices
  // a line of text in half.
  findSafeSplitY(headerH, idealY) {
    if (!this.lines || !this.lines.length) return idealY;
    const padding = 20;
    let y = headerH + padding;
    let best = y;
    let bestDist = Math.abs(y - idealY);
    for (const line of this.lines) {
      y += line.isBlank ? this.blankLineH : this.lineH;
      const dist = Math.abs(y - idealY);
      if (dist < bestDist) {
        best = y;
        bestDist = dist;
      }
    }
    return best;
  }

  exportImage(title, allowShare) {
    this.cancelPendingLine(); // never bake a stray marker dot into a saved file
    const filename = (title || 'blackout-poem')
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase() + '.png';

    const meta = this.meta || {};
    const book = meta.book || {};
    const page = meta.page || {};
    const year = (typeof book.year === 'number' && book.year < 0)
      ? 'c. ' + Math.abs(book.year) + ' BCE'
      : book.year;
    const authorLine = book.author ? (year != null ? `${book.author}, ${year}` : book.author) : '';
    const pageLine = page.pageNum ? `p. ${page.pageNum}` : '';

    const sidePad = 20;
    const headerH = page.chapter ? 62 : 46;
    const footerInfoH = 34;
    const attributionH = 30;

    const contentW = this.canvas.width;
    const contentH = headerH + this.canvas.height + footerInfoH + attributionH;

    // ── Build the full portrait composition first, always — this part is
    // identical regardless of save shape. ──
    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = contentW;
    fullCanvas.height = contentH;
    const fCtx = fullCanvas.getContext('2d');
    const cx = contentW / 2;

    fCtx.fillStyle = this.pageColor;
    fCtx.fillRect(0, 0, contentW, contentH);

    // ── Header: book title + chapter, mirroring .book-page-header ──
    fCtx.textAlign = 'center';
    fCtx.textBaseline = 'alphabetic';
    fCtx.fillStyle = '#666';
    fCtx.font = `italic 13px 'Lora', Georgia, serif`;
    fCtx.fillText(book.title || '', cx, 22);

    if (page.chapter) {
      fCtx.fillStyle = '#aaa';
      fCtx.font = `11px 'Lexend', Arial, sans-serif`;
      fCtx.fillText(page.chapter, cx, 38);
    }

    fCtx.strokeStyle = '#ccc';
    fCtx.lineWidth = 1;
    fCtx.beginPath();
    fCtx.moveTo(sidePad, headerH - 8);
    fCtx.lineTo(contentW - sidePad, headerH - 8);
    fCtx.stroke();

    // ── The poem itself ──
    fCtx.drawImage(this.canvas, 0, headerH);

    // ── Footer: author + page number, mirroring .book-page-footer ──
    const footerTop = headerH + this.canvas.height;
    fCtx.strokeStyle = '#ccc';
    fCtx.beginPath();
    fCtx.moveTo(sidePad, footerTop + 8);
    fCtx.lineTo(contentW - sidePad, footerTop + 8);
    fCtx.stroke();

    fCtx.font = `italic 11px 'Lora', Georgia, serif`;
    fCtx.fillStyle = '#aaa';
    fCtx.textAlign = 'left';
    fCtx.fillText(authorLine, sidePad, footerTop + 26);
    fCtx.textAlign = 'right';
    fCtx.fillText(pageLine, contentW - sidePad, footerTop + 26);

    // ── Attribution footer ──
    const attribTop = footerTop + footerInfoH;
    fCtx.fillStyle = '#aaa';
    fCtx.font = `11px Arial, sans-serif`;
    fCtx.textAlign = 'left';
    fCtx.textBaseline = 'middle';
    fCtx.fillText(
      `${window.location.hostname} · text from Project Gutenberg`,
      10,
      attribTop + attributionH / 2
    );

    // ── Square mode: split into two "book pages" side by side ONLY when
    // that actually produces a squarer (less padded) result than plain
    // portrait padding would. On a narrow canvas (mobile) splitting
    // usually helps a lot; on a wide canvas (desktop) or a short poem,
    // doubling an already-wide column overshoots the height and wastes
    // more space than it saves — so compare both and pick whichever
    // pads less, rather than guessing from device/viewport width. ──
    let finalCanvas = fullCanvas;

    if (this.exportShape === 'square') {
      const portraitSide = Math.max(contentW, contentH);
      const portraitWaste = portraitSide * portraitSide - contentW * contentH;

      const gutter = 16;
      const halfH = this.findSafeSplitY(headerH, contentH / 2);
      const composedW = contentW * 2 + gutter;
      // The snapped split point won't be exactly centered, so the two
      // pages can differ slightly in height — size the canvas to the
      // taller of the two so neither one gets clipped.
      const composedH = Math.max(halfH, contentH - halfH);
      const splitSide = Math.max(composedW, composedH);
      const splitWaste = splitSide * splitSide - composedW * composedH;

      if (splitWaste < portraitWaste) {
        // Split into two pages, like an open book.
        const pagesCanvas = document.createElement('canvas');
        pagesCanvas.width = composedW;
        pagesCanvas.height = composedH;
        const pCtx = pagesCanvas.getContext('2d');

        pCtx.fillStyle = this.pageColor;
        pCtx.fillRect(0, 0, composedW, composedH);

        // Left page: top half. Right page: bottom half.
        pCtx.drawImage(fullCanvas, 0, 0, contentW, halfH, 0, 0, contentW, halfH);
        pCtx.drawImage(
          fullCanvas, 0, halfH, contentW, contentH - halfH,
          contentW + gutter, 0, contentW, contentH - halfH
        );

        // Gutter divider, like the spine of an open book
        pCtx.strokeStyle = '#ccc';
        pCtx.lineWidth = 1;
        pCtx.beginPath();
        pCtx.moveTo(contentW + gutter / 2, 8);
        pCtx.lineTo(contentW + gutter / 2, composedH - 8);
        pCtx.stroke();

        const sqCanvas = document.createElement('canvas');
        sqCanvas.width = splitSide;
        sqCanvas.height = splitSide;
        const sqCtx = sqCanvas.getContext('2d');
        sqCtx.fillStyle = this.pageColor;
        sqCtx.fillRect(0, 0, splitSide, splitSide);
        sqCtx.drawImage(pagesCanvas, (splitSide - composedW) / 2, (splitSide - composedH) / 2);

        finalCanvas = sqCanvas;
      } else {
        // Plain portrait content, centered and padded to a square —
        // no split needed, it wouldn't have helped here.
        const sqCanvas = document.createElement('canvas');
        sqCanvas.width = portraitSide;
        sqCanvas.height = portraitSide;
        const sqCtx = sqCanvas.getContext('2d');
        sqCtx.fillStyle = this.pageColor;
        sqCtx.fillRect(0, 0, portraitSide, portraitSide);
        sqCtx.drawImage(fullCanvas, (portraitSide - contentW) / 2, (portraitSide - contentH) / 2);

        finalCanvas = sqCanvas;
      }
    }

    finalCanvas.toBlob(blob => {
      const file = new File([blob], filename, { type: 'image/png' });
      if (allowShare && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({
          files: [file],
          title: 'Blackout poem'
        });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }
}
