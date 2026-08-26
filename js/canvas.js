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
  }

  setUnbrush(active) {
    this.unbrushActive = active;
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
    const filename = (title || 'blackout-poem')
      .replace(/[^a-z0-9]/gi, '-')
      .toLowerCase() + '.png';

    // Add attribution footer
    const padding = 10;
    const footerH = 30;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = this.canvas.width;
    tempCanvas.height = this.canvas.height + footerH;
    const tCtx = tempCanvas.getContext('2d');

    // Copy main canvas
    tCtx.drawImage(this.canvas, 0, 0);

    // Footer
    tCtx.fillStyle = this.pageColor;
    tCtx.fillRect(0, this.canvas.height, this.canvas.width, footerH);
    tCtx.fillStyle = '#aaa';
    tCtx.font = `11px Arial, sans-serif`;
    tCtx.textBaseline = 'middle';
    tCtx.fillText(
      `${window.location.hostname} · text from Project Gutenberg`,
      padding,
      this.canvas.height + footerH / 2
    );

    tempCanvas.toBlob(blob => {
      if (navigator.share && navigator.canShare({ files: [new File([blob], filename, { type: 'image/png' })] })) {
        navigator.share({
          files: [new File([blob], filename, { type: 'image/png' })],
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
