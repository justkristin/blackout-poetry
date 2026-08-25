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
    const fontString = `${this.fontSize}px '${this.font}', Georgia, serif`;
    ctx.font = fontString;

    const words = this.text.split(/\s+/).filter(w => w.length > 0);
    const maxWidth = this.canvas.width - 40;
    const lineH = this.fontSize * this.lineHeight;

    let lines = [];
    let currentLine = '';

    for (const word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) lines.push(currentLine);

    this.lines = lines;
    this.canvas.height = Math.max(300, lines.length * lineH + 40);
    this.lineH = lineH;
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
    this.lines.forEach((line, i) => {
      ctx.fillText(line, padding, padding + i * this.lineH);
    });

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
