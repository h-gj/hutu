(() => {
  const DOC_ID_RE = /^[a-z0-9]{10,16}$/;
  const API = '/api/whiteboard';
  const SAVE_DEBOUNCE_MS = 800;
  const BG_COLOR = '#ffffff';

  const canvas = document.getElementById('whiteboard-canvas');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('canvas-wrap');
  const toolbar = document.getElementById('toolbar');

  const brushSizeInput = document.getElementById('brush-size');
  const brushSizeVal = document.getElementById('brush-size-val');
  const colorPicker = document.getElementById('color-picker');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const clearBtn = document.getElementById('clear-btn');
  const exportBtn = document.getElementById('export-btn');
  const shareBtn = document.getElementById('share-btn');
  const shareBar = document.getElementById('wb-share-bar');
  const shareUrlInput = document.getElementById('wb-share-url');
  const copyShareBtn = document.getElementById('copy-share-url');
  const shareStatus = document.getElementById('wb-share-status');

  let tool = 'pen';
  let color = '#1a1a2e';
  let brushSize = 3;
  let strokes = [];
  let undoStack = [];
  let redoStack = [];
  let drawing = false;
  let currentStroke = null;
  let startPoint = null;
  let boardId = parseIdFromUrl();
  let saveTimer = null;
  let lastSavedJson = '';
  let saving = false;
  let saveQueued = false;

  function parseIdFromUrl() {
    const id = new URLSearchParams(window.location.search).get('id');
    return id && DOC_ID_RE.test(id) ? id : null;
  }

  function buildPageUrl(id) {
    const url = new URL(window.location.href);
    url.search = `?id=${encodeURIComponent(id)}`;
    return url.toString();
  }

  function setPageUrl(id) {
    history.replaceState(null, '', buildPageUrl(id));
  }

  function snapshot() {
    return JSON.stringify(strokes);
  }

  function pushHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    updateUndoRedoButtons();
    scheduleSave();
  }

  function restoreFromSnapshot(json) {
    try {
      strokes = JSON.parse(json);
    } catch {
      strokes = [];
    }
    redraw();
    scheduleSave();
  }

  function updateUndoRedoButtons() {
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  function getCanvasSize() {
    const rect = wrap.getBoundingClientRect();
    return {
      width: Math.max(320, Math.floor(rect.width)),
      height: Math.max(240, Math.floor(rect.height)),
    };
  }

  function resizeCanvas() {
    const { width, height } = getCanvasSize();
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    redraw();
  }

  function getPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    let clientX;
    let clientY;
    if (e.changedTouches && e.changedTouches.length) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else if (e.touches && e.touches.length) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function drawStroke(stroke, previewEnd) {
    const { tool: t, color: c, size, points, x1, y1, x2, y2 } = stroke;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (t === 'pen') {
      if (!points || points.length < 2) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = c;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      return;
    }

    if (t === 'eraser') {
      if (!points || points.length < 2) return;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    const endX = previewEnd ? previewEnd.x : x2;
    const endY = previewEnd ? previewEnd.y : y2;
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = c;
    ctx.lineWidth = size;

    if (t === 'line') {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      return;
    }

    if (t === 'rect') {
      ctx.strokeRect(x1, y1, endX - x1, endY - y1);
      return;
    }

    if (t === 'ellipse') {
      const cx = (x1 + endX) / 2;
      const cy = (y1 + endY) / 2;
      const rx = Math.abs(endX - x1) / 2;
      const ry = Math.abs(endY - y1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    if (t === 'arrow') {
      drawArrow(x1, y1, endX, endY, size);
    }
  }

  function drawArrow(x1, y1, x2, y2, size) {
    const headLen = Math.max(12, size * 4);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - headLen * Math.cos(angle - Math.PI / 6),
      y2 - headLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.lineTo(
      x2 - headLen * Math.cos(angle + Math.PI / 6),
      y2 - headLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  function redraw(previewStroke, previewEnd) {
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokes) {
      drawStroke(stroke);
    }
    if (previewStroke) {
      drawStroke(previewStroke, previewEnd);
    }
  }

  function startDraw(e) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    drawing = true;
    const pt = getPoint(e);
    startPoint = pt;

    if (tool === 'pen' || tool === 'eraser') {
      currentStroke = {
        tool,
        color: tool === 'eraser' ? null : color,
        size: tool === 'eraser' ? brushSize * 3 : brushSize,
        points: [pt],
      };
    } else {
      currentStroke = {
        tool,
        color,
        size: brushSize,
        x1: pt.x,
        y1: pt.y,
        x2: pt.x,
        y2: pt.y,
      };
    }
  }

  function moveDraw(e) {
    if (!drawing || !currentStroke) return;
    e.preventDefault();
    const pt = getPoint(e);

    if (tool === 'pen' || tool === 'eraser') {
      const last = currentStroke.points[currentStroke.points.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1) return;
      currentStroke.points.push(pt);
      redraw();
      drawStroke(currentStroke);
    } else {
      redraw(currentStroke, pt);
    }
  }

  function endDraw(e) {
    if (!drawing) return;
    e.preventDefault();
    drawing = false;

    if (!currentStroke) return;

    if (tool === 'pen' || tool === 'eraser') {
      if (currentStroke.points.length < 2) {
        currentStroke = null;
        redraw();
        return;
      }
    } else {
      const pt = e.changedTouches ? getPoint(e) : getPoint(e);
      currentStroke.x2 = pt.x;
      currentStroke.y2 = pt.y;
      if (
        Math.hypot(currentStroke.x2 - currentStroke.x1, currentStroke.y2 - currentStroke.y1) < 2
      ) {
        currentStroke = null;
        redraw();
        return;
      }
    }

    pushHistory();
    strokes.push(currentStroke);
    currentStroke = null;
    startPoint = null;
    redraw();
  }

  function setTool(next) {
    tool = next;
    toolbar.querySelectorAll('.wb-tool').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === next);
    });
    wrap.classList.toggle('tool-eraser', next === 'eraser');
  }

  function setColor(next) {
    color = next;
    colorPicker.value = next;
    toolbar.querySelectorAll('.wb-color').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.color === next);
    });
    if (tool === 'eraser') setTool('pen');
  }

  async function scheduleSave() {
    if (!boardId) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistBoard, SAVE_DEBOUNCE_MS);
  }

  async function persistBoard() {
    if (!boardId) return;
    const json = snapshot();
    if (json === lastSavedJson) return;

    if (saving) {
      saveQueued = true;
      return;
    }

    saving = true;
    try {
      const content = { version: 1, background: BG_COLOR, strokes };
      const res = await fetch(`${API}/${encodeURIComponent(boardId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '保存失败');
      lastSavedJson = json;
      shareStatus.hidden = false;
      shareStatus.textContent = '已自动保存';
    } catch (err) {
      shareStatus.hidden = false;
      shareStatus.textContent = `保存失败: ${err.message}`;
      shareStatus.style.color = '#e63946';
    } finally {
      saving = false;
      if (saveQueued) {
        saveQueued = false;
        persistBoard();
      }
    }
  }

  async function createShare() {
    shareBtn.disabled = true;
    shareBtn.textContent = '生成中…';
    try {
      const content = { version: 1, background: BG_COLOR, strokes };
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '创建失败');
      boardId = data.id;
      setPageUrl(boardId);
      lastSavedJson = snapshot();
      const fullUrl = buildPageUrl(boardId);
      shareUrlInput.value = fullUrl;
      shareBar.hidden = false;
      shareStatus.hidden = false;
      shareStatus.textContent = '已生成分享链接';
      shareStatus.style.color = '#2a9d8f';
    } catch (err) {
      alert(`分享失败: ${err.message}`);
    } finally {
      shareBtn.disabled = false;
      shareBtn.textContent = '分享';
    }
  }

  async function loadBoard() {
    if (!boardId) return;
    try {
      const res = await fetch(`${API}/${encodeURIComponent(boardId)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '加载失败');
      const content = data.content || {};
      strokes = Array.isArray(content.strokes) ? content.strokes : [];
      undoStack = [];
      redoStack = [];
      lastSavedJson = snapshot();
      shareUrlInput.value = buildPageUrl(boardId);
      shareBar.hidden = false;
      redraw();
      updateUndoRedoButtons();
    } catch (err) {
      alert(`加载白板失败: ${err.message}`);
    }
  }

  function exportPng() {
    const link = document.createElement('a');
    link.download = `whiteboard-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  function clearCanvas() {
    if (strokes.length === 0) return;
    if (!confirm('确定清空画布？')) return;
    pushHistory();
    strokes = [];
    redraw();
  }

  toolbar.querySelectorAll('.wb-tool').forEach((btn) => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  toolbar.querySelectorAll('.wb-color').forEach((btn) => {
    btn.addEventListener('click', () => setColor(btn.dataset.color));
  });

  colorPicker.addEventListener('input', (e) => {
    setColor(e.target.value);
    toolbar.querySelectorAll('.wb-color').forEach((btn) => btn.classList.remove('active'));
  });

  brushSizeInput.addEventListener('input', (e) => {
    brushSize = Number(e.target.value);
    brushSizeVal.textContent = String(brushSize);
  });

  undoBtn.addEventListener('click', () => {
    if (undoStack.length === 0) return;
    redoStack.push(snapshot());
    restoreFromSnapshot(undoStack.pop());
    updateUndoRedoButtons();
  });

  redoBtn.addEventListener('click', () => {
    if (redoStack.length === 0) return;
    undoStack.push(snapshot());
    restoreFromSnapshot(redoStack.pop());
    updateUndoRedoButtons();
  });

  clearBtn.addEventListener('click', clearCanvas);
  exportBtn.addEventListener('click', exportPng);
  shareBtn.addEventListener('click', createShare);

  copyShareBtn.addEventListener('click', async () => {
    const text = shareUrlInput.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      shareStatus.hidden = false;
      shareStatus.textContent = '链接已复制';
      shareStatus.style.color = '#2a9d8f';
    } catch {
      shareUrlInput.select();
      document.execCommand('copy');
    }
  });

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);

  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw, { passive: false });

  window.addEventListener('resize', resizeCanvas);
  new ResizeObserver(() => resizeCanvas()).observe(wrap);

  resizeCanvas();
  updateUndoRedoButtons();
  loadBoard();
})();
