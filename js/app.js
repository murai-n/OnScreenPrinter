(function () {
  'use strict';

  const STORAGE_KEY = 'onscreenprinter.params.v1';

  const DEFAULTS = {
    // 印刷方式
    method: 'offset', freq: 600, dotShape: 'round', angle: 0, dotGain: 0.12, misreg: 0.1, spread: 0.15,
    // 色味
    colorMode: 'cmyk', inkSet: 'process', spotColor: '#a8632a',
    temp: 0, tint: 0, sat: 0, inkDensity: 1, densC: 1, densM: 1, densY: 1, densK: 1, gcr: 0.6, accuracy: 1,
    // トーン
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, fade: 0, sharp: 0,
    // 紙と質感
    paperColor: '#f4f1ea', paperTex: 0.3, mottle: 0.15, grain: 0.1, matte: 0.2,
  };

  const PAPERS = [
    { label: 'コート紙（光沢）', color: '#f6f5f0' },
    { label: 'マットコート紙', color: '#f2eee4' },
    { label: '上質紙', color: '#efe8d8' },
    { label: '更紙（ザラ紙）', color: '#ddd3bd' },
    { label: '新聞紙', color: '#d5cfc0' },
    { label: '日焼けした古紙', color: '#e3d2a8' },
  ];

  const PRESETS = [
    { id: 'mode', label: 'モード誌', note: 'コート紙・高精細オフセット',
      p: { method: 'offset', freq: 800, dotGain: 0.08, misreg: 0.03, spread: 0.1, contrast: 0.18, sat: 0.08,
        paperColor: '#f6f5f0', paperTex: 0.12, mottle: 0.05, grain: 0.04, matte: 0.08, sharp: 0.2, gcr: 0.7 } },
    { id: 'street', label: '90s ストリート誌', note: 'マット紙・やや粗い網点',
      p: { method: 'offset', freq: 380, dotGain: 0.2, misreg: 0.3, spread: 0.3, contrast: 0.1, sat: -0.12, fade: 0.25, exposure: 0.15,
        temp: 0.12, paperColor: '#efe8d8', paperTex: 0.5, mottle: 0.3, grain: 0.22, matte: 0.6, inkDensity: 0.9 } },
    { id: 'gravure', label: 'グラビア誌', note: 'グラビア印刷・濃厚なシャドウ',
      p: { method: 'gravure', freq: 520, dotGain: 0.1, misreg: 0.12, spread: 0.3, contrast: 0.12, sat: 0.15,
        shadows: -0.15, paperColor: '#f2eee4', paperTex: 0.3, mottle: 0.2, grain: 0.1, matte: 0.25, inkDensity: 1.15 } },
    { id: 'vintage', label: '70s ヴィンテージ', note: '退色したインキと日焼けした紙',
      p: { method: 'offset', freq: 280, dotGain: 0.24, misreg: 0.55, spread: 0.4, inkSet: 'vintage', accuracy: 0.55, exposure: 0.4,
        densC: 0.8, densK: 0.85, sat: -0.05, fade: 0.35, temp: 0.2, paperColor: '#e3d2a8', paperTex: 0.7,
        mottle: 0.45, grain: 0.3, matte: 0.7, sharp: -0.1 } },
    { id: 'news', label: '新聞', note: '新聞紙・粗い網点・浅い黒',
      p: { method: 'offset', freq: 190, dotGain: 0.28, misreg: 0.4, spread: 0.45, sat: -0.3, contrast: -0.05, exposure: 0.3,
        inkDensity: 0.62, paperColor: '#d5cfc0', paperTex: 0.8, mottle: 0.5, grain: 0.25, matte: 0.9 } },
    { id: 'letterpress', label: '活版', note: '凸版・インキの縁取り',
      p: { method: 'letterpress', freq: 200, dotGain: 0.15, misreg: 0.3, spread: 0.2, contrast: 0.15,
        paperColor: '#efe8d8', paperTex: 0.6, mottle: 0.4, grain: 0.15, matte: 0.5 } },
    { id: 'duotone', label: 'モノクロ写真集', note: 'ダブルトーン・FMスクリーン',
      p: { method: 'fm', freq: 900, colorMode: 'duotone', spotColor: '#9a7b5c', dotGain: 0.1, misreg: 0.02,
        spread: 0.2, contrast: 0.2, paperColor: '#f2eee4', paperTex: 0.25, mottle: 0.08, grain: 0.12, matte: 0.3 } },
    { id: 'riso', label: 'リソグラフ ZINE', note: '蛍光インキ・版ズレ・粒状感',
      p: { method: 'riso', freq: 520, inkSet: 'riso', gcr: 0.45, dotGain: 0.05, misreg: 0.5,
        spread: 0.3, contrast: 0.15, sat: 0.12, paperColor: '#f2eee4', paperTex: 0.5, mottle: 0.35,
        grain: 0.08, matte: 0.3 } },
  ];

  const AM = ['offset', 'letterpress'];
  const SCHEMA = [
    { title: '印刷方式', items: [
      { key: 'method', type: 'choice', options: [
        ['offset', 'オフセット'], ['gravure', 'グラビア'], ['fm', 'FMスクリーン'],
        ['letterpress', '活版'], ['riso', 'リソグラフ'], ['none', '連続階調'] ] },
      { key: 'freq', label: '線数（画像幅あたりの網点数）', min: 40, max: 2000, scale: 'log', show: (p) => p.method !== 'none' },
      { key: 'dotShape', label: '網点形状', type: 'choice', options: [['round', '丸'], ['ellipse', 'チェーン'], ['line', 'ライン']],
        show: (p) => AM.includes(p.method) },
      { key: 'angle', label: 'スクリーン角度', min: -45, max: 45, step: 1, unit: '°', show: (p) => AM.includes(p.method) || p.method === 'gravure' },
      { key: 'dotGain', label: 'ドットゲイン', min: 0, max: 0.4, step: 0.01 },
      { key: 'misreg', label: '版ズレ', min: 0, max: 1, step: 0.01 },
      { key: 'spread', label: 'インキのにじみ', min: 0, max: 1, step: 0.01, show: (p) => p.method !== 'none' },
    ] },
    { title: '色味', items: [
      { key: 'colorMode', type: 'choice', options: [['cmyk', 'フルカラー'], ['mono', 'スミ1色'], ['duotone', 'ダブルトーン']] },
      { key: 'inkSet', label: 'インキセット', type: 'choice',
        options: [['process', 'プロセス'], ['vintage', 'ヴィンテージ'], ['riso', 'リソ蛍光']], show: (p) => p.colorMode === 'cmyk' },
      { key: 'spotColor', label: '特色', type: 'color', show: (p) => p.colorMode === 'duotone' },
      { key: 'temp', label: '色温度（寒 ↔ 暖）', min: -1, max: 1, step: 0.01 },
      { key: 'tint', label: '色かぶり（緑 ↔ マゼンタ）', min: -1, max: 1, step: 0.01 },
      { key: 'sat', label: '彩度', min: -1, max: 1, step: 0.01 },
      { key: 'inkDensity', label: 'インキ濃度（全体）', min: 0.3, max: 1.5, step: 0.01 },
      { key: 'densC', label: 'C 版の濃度', min: 0, max: 1.5, step: 0.01, show: (p) => p.colorMode === 'cmyk', cls: 'ink-c' },
      { key: 'densM', label: 'M 版の濃度', min: 0, max: 1.5, step: 0.01, show: (p) => p.colorMode === 'cmyk', cls: 'ink-m' },
      { key: 'densY', label: 'Y 版の濃度', min: 0, max: 1.5, step: 0.01, show: (p) => p.colorMode === 'cmyk', cls: 'ink-y' },
      { key: 'densK', label: 'K 版の濃度', min: 0, max: 1.5, step: 0.01, cls: 'ink-k' },
      { key: 'gcr', label: '墨版の量（GCR）', min: 0, max: 1, step: 0.01, show: (p) => p.colorMode === 'cmyk' },
      { key: 'accuracy', label: '色再現の補正', min: 0, max: 1, step: 0.01, show: (p) => p.colorMode === 'cmyk' },
    ] },
    { title: 'トーン', items: [
      { key: 'exposure', label: '露出', min: -2, max: 2, step: 0.01, unit: ' EV' },
      { key: 'contrast', label: 'コントラスト', min: -1, max: 1, step: 0.01 },
      { key: 'highlights', label: 'ハイライト', min: -1, max: 1, step: 0.01 },
      { key: 'shadows', label: 'シャドウ', min: -1, max: 1, step: 0.01 },
      { key: 'fade', label: 'フェード（黒の持ち上げ）', min: 0, max: 1, step: 0.01 },
      { key: 'sharp', label: 'シャープネス（ソフト ↔ シャープ）', min: -1, max: 1, step: 0.01 },
    ] },
    { title: '紙と質感', items: [
      { key: 'paperColor', label: '紙色', type: 'paper' },
      { key: 'paperTex', label: '紙の質感', min: 0, max: 1, step: 0.01 },
      { key: 'mottle', label: 'インキむら', min: 0, max: 1, step: 0.01 },
      { key: 'grain', label: '粒状感', min: 0, max: 1, step: 0.01 },
      { key: 'matte', label: '黒の浮き（マット感）', min: 0, max: 1, step: 0.01 },
    ] },
  ];

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------------------------------------------------------------- state
  let params = { ...DEFAULTS };
  let presetId = 'custom';
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.params) {
      for (const k of Object.keys(DEFAULTS)) if (typeof saved.params[k] === typeof DEFAULTS[k]) params[k] = saved.params[k];
      presetId = saved.presetId || 'custom';
    } else {
      presetId = 'mode';
      Object.assign(params, PRESETS[0].p);
    }
  } catch (e) {
    presetId = 'mode';
    Object.assign(params, PRESETS[0].p);
  }

  const canvas = $('#view');
  const stage = $('#stage');
  let renderer;
  try {
    renderer = new window.OSP.Renderer(canvas);
  } catch (err) {
    $('#fatal').hidden = false;
    $('#fatal').textContent = 'このブラウザでは WebGL2 が使えないため動作しません。（' + err.message + '）';
    return;
  }

  const view = { scale: 1, tx: 0, ty: 0, fitted: true };
  let bypass = false;
  let dirty = false;
  let fileName = 'sample';

  function requestRender() {
    if (dirty) return;
    dirty = true;
    requestAnimationFrame(draw);
  }
  function draw() {
    dirty = false;
    renderer.render(params, view, { bypass });
    $('#zoom').textContent = Math.round(view.scale * 100) + '%';
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ params, presetId })); } catch (e) { /* 保存できなくても動作は続ける */ }
  }

  // ---------------------------------------------------------------- view
  function fit() {
    const k = Math.min(canvas.width / renderer.imgW, canvas.height / renderer.imgH) * 0.94;
    view.scale = k;
    view.tx = (canvas.width - renderer.imgW * k) / 2;
    view.ty = (canvas.height - renderer.imgH * k) / 2;
    view.fitted = true;
    requestRender();
  }
  function zoomAt(cx, cy, k) {
    const s = Math.min(32, Math.max(0.02, view.scale * k));
    k = s / view.scale;
    view.tx = cx - (cx - view.tx) * k;
    view.ty = cy - (cy - view.ty) * k;
    view.scale = s;
    view.fitted = false;
    requestRender();
  }
  function actualSize() {
    zoomAt(canvas.width / 2, canvas.height / 2, 1 / view.scale);
  }
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(stage.clientWidth * dpr)), h = Math.max(1, Math.round(stage.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h) return;
    const dx = (w - canvas.width) / 2, dy = (h - canvas.height) / 2;
    canvas.width = w;
    canvas.height = h;
    if (view.fitted) fit();
    else { view.tx += dx; view.ty += dy; }
    dirty = false;
    draw();
  }
  new ResizeObserver(resize).observe(stage);

  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
  };
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = toCanvas(e);
    zoomAt(x, y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });

  const pointers = new Map();
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, toCanvas(e));
    pinch = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId), cur = toCanvas(e);
    pointers.set(e.pointerId, cur);
    if (pointers.size === 1) {
      view.tx += cur[0] - prev[0];
      view.ty += cur[1] - prev[1];
      view.fitted = false;
      requestRender();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      if (pinch) {
        view.tx += cx - pinch.cx;
        view.ty += cy - pinch.cy;
        zoomAt(cx, cy, dist / Math.max(1, pinch.dist));
      }
      pinch = { dist, cx, cy };
    }
  });
  const endPointer = (e) => { pointers.delete(e.pointerId); pinch = null; };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('dblclick', () => (view.fitted ? actualSize() : fit()));

  $('#btn-fit').addEventListener('click', fit);
  $('#btn-100').addEventListener('click', actualSize);

  // 比較 (押している間だけ元画像)
  const cmp = $('#btn-compare');
  const setBypass = (on) => {
    if (bypass === on) return;
    bypass = on;
    cmp.classList.toggle('active', on);
    requestRender();
  };
  cmp.addEventListener('pointerdown', (e) => { cmp.setPointerCapture(e.pointerId); setBypass(true); });
  cmp.addEventListener('pointerup', () => setBypass(false));
  cmp.addEventListener('pointercancel', () => setBypass(false));
  const typing = (e) => /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName);
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !typing(e)) { e.preventDefault(); setBypass(true); } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') setBypass(false); });

  // ---------------------------------------------------------------- image IO
  function setImage(source, w, h, name) {
    renderer.setImage(source, w, h);
    fileName = (name || 'image').replace(/\.[^.]+$/, '');
    $('#hint').hidden = true;
    fit();
  }
  async function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      setImage(bmp, bmp.width, bmp.height, file.name);
      bmp.close();
    } catch (err) {
      alert('画像を読み込めませんでした: ' + err.message);
    }
  }
  $('#btn-open').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('#btn-sample').addEventListener('click', loadSample);
  window.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('drop'); });
  window.addEventListener('dragleave', () => stage.classList.remove('drop'));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drop');
    loadFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData ? e.clipboardData.items : [])].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  function loadSample() {
    const c = window.OSP.makeSample();
    setImage(c, c.width, c.height, 'sample');
    $('#hint').hidden = false;
  }

  $('#btn-export').addEventListener('click', async () => {
    const btn = $('#btn-export');
    btn.disabled = true;
    try {
      const k = parseFloat($('#export-scale').value);
      const { blob } = await renderer.exportBlob(params, k);
      draw();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${fileName}_${presetId}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------------------------------------------------------------- controls
  const updaters = [];
  function refreshUI() {
    for (const u of updaters) u();
    for (const b of document.querySelectorAll('#presets button')) b.classList.toggle('active', b.dataset.id === presetId);
  }
  function setParam(key, value) {
    params[key] = value;
    presetId = 'custom';
    refreshUI();
    save();
    requestRender();
  }
  function applyPreset(p) {
    params = { ...DEFAULTS, ...p.p };
    presetId = p.id;
    refreshUI();
    save();
    requestRender();
  }

  function buildSlider(item) {
    const row = el('div', 'row slider ' + (item.cls || ''));
    const head = el('div', 'row-head');
    const label = el('label', null, item.label);
    const val = el('output');
    head.append(label, val);
    const input = el('input');
    input.type = 'range';
    const log = item.scale === 'log';
    input.min = log ? Math.log2(item.min) : item.min;
    input.max = log ? Math.log2(item.max) : item.max;
    input.step = log ? 0.01 : item.step;
    input.id = 'p-' + item.key;
    label.htmlFor = input.id;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      setParam(item.key, log ? Math.round(Math.pow(2, v)) : v);
    });
    const reset = () => setParam(item.key, DEFAULTS[item.key]);
    input.addEventListener('dblclick', reset);
    val.title = 'クリックで初期値に戻す';
    val.addEventListener('click', reset);
    row.append(head, input);
    updaters.push(() => {
      const v = params[item.key];
      const iv = String(log ? Math.log2(v) : v);
      if (document.activeElement !== input || parseFloat(input.value) !== parseFloat(iv)) input.value = iv;
      const digits = log || (item.step || 1) >= 1 ? 0 : 2;
      val.textContent = (item.min < 0 && v > 0 ? '+' : '') + v.toFixed(digits) + (item.unit || '');
      val.classList.toggle('changed', v !== DEFAULTS[item.key]);
      row.hidden = item.show ? !item.show(params) : false;
    });
    return row;
  }
  function buildChoice(item) {
    const row = el('div', 'row');
    if (item.label) { const head = el('div', 'row-head'); head.append(el('span', null, item.label)); row.append(head); }
    const group = el('div', 'chips');
    for (const [value, text] of item.options) {
      const b = el('button', null, text);
      b.type = 'button';
      b.dataset.value = value;
      b.addEventListener('click', () => setParam(item.key, value));
      group.append(b);
    }
    row.append(group);
    updaters.push(() => {
      for (const b of group.children) b.classList.toggle('active', b.dataset.value === params[item.key]);
      row.hidden = item.show ? !item.show(params) : false;
    });
    return row;
  }
  function buildColor(item) {
    const row = el('div', 'row inline');
    const label = el('label', null, item.label);
    const input = el('input');
    input.type = 'color';
    input.id = 'p-' + item.key;
    label.htmlFor = input.id;
    input.addEventListener('input', () => setParam(item.key, input.value));
    row.append(label);
    if (item.type === 'paper') {
      const sel = el('select');
      sel.setAttribute('aria-label', '紙の種類');
      for (const p of PAPERS) sel.append(new Option(p.label, p.color));
      const custom = new Option('カスタム', '');
      sel.append(custom);
      sel.addEventListener('change', () => { if (sel.value) setParam(item.key, sel.value); });
      row.append(sel);
      updaters.push(() => { sel.value = PAPERS.some((p) => p.color === params[item.key]) ? params[item.key] : ''; });
    }
    row.append(input);
    updaters.push(() => {
      input.value = params[item.key];
      row.hidden = item.show ? !item.show(params) : false;
    });
    return row;
  }

  const presetsEl = $('#presets');
  for (const p of PRESETS) {
    const b = el('button');
    b.type = 'button';
    b.dataset.id = p.id;
    b.textContent = p.label;
    b.title = p.note;
    b.addEventListener('click', () => applyPreset(p));
    presetsEl.append(b);
  }
  const controls = $('#controls');
  for (const sec of SCHEMA) {
    const d = el('details', 'section');
    d.open = true;
    d.append(el('summary', null, sec.title));
    for (const item of sec.items) {
      d.append(item.type === 'choice' ? buildChoice(item) : item.type === 'color' || item.type === 'paper' ? buildColor(item) : buildSlider(item));
    }
    controls.append(d);
  }
  $('#btn-reset').addEventListener('click', () => applyPreset({ id: 'custom', p: {} }));

  refreshUI();
  loadSample();
  resize();
})();
