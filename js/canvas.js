class BlackoutCanvas {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.painting = false;
    this.brushSize = 16;
    this.strokes = []; // for undo
    this.currentStroke = [];
    this.pageColor = '#faf8f3';
    this.font = 'Lora';
    this.fontSize = 13;
    this.lineHeight = 1.8;
    this.text = '';
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

    // Redraw all strokes
    ctx.fillStyle = '#1a1a1a';
    for (const stroke of this.strokes) {
      this.drawStroke(stroke);
    }
    if (this.currentStroke.length) {
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

  getPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
      size: this.brushSize
    };
  }

  bindEvents() {
    const start = (e) => {
      e.preventDefault();
      this.painting = true;
      this.currentStroke = [];
      const pt = this.getPos(e);
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
        this.strokes.push([...this.currentStroke]);
        this.currentStroke = [];
        this.saveState();
        // Lock fonts after first stroke
        document.querySelectorAll('.font-btn').forEach(b => b.classList.add('locked'));
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

  saveState() {
    try {
      const state = {
        strokes: this.strokes,
        text: this.text,
        font: this.font,
        pageColor: this.pageColor,
        brushSize: this.brushSize
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
      this.font = state.font || 'Lora';
      this.pageColor = state.pageColor || '#faf8f3';
      this.brushSize = state.brushSize || 16;
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
