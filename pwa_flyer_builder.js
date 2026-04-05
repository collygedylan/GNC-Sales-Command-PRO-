(function (global) {
  'use strict';

  const THEMES = {
    sage: { background: '#f5f5ef', panel: '#ffffff', accent: '#0f7a4f', title: '#112033', body: '#334155' },
    warm: { background: '#fff7ef', panel: '#ffffff', accent: '#d97706', title: '#3f2205', body: '#6b3b0d' },
    bloom: { background: '#fff6fb', panel: '#ffffff', accent: '#be185d', title: '#431427', body: '#6b2148' },
    slate: { background: '#f8fafc', panel: '#ffffff', accent: '#1d4ed8', title: '#0f172a', body: '#334155' }
  };

  const BUILDER_CSS = `
    .npf-wrap{display:grid;gap:16px}.npf-grid{display:grid;gap:16px;grid-template-columns:minmax(320px,420px) minmax(320px,1fr)}
    .npf-card{background:#fff;border:1px solid #d9e4dc;border-radius:24px;box-shadow:0 18px 36px rgba(15,23,42,.08);overflow:hidden}
    .npf-section{padding:18px}.npf-stack{display:grid;gap:10px}.npf-label{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#475569}
    .npf-input,.npf-textarea{width:100%;border:1px solid #d6e3db;border-radius:16px;padding:12px 14px;font:700 14px/1.4 Arial,sans-serif;color:#0f172a;background:#fff}.npf-textarea{min-height:76px;resize:vertical}
    .npf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:10px 16px;border-radius:999px;border:1px solid transparent;font:900 11px/1 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
    .npf-primary{background:#0f7a4f;color:#fff}.npf-secondary{background:#eef6f1;color:#0f7a4f;border-color:#cfe4d6}.npf-muted{background:#f8fafc;color:#475569;border-color:#d8e0ea}
    .npf-themes,.npf-actions,.npf-slot-actions,.npf-mode-row{display:flex;flex-wrap:wrap;gap:8px}.npf-theme.active,.npf-mode.active{box-shadow:inset 0 0 0 2px rgba(15,122,79,.2)}
    .npf-video-shell{position:relative;overflow:hidden;border-radius:22px;background:radial-gradient(circle at top,#166534 0%,#0f172a 56%,#020617 100%);aspect-ratio:3/4;min-height:300px}
    .npf-video{width:100%;height:100%;display:block;object-fit:cover}.npf-video-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:rgba(255,255,255,.82);font:800 14px/1.45 Arial,sans-serif}
    .npf-slots{display:grid;gap:12px}.npf-slot{border:1px solid #dbe7df;border-radius:20px;padding:14px;background:#f8fbf9}.npf-thumb{width:100%;aspect-ratio:16/10;border-radius:18px;background:#dfe9e2 center/cover no-repeat;border:1px dashed #bfd2c4;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;color:#64748b;font:800 12px/1.4 Arial,sans-serif}
    .npf-preview-shell{padding:18px;background:linear-gradient(180deg,#f8fafc 0%,#eef4f7 100%);border-radius:24px}.npf-canvas{width:100%;height:auto;display:block;border-radius:22px;box-shadow:0 28px 48px rgba(15,23,42,.16);background:#fff}
    @media (max-width:980px){.npf-grid{grid-template-columns:1fr}}
  `;

  function injectCss() {
    if (document.getElementById('npf-builder-css')) return;
    const style = document.createElement('style');
    style.id = 'npf-builder-css';
    style.textContent = BUILDER_CSS;
    document.head.appendChild(style);
  }

  function safeName(value) {
    return String(value || '').trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_.-]/g, '') || 'flyer';
  }

  function roundRect(ctx, x, y, w, h, r) {
    const d = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + d, y); ctx.arcTo(x + w, y, x + w, y + h, d); ctx.arcTo(x + w, y + h, x, y + h, d); ctx.arcTo(x, y + h, x, y, d); ctx.arcTo(x, y, x + w, y, d); ctx.closePath();
  }

  async function blobToDataUrl(blob) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read blob.'));
      reader.readAsDataURL(blob);
    });
  }

  async function canvasToBlob(canvas, type, quality) {
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not create blob.')), type || 'image/png', quality || 0.96);
    });
  }

  async function loadImage(source) {
    if (!source) return null;
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load image.'));
      image.src = source;
    });
  }

  function wrapText(ctx, text, maxWidth, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let current = words.shift();
    words.forEach((word) => {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) current = next;
      else { lines.push(current); current = word; }
    });
    if (current) lines.push(current);
    return maxLines ? lines.slice(0, maxLines) : lines;
  }

  class NativeCamera {
    constructor() { this.stream = null; this.video = null; this.recorder = null; this.chunks = []; }
    async open(video, mode) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia is not available on this device.');
      this.stop();
      this.video = video;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: mode === 'video', video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 2560 } } });
      this.video.srcObject = this.stream;
      this.video.playsInline = true;
      this.video.muted = true;
      await this.video.play().catch(function () {});
      return this.stream;
    }
    async capturePhoto() {
      if (!this.stream || !this.video) throw new Error('Open the camera first.');
      const canvas = document.createElement('canvas');
      canvas.width = this.video.videoWidth || 1920;
      canvas.height = this.video.videoHeight || 2560;
      canvas.getContext('2d').drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.96);
      return { blob, dataUrl: await blobToDataUrl(blob) };
    }
    startVideo() {
      if (!this.stream) throw new Error('Open the camera first.');
      if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder is not supported here.');
      this.chunks = [];
      this.recorder = new MediaRecorder(this.stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm' });
      this.recorder.ondataavailable = (event) => { if (event.data && event.data.size) this.chunks.push(event.data); };
      this.recorder.start();
    }
    async stopVideo() {
      if (!this.recorder) throw new Error('No video is recording.');
      return await new Promise((resolve, reject) => {
        const recorder = this.recorder;
        recorder.onerror = () => reject(recorder.error || new Error('Video recording failed.'));
        recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'video/webm' }));
        recorder.stop();
        this.recorder = null;
      });
    }
    stop() {
      if (this.recorder && this.recorder.state !== 'inactive') { try { this.recorder.stop(); } catch (error) {} }
      if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
      if (this.video) { this.video.pause(); this.video.srcObject = null; }
      this.recorder = null; this.chunks = []; this.stream = null;
    }
  }
  class Builder {
    constructor(root, options) {
      const opts = Object.assign({ theme: 'sage', title: 'Annual Crop Update', subtitle: 'Build flyers from your phone', footer: 'Greenleaf Nursery Company', footerNote: 'Call or message for availability.', slots: 4, uploadFlyerBlob: null, supabaseFetchFn: global.supabaseFetch || null, currentUser: (global.currentUserDisplay || global.currentUser || 'Unknown User') }, options || {});
      this.root = root;
      this.camera = new NativeCamera();
      this.uploadFlyerBlob = opts.uploadFlyerBlob;
      this.supabaseFetchFn = opts.supabaseFetchFn;
      this.currentUser = opts.currentUser;
      this.cameraMode = 'photo';
      this.recording = false;
      this.selectedSlot = 0;
      this.state = { themeKey: opts.theme, theme: Object.assign({}, THEMES[opts.theme] || THEMES.sage), title: opts.title, subtitle: opts.subtitle, footer: opts.footer, footerNote: opts.footerNote, cards: Array.from({ length: Math.max(1, opts.slots) }).map((_, index) => ({ heading: `Photo ${index + 1}`, subheading: 'Add detail text below the photo', note: '', imageSrc: '', imageName: '' })) };
      this.ui = {};
    }

    mount() {
      if (!this.root) throw new Error('Builder root element is required.');
      injectCss();
      this.root.innerHTML = `<div class="npf-wrap"><div class="npf-grid"><div class="npf-stack"><div class="npf-card"><div class="npf-section npf-stack"><div><div class="npf-label">Flyer Builder</div><div style="margin-top:6px;font:900 26px/1.08 Arial,sans-serif;color:#0f172a">Phone-ready flyer builder</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">Select pictures, change the color scheme, edit the text below the photos, then export and share the flyer.</div></div><label class="npf-label">Headline<input class="npf-input" data-field="title"></label><label class="npf-label">Subheadline<textarea class="npf-textarea" data-field="subtitle"></textarea></label><label class="npf-label">Footer<input class="npf-input" data-field="footer"></label><label class="npf-label">Footer Note<textarea class="npf-textarea" data-field="footerNote"></textarea></label><div class="npf-label">Themes</div><div class="npf-themes" data-themes></div></div></div><div class="npf-card"><div class="npf-section npf-stack"><div><div class="npf-label">Native Camera</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">Uses navigator.mediaDevices.getUserMedia() inside the PWA. Capture to the selected flyer slot or record a quick clip.</div></div><div class="npf-video-shell"><video class="npf-video" autoplay playsinline muted></video><div class="npf-video-empty">Open the camera, choose Photo or Video, then capture into the selected flyer slot.</div></div><div class="npf-mode-row"><button type="button" class="npf-btn npf-muted npf-mode" data-mode="photo">Photo</button><button type="button" class="npf-btn npf-muted npf-mode" data-mode="video">Video</button></div><div class="npf-actions"><button type="button" class="npf-btn npf-primary" data-action="open">Open Camera</button><button type="button" class="npf-btn npf-secondary" data-action="capture">Capture To Slot</button><button type="button" class="npf-btn npf-secondary" data-action="record">Start Video</button><button type="button" class="npf-btn npf-muted" data-action="stop">Stop Camera</button></div><div class="npf-label" data-camera-status style="color:#64748b">Camera idle.</div></div></div><div class="npf-card"><div class="npf-section npf-stack"><div><div class="npf-label">Flyer Cards</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">Each card has its own photo, text below the photo, and note.</div></div><div class="npf-slots" data-slots></div></div></div></div><div class="npf-card"><div class="npf-section"><div class="npf-label">Preview</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">This canvas is the export source.</div></div><div class="npf-preview-shell"><canvas class="npf-canvas" width="1080" height="1350"></canvas></div></div><div class="npf-card"><div class="npf-section npf-stack"><div><div class="npf-label">Export And Share</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">Export a PNG, send it by in-app message, or open an email draft.</div></div><div class="npf-actions"><button type="button" class="npf-btn npf-primary" data-action="png">Export PNG</button><button type="button" class="npf-btn npf-secondary" data-action="message">In-App Message</button><button type="button" class="npf-btn npf-secondary" data-action="outlook">Email Draft</button></div><div class="npf-label" data-share-status style="color:#64748b">Ready to export.</div></div></div></div></div></div>`;
      this.ui.video = this.root.querySelector('.npf-video');
      this.ui.videoEmpty = this.root.querySelector('.npf-video-empty');
      this.ui.canvas = this.root.querySelector('.npf-canvas');
      this.ui.themeWrap = this.root.querySelector('[data-themes]');
      this.ui.slotWrap = this.root.querySelector('[data-slots]');
      this.ui.cameraStatus = this.root.querySelector('[data-camera-status]');
      this.ui.shareStatus = this.root.querySelector('[data-share-status]');
      this.ui.fields = Array.from(this.root.querySelectorAll('[data-field]'));
      this.ui.fields.forEach((field) => field.addEventListener('input', () => { this.state[field.dataset.field] = field.value; this.render(); }));
      Array.from(this.root.querySelectorAll('[data-mode]')).forEach((button) => button.addEventListener('click', () => { this.cameraMode = button.dataset.mode; this.renderUi(); }));
      Array.from(this.root.querySelectorAll('[data-action]')).forEach((button) => button.addEventListener('click', () => this.handleAction(button.dataset.action)));
      this.renderUi();
      this.render();
      return this;
    }

    renderUi() {
      this.ui.fields.forEach((field) => { field.value = this.state[field.dataset.field] || ''; });
      this.ui.themeWrap.innerHTML = Object.keys(THEMES).map((key) => `<button type="button" class="npf-btn npf-secondary npf-theme ${this.state.themeKey === key ? 'active' : ''}" data-theme="${key}" style="background:${THEMES[key].background};color:${THEMES[key].title};border-color:${THEMES[key].accent}">${key}</button>`).join('');
      Array.from(this.ui.themeWrap.querySelectorAll('[data-theme]')).forEach((button) => button.addEventListener('click', () => { this.state.themeKey = button.dataset.theme; this.state.theme = Object.assign({}, THEMES[button.dataset.theme]); this.renderUi(); this.render(); }));
      Array.from(this.root.querySelectorAll('[data-mode]')).forEach((button) => { const active = button.dataset.mode === this.cameraMode; button.classList.toggle('active', active); button.classList.toggle('npf-primary', active); button.classList.toggle('npf-muted', !active); });
      this.ui.slotWrap.innerHTML = this.state.cards.map((card, index) => `<div class="npf-slot"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px"><div class="npf-label" style="color:#0f7a4f">${index === this.selectedSlot ? 'Selected Slot' : 'Flyer Slot'} ${index + 1}</div><button type="button" class="npf-btn ${index === this.selectedSlot ? 'npf-primary' : 'npf-muted'}" data-select="${index}">Use This Slot</button></div><div class="npf-thumb" style="${card.imageSrc ? `background-image:url('${card.imageSrc.replace(/'/g, '%27')}');color:transparent;` : ''}">${card.imageSrc ? card.imageName || `Photo ${index + 1}` : 'No image selected yet'}</div><div class="npf-slot-actions" style="margin-top:10px"><button type="button" class="npf-btn npf-secondary" data-camera-slot="${index}">Camera</button><button type="button" class="npf-btn npf-secondary" data-file-slot="${index}">Choose File</button><button type="button" class="npf-btn npf-muted" data-clear-slot="${index}">Clear</button></div><label class="npf-label" style="margin-top:12px">Text Below Photo<input class="npf-input" data-card="heading" data-index="${index}" value="${this.escape(card.heading)}"></label><label class="npf-label">Subtext<textarea class="npf-textarea" data-card="subheading" data-index="${index}">${this.escape(card.subheading)}</textarea></label><label class="npf-label">Note<textarea class="npf-textarea" data-card="note" data-index="${index}">${this.escape(card.note)}</textarea></label></div>`).join('');
      Array.from(this.ui.slotWrap.querySelectorAll('[data-select]')).forEach((button) => button.addEventListener('click', () => { this.selectedSlot = Number(button.dataset.select || 0); this.renderUi(); }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-camera-slot]')).forEach((button) => button.addEventListener('click', async () => { this.selectedSlot = Number(button.dataset.cameraSlot || 0); this.renderUi(); await this.openCamera(); }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-file-slot]')).forEach((button) => button.addEventListener('click', async () => { this.selectedSlot = Number(button.dataset.fileSlot || 0); this.renderUi(); await this.pickFile(this.selectedSlot); }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-clear-slot]')).forEach((button) => button.addEventListener('click', () => { const index = Number(button.dataset.clearSlot || 0); this.state.cards[index].imageSrc = ''; this.state.cards[index].imageName = ''; this.renderUi(); this.render(); }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-card]')).forEach((field) => field.addEventListener('input', () => { const index = Number(field.dataset.index || 0); this.state.cards[index][field.dataset.card] = field.value; this.render(); }));
      this.setCameraStatus(this.camera.stream ? `Camera live in ${this.cameraMode} mode. Selected slot: ${this.selectedSlot + 1}.` : 'Camera idle.');
    }

    escape(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    setCameraStatus(text) { this.ui.cameraStatus.textContent = text; }
    setShareStatus(text) { this.ui.shareStatus.textContent = text; }
    async openCamera() { await this.camera.open(this.ui.video, this.cameraMode); this.ui.videoEmpty.style.display = 'none'; this.setCameraStatus(`Camera live in ${this.cameraMode} mode. Selected slot: ${this.selectedSlot + 1}.`); }
    async captureSelected() { if (!this.camera.stream) await this.openCamera(); const shot = await this.camera.capturePhoto(); const card = this.state.cards[this.selectedSlot]; card.imageSrc = shot.dataUrl; card.imageName = `${safeName(this.state.title)}-${this.selectedSlot + 1}.jpg`; this.renderUi(); this.render(); this.setCameraStatus(`Captured photo into slot ${this.selectedSlot + 1}.`); }
    async pickFile(index) { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment'; const file = await new Promise((resolve) => { input.addEventListener('change', () => resolve((input.files && input.files[0]) || null), { once: true }); input.click(); }); if (!file) return; this.state.cards[index].imageSrc = await blobToDataUrl(file); this.state.cards[index].imageName = file.name; this.renderUi(); this.render(); }
    async toggleRecord() { if (!this.camera.stream) await this.openCamera(); if (!this.recording) { this.camera.startVideo(); this.recording = true; this.setCameraStatus('Recording video... tap Start Video again to stop.'); return; } const blob = await this.camera.stopVideo(); this.recording = false; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}.webm`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); this.setCameraStatus('Video exported.'); }
    async handleAction(action) { if (action === 'open') return await this.openCamera(); if (action === 'capture') return await this.captureSelected(); if (action === 'record') return await this.toggleRecord(); if (action === 'stop') { this.camera.stop(); this.ui.videoEmpty.style.display = 'flex'; this.setCameraStatus('Camera stopped.'); return; } if (action === 'png') return await this.exportPng(); if (action === 'message') return await this.sendInAppMessage(); if (action === 'outlook') return await this.openOutlookDraft(); }
    async render() { const canvas = this.ui.canvas; const ctx = canvas.getContext('2d'); const theme = this.state.theme; const padding = 64; const usable = canvas.width - padding * 2; const gap = 28; const cardWidth = (usable - gap) / 2; const topHeight = 240; const footerHeight = 128; const cards = this.state.cards.filter((card) => card.imageSrc || card.heading || card.subheading || card.note); const list = cards.length ? cards : this.state.cards; ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = theme.background; ctx.fillRect(0, 0, canvas.width, canvas.height); roundRect(ctx, padding, padding, usable, topHeight - 22, 34); ctx.fillStyle = theme.panel; ctx.fill(); ctx.fillStyle = theme.accent; ctx.fillRect(padding + 28, padding + 28, 170, 12); ctx.fillStyle = theme.title; ctx.font = '900 64px Arial'; ctx.fillText(this.state.title || 'Flyer Title', padding + 28, padding + 108); ctx.fillStyle = theme.body; ctx.font = '700 28px Arial'; wrapText(ctx, this.state.subtitle || '', usable - 56, 3).forEach((line, index) => ctx.fillText(line, padding + 28, padding + 152 + (index * 36))); const rows = Math.max(1, Math.ceil(list.length / 2)); const availableHeight = canvas.height - (padding + topHeight) - footerHeight - padding; const cardHeight = Math.max(300, Math.floor((availableHeight - ((rows - 1) * 28)) / rows)); for (let i = 0; i < list.length; i += 1) { const card = list[i]; const col = i % 2; const row = Math.floor(i / 2); const x = padding + (col * (cardWidth + gap)); const y = padding + topHeight + (row * (cardHeight + 28)); roundRect(ctx, x, y, cardWidth, cardHeight, 34); ctx.fillStyle = theme.panel; ctx.shadowColor = 'rgba(15,23,42,.12)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 10; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; const ix = x + 22; const iy = y + 22; const iw = cardWidth - 44; const ih = Math.min(250, cardHeight - 170); roundRect(ctx, ix, iy, iw, ih, 26); ctx.save(); ctx.clip(); if (card.imageSrc) { try { const image = await loadImage(card.imageSrc); const scale = Math.max(iw / image.width, ih / image.height); const dw = image.width * scale; const dh = image.height * scale; ctx.drawImage(image, ix + ((iw - dw) / 2), iy + ((ih - dh) / 2), dw, dh); } catch (error) { ctx.fillStyle = '#dbe7df'; ctx.fillRect(ix, iy, iw, ih); } } else { ctx.fillStyle = '#eaf1ec'; ctx.fillRect(ix, iy, iw, ih); ctx.fillStyle = theme.body; ctx.font = '900 24px Arial'; ctx.textAlign = 'center'; ctx.fillText('Add Photo', ix + (iw / 2), iy + (ih / 2)); ctx.textAlign = 'left'; } ctx.restore(); let ty = iy + ih + 36; ctx.fillStyle = theme.title; ctx.font = '900 28px Arial'; wrapText(ctx, card.heading || `Photo ${i + 1}`, cardWidth - 48, 2).forEach((line) => { ctx.fillText(line, x + 24, ty); ty += 34; }); ctx.fillStyle = theme.body; ctx.font = '700 19px Arial'; wrapText(ctx, card.subheading || '', cardWidth - 48, 3).forEach((line) => { ctx.fillText(line, x + 24, ty); ty += 25; }); if (card.note) { ty += 8; ctx.fillStyle = theme.accent; ctx.font = '900 16px Arial'; wrapText(ctx, card.note, cardWidth - 48, 4).forEach((line) => { ctx.fillText(line, x + 24, ty); ty += 21; }); } } roundRect(ctx, padding, canvas.height - footerHeight - padding, usable, footerHeight, 30); ctx.fillStyle = theme.panel; ctx.fill(); ctx.fillStyle = theme.accent; ctx.fillRect(padding + 28, canvas.height - footerHeight - padding + 24, 140, 10); ctx.fillStyle = theme.title; ctx.font = '900 32px Arial'; ctx.fillText(this.state.footer || '', padding + 28, canvas.height - footerHeight - padding + 68); ctx.fillStyle = theme.body; ctx.font = '700 20px Arial'; wrapText(ctx, this.state.footerNote || '', usable - 56, 2).forEach((line, index) => ctx.fillText(line, padding + 28, canvas.height - footerHeight - padding + 102 + (index * 24))); }
    async exportAsBlob(type = 'image/png', quality = 1) { await this.render(); return await canvasToBlob(this.ui.canvas, type, quality); }
    async exportPng() { const blob = await this.exportAsBlob('image/png', 1); const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}.png`; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); this.setShareStatus(`${fileName} downloaded.`); return { blob, fileName }; }
    buildShareText(link) { const lines = [this.state.title, this.state.subtitle, '', ...this.state.cards.filter((card) => card.imageSrc || card.heading || card.subheading || card.note).flatMap((card, index) => { const row = [`${index + 1}. ${card.heading || `Photo ${index + 1}`}`]; if (card.subheading) row.push(card.subheading); if (card.note) row.push(`Note: ${card.note}`); return row.concat(['']); }), `Footer: ${this.state.footer}`, `Footer Note: ${this.state.footerNote}`]; if (link) lines.push('', `Flyer Link: ${link}`); return lines.join('\n').trim(); }
    async sendInAppMessage(options) { const opts = Object.assign({ threadId: '', recipients: [], table: 'v2_chat_messages', uploadFlyerBlob: this.uploadFlyerBlob, insertMessage: null, supabaseFetchFn: this.supabaseFetchFn }, options || {}); await this.render(); const blob = await canvasToBlob(this.ui.canvas, 'image/png', 1); const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}.png`; let flyerUrl = ''; if (typeof opts.uploadFlyerBlob === 'function') flyerUrl = await opts.uploadFlyerBlob(blob, fileName, this.state); const messageText = this.buildShareText(flyerUrl); if (typeof opts.insertMessage === 'function') { const result = await opts.insertMessage({ threadId: opts.threadId, recipients: opts.recipients, messageText, attachmentUrl: flyerUrl, fileName, flyerState: this.state, sentBy: this.currentUser }); this.setShareStatus('Flyer sent through in-app messaging.'); return result; } if (typeof opts.supabaseFetchFn === 'function') { const result = await opts.supabaseFetchFn(opts.table, 'POST', { thread_id: opts.threadId || null, recipient_usernames: Array.isArray(opts.recipients) ? opts.recipients : [], message_type: 'flyer', message_text: messageText, attachment_url: flyerUrl || null, attachment_name: fileName, created_by: this.currentUser, flyer_title: this.state.title, flyer_theme: JSON.stringify(this.state.theme) }); this.setShareStatus('Flyer sent through in-app messaging.'); return result; } this.setShareStatus('No in-app messaging hook was configured.'); return { messageText, flyerUrl, fileName, flyerState: this.state }; }
    async openOutlookDraft(options) { const opts = Object.assign({ to: '', cc: '', subject: this.state.title, uploadFlyerBlob: this.uploadFlyerBlob }, options || {}); await this.render(); const blob = await canvasToBlob(this.ui.canvas, 'image/png', 1); const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}.png`; let flyerUrl = ''; if (typeof opts.uploadFlyerBlob === 'function') flyerUrl = await opts.uploadFlyerBlob(blob, fileName, this.state); const body = this.buildShareText(flyerUrl); const url = `https://outlook.office.com/mail/deeplink/compose?${new URLSearchParams({ to: opts.to || '', cc: opts.cc || '', subject: opts.subject || this.state.title, body }).toString()}`; global.open(url, '_blank', 'noopener'); this.setShareStatus('Outlook draft opened.'); return { url, body, flyerUrl, fileName }; }
  }

  global.NativePwaFlyer = { Builder, NativeCamera, THEMES };
})(window);