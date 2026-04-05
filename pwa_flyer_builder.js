(function (global) {
  'use strict';

  const THEMES = {
    sage: { background: '#f5f5ef', panel: '#ffffff', accent: '#0f7a4f', title: '#112033', body: '#334155' },
    warm: { background: '#fff7ef', panel: '#ffffff', accent: '#d97706', title: '#3f2205', body: '#6b3b0d' },
    bloom: { background: '#fff6fb', panel: '#ffffff', accent: '#be185d', title: '#431427', body: '#6b2148' },
    slate: { background: '#f8fafc', panel: '#ffffff', accent: '#1d4ed8', title: '#0f172a', body: '#334155' }
  };

  const BUILDER_STATE_STORAGE_KEY = 'gnc_native_flyer_builder_state_v1';

  const BUILDER_CSS = `
    .npf-wrap{display:grid;gap:16px}.npf-grid{display:grid;gap:16px;grid-template-columns:minmax(320px,440px) minmax(320px,1fr)}
    .npf-card{background:#fff;border:1px solid #d9e4dc;border-radius:24px;box-shadow:0 18px 36px rgba(15,23,42,.08);overflow:hidden}
    .npf-section{padding:18px}.npf-stack{display:grid;gap:10px}.npf-label{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#475569}
    .npf-input,.npf-textarea{width:100%;border:1px solid #d6e3db;border-radius:16px;padding:12px 14px;font:700 14px/1.4 Arial,sans-serif;color:#0f172a;background:#fff}.npf-textarea{min-height:76px;resize:vertical}
    .npf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:10px 16px;border-radius:999px;border:1px solid transparent;font:900 11px/1 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer}
    .npf-primary{background:#0f7a4f;color:#fff}.npf-secondary{background:#eef6f1;color:#0f7a4f;border-color:#cfe4d6}.npf-muted{background:#f8fafc;color:#475569;border-color:#d8e0ea}
    .npf-themes,.npf-actions,.npf-slot-actions,.npf-mode-row{display:flex;flex-wrap:wrap;gap:8px}.npf-theme.active,.npf-mode.active{box-shadow:inset 0 0 0 2px rgba(15,122,79,.2)}
    .npf-video-shell{position:relative;overflow:hidden;border-radius:22px;background:radial-gradient(circle at top,#166534 0%,#0f172a 56%,#020617 100%);aspect-ratio:3/4;min-height:300px}
    .npf-video-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:rgba(255,255,255,.88);font:800 14px/1.45 Arial,sans-serif}
    .npf-slots{display:grid;gap:12px}.npf-slot{border:1px solid #dbe7df;border-radius:20px;padding:14px;background:#f8fbf9}.npf-thumb{width:100%;aspect-ratio:16/10;border-radius:18px;background:#dfe9e2 center/cover no-repeat;border:1px dashed #bfd2c4;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;color:#64748b;font:800 12px/1.4 Arial,sans-serif}
    .npf-thumb-caption{margin-top:8px;font:800 11px/1.4 Arial,sans-serif;color:#475569}.npf-photo-picker{display:grid;gap:8px;margin-top:12px}.npf-photo-rail{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}.npf-photo-rail::-webkit-scrollbar{display:none}
    .npf-photo-option{min-width:92px;width:92px;border:1px solid #d6e3db;background:#fff;border-radius:18px;padding:6px;display:grid;gap:6px;cursor:pointer;box-shadow:0 8px 18px rgba(15,23,42,.05)}.npf-photo-option.active{border-color:#0f7a4f;box-shadow:0 0 0 2px rgba(15,122,79,.14),0 8px 18px rgba(15,23,42,.08)}
    .npf-photo-mini{width:100%;aspect-ratio:1/1;border-radius:12px;background:#dfe9e2 center/cover no-repeat}.npf-photo-caption{font:800 10px/1.3 Arial,sans-serif;color:#334155;text-align:left;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.npf-photo-empty{font:800 11px/1.4 Arial,sans-serif;color:#94a3b8;padding:6px 0 2px}
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
    ctx.moveTo(x + d, y);
    ctx.arcTo(x + w, y, x + w, y + h, d);
    ctx.arcTo(x + w, y + h, x, y + h, d);
    ctx.arcTo(x, y + h, x, y, d);
    ctx.arcTo(x, y, x + w, y, d);
    ctx.closePath();
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
      else {
        lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    return maxLines ? lines.slice(0, maxLines) : lines;
  }

  function normalizePhotoOption(option, index) {
    if (!option) return null;
    if (typeof option === 'string') option = { src: option };
    const src = String(option.src || option.url || '').trim();
    if (!src) return null;
    const fallbackName = `Photo ${Number(index || 0) + 1}`;
    const name = String(option.name || option.label || option.displayName || fallbackName).trim() || fallbackName;
    const displayName = String(option.displayName || name).trim() || name;
    const source = String(option.source || 'library').trim() || 'library';
    return { src, name, displayName, source, token: String(option.token || src).trim() || src };
  }

  function mergePhotoOptions() {
    const merged = [];
    const seen = new Set();
    Array.from(arguments).forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((option, index) => {
        const normalized = normalizePhotoOption(option, index);
        if (!normalized) return;
        const key = normalized.token || normalized.src;
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(normalized);
      });
    });
    return merged;
  }

  class NativeCamera {
    constructor() {
      this.mode = 'photo';
      this.stream = null;
    }
    async open(mode) {
      this.mode = mode === 'video' ? 'video' : 'photo';
      return null;
    }
    stop() {
      this.mode = 'photo';
      this.stream = null;
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
      this.selectedSlot = 0;
      this.pendingNativeSlot = 0;
      this.pendingNativeKind = 'image';
      this.state = {
        themeKey: opts.theme,
        theme: Object.assign({}, THEMES[opts.theme] || THEMES.sage),
        title: opts.title,
        subtitle: opts.subtitle,
        footer: opts.footer,
        footerNote: opts.footerNote,
        cards: Array.from({ length: Math.max(1, opts.slots) }).map((_, index) => this.createDefaultCard(index))
      };
      this.ui = {};
      this.storageKey = BUILDER_STATE_STORAGE_KEY;
    }

    createDefaultCard(index) {
      return {
        heading: `Photo ${Number(index || 0) + 1}`,
        subheading: 'Add detail text below the photo',
        note: '',
        imageSrc: '',
        imageName: '',
        photoOptions: [],
        selectedPhotoIndex: -1,
        manualClear: false
      };
    }

    normalizeCard(card, index) {
      const base = Object.assign({}, this.createDefaultCard(index), card || {});
      let photoOptions = mergePhotoOptions(base.photoOptions || []);
      const imageSrc = String(base.imageSrc || '').trim();
      const imageName = String(base.imageName || '').trim() || `Photo ${Number(index || 0) + 1}`;
      if (imageSrc) {
        photoOptions = mergePhotoOptions(photoOptions, [{ src: imageSrc, name: imageName, displayName: imageName, source: 'selected' }]);
      }
      base.photoOptions = photoOptions;
      let selectedPhotoIndex = Number.isFinite(Number(base.selectedPhotoIndex)) ? Number(base.selectedPhotoIndex) : -1;
      if (imageSrc) {
        const matchedIndex = photoOptions.findIndex((option) => String(option.src || '').trim() === imageSrc);
        if (matchedIndex >= 0) selectedPhotoIndex = matchedIndex;
      }
      if (base.manualClear && !imageSrc) {
        base.selectedPhotoIndex = -1;
        base.imageSrc = '';
        base.imageName = '';
        return base;
      }
      if (selectedPhotoIndex < 0 && photoOptions.length && !imageSrc) selectedPhotoIndex = 0;
      if (selectedPhotoIndex >= photoOptions.length) selectedPhotoIndex = photoOptions.length ? 0 : -1;
      if (selectedPhotoIndex >= 0 && photoOptions[selectedPhotoIndex]) {
        base.selectedPhotoIndex = selectedPhotoIndex;
        base.imageSrc = photoOptions[selectedPhotoIndex].src;
        base.imageName = photoOptions[selectedPhotoIndex].name;
        base.manualClear = false;
      } else {
        base.selectedPhotoIndex = -1;
        base.imageSrc = imageSrc;
        base.imageName = imageSrc ? imageName : '';
      }
      return base;
    }

    normalizeCards() {
      const incoming = Array.isArray(this.state.cards) ? this.state.cards : [];
      this.state.cards = incoming.length ? incoming.map((card, index) => this.normalizeCard(card, index)) : [this.createDefaultCard(0)];
      if (this.selectedSlot >= this.state.cards.length) this.selectedSlot = 0;
    }

    mount() {
      if (!this.root) throw new Error('Builder root element is required.');
      injectCss();
      this.restorePersistedState();
      this.normalizeCards();
      this.root.innerHTML = `<div class="npf-wrap"><div class="npf-grid"><div class="npf-stack"><div class="npf-card"><div class="npf-section npf-stack"><div><div class="npf-label">Flyer Builder</div><div style="margin-top:6px;font:900 26px/1.08 Arial,sans-serif;color:#0f172a">Phone-ready flyer builder</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">Select pictures, change the color scheme, edit the text below the photos, then export and share the flyer.</div></div><label class="npf-label">Headline<input class="npf-input" data-field="title"></label><label class="npf-label">Subheadline<textarea class="npf-textarea" data-field="subtitle"></textarea></label><label class="npf-label">Footer<input class="npf-input" data-field="footer"></label><label class="npf-label">Footer Note<textarea class="npf-textarea" data-field="footerNote"></textarea></label><div class="npf-label">Themes</div><div class="npf-themes" data-themes></div></div></div><div class="npf-card"><div class="npf-section npf-stack"><div><div class="npf-label">Native Camera</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">Portrait and Photo hand off to your phone camera. Use Samsung Portrait Mode there, then return with the file.</div></div><div class="npf-video-shell"><div class="npf-video-empty">Tap Open Camera or Capture To Slot. The app will wait while your phone camera opens, then continue when you return with the photo.</div></div><div class="npf-mode-row"><button type="button" class="npf-btn npf-muted npf-mode" data-mode="portrait">Portrait</button><button type="button" class="npf-btn npf-muted npf-mode" data-mode="photo">Photo</button><button type="button" class="npf-btn npf-muted npf-mode" data-mode="video">Video</button></div><div class="npf-actions"><button type="button" class="npf-btn npf-primary" data-action="open">Open Camera</button><button type="button" class="npf-btn npf-secondary" data-action="capture">Capture To Slot</button><button type="button" class="npf-btn npf-muted" data-action="stop">Reset Status</button></div><div class="npf-label" data-camera-status style="color:#64748b">Ready to use your phone camera.</div><input type="file" accept="image/*" capture="environment" class="hidden" data-native-image-input><input type="file" accept="video/*"  class="hidden" data-native-video-input></div></div><div class="npf-card"><div class="npf-section npf-stack"><div><div class="npf-label">Flyer Cards</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">Each card has its own photo, text below the photo, and note.</div></div><div class="npf-slots" data-slots></div></div></div></div><div class="npf-card"><div class="npf-section"><div class="npf-label">Preview</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">This canvas is the export source.</div></div><div class="npf-preview-shell"><canvas class="npf-canvas" width="1080" height="1350"></canvas></div></div><div class="npf-card"><div class="npf-section npf-stack"><div><div class="npf-label">Export And Share</div><div style="margin-top:6px;font:600 13px/1.45 Arial,sans-serif;color:#64748b">Export a PNG, send it by in-app message, or open an email draft.</div></div><div class="npf-actions"><button type="button" class="npf-btn npf-primary" data-action="png">Export PNG</button><button type="button" class="npf-btn npf-secondary" data-action="message">In-App Message</button><button type="button" class="npf-btn npf-secondary" data-action="outlook">Email Draft</button></div><div class="npf-label" data-share-status style="color:#64748b">Ready to export.</div></div></div></div></div></div>`;
      this.ui.canvas = this.root.querySelector('.npf-canvas');
      this.ui.themeWrap = this.root.querySelector('[data-themes]');
      this.ui.slotWrap = this.root.querySelector('[data-slots]');
      this.ui.cameraStatus = this.root.querySelector('[data-camera-status]');
      this.ui.shareStatus = this.root.querySelector('[data-share-status]');
      this.ui.fields = Array.from(this.root.querySelectorAll('[data-field]'));
      this.ui.nativeImageInput = this.root.querySelector('[data-native-image-input]');
      this.ui.nativeVideoInput = this.root.querySelector('[data-native-video-input]');
      this.ui.fields.forEach((field) => field.addEventListener('input', () => {
        this.state[field.dataset.field] = field.value;
        this.persistState();
        this.render();
      }));
      Array.from(this.root.querySelectorAll('[data-mode]')).forEach((button) => button.addEventListener('click', () => {
        this.cameraMode = button.dataset.mode;
        this.renderUi();
      }));
      Array.from(this.root.querySelectorAll('[data-action]')).forEach((button) => button.addEventListener('click', () => this.handleAction(button.dataset.action)));
      if (this.ui.nativeImageInput) this.ui.nativeImageInput.addEventListener('change', () => { this.handleNativeInputChange('image'); });
      if (this.ui.nativeVideoInput) this.ui.nativeVideoInput.addEventListener('change', () => { this.handleNativeInputChange('video'); });
      this.renderUi();
      this.render();
      return this;
    }

    renderUi() {
      this.normalizeCards();
      this.ui.fields.forEach((field) => { field.value = this.state[field.dataset.field] || ''; });
      this.ui.themeWrap.innerHTML = Object.keys(THEMES).map((key) => `<button type="button" class="npf-btn npf-secondary npf-theme ${this.state.themeKey === key ? 'active' : ''}" data-theme="${key}" style="background:${THEMES[key].background};color:${THEMES[key].title};border-color:${THEMES[key].accent}">${key}</button>`).join('');
      Array.from(this.ui.themeWrap.querySelectorAll('[data-theme]')).forEach((button) => button.addEventListener('click', () => {
        this.state.themeKey = button.dataset.theme;
        this.state.theme = Object.assign({}, THEMES[button.dataset.theme] || THEMES.sage);
        this.persistState();
        this.renderUi();
        this.render().catch(() => {});
      }));
      Array.from(this.root.querySelectorAll('[data-mode]')).forEach((button) => {
        const active = button.dataset.mode === this.cameraMode;
        button.classList.toggle('active', active);
        button.classList.toggle('npf-primary', active);
        button.classList.toggle('npf-muted', !active);
      });
      this.ui.slotWrap.innerHTML = this.state.cards.map((card, index) => {
        const thumbStyle = card.imageSrc ? `background-image:url('${String(card.imageSrc || '').replace(/'/g, '%27')}');color:transparent;` : '';
        const photoRail = card.photoOptions.length
          ? `<div class="npf-photo-picker"><div class="npf-label" style="color:#0f7a4f">Row Photos</div><div class="npf-photo-rail">${card.photoOptions.map((option, optionIndex) => `<button type="button" class="npf-photo-option ${card.selectedPhotoIndex === optionIndex && !card.manualClear ? 'active' : ''}" data-photo-option="${index}:${optionIndex}" title="${this.escape(option.displayName || option.name || `Photo ${optionIndex + 1}`)}"><div class="npf-photo-mini" style="background-image:url('${String(option.src || '').replace(/'/g, '%27')}')"></div><div class="npf-photo-caption">${this.escape(option.displayName || option.name || `Photo ${optionIndex + 1}`)}</div></button>`).join('')}</div></div>`
          : `<div class="npf-photo-empty">No saved row photos yet for this flyer item.</div>`;
        return `<div class="npf-slot"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:10px"><div class="npf-label" style="color:#0f7a4f">${index === this.selectedSlot ? 'Selected Slot' : 'Flyer Slot'} ${index + 1}</div><button type="button" class="npf-btn ${index === this.selectedSlot ? 'npf-primary' : 'npf-muted'}" data-select="${index}">Use This Slot</button></div><div class="npf-thumb" style="${thumbStyle}">${card.imageSrc ? card.imageName || `Photo ${index + 1}` : 'No image selected yet'}</div><div class="npf-thumb-caption">${this.escape(card.imageName || (card.manualClear ? 'Slot cleared. Tap a row photo to use it again.' : 'Tap any saved row photo below to choose it for the flyer.'))}</div>${photoRail}<div class="npf-slot-actions" style="margin-top:10px"><button type="button" class="npf-btn npf-secondary" data-camera-slot="${index}">Camera</button><button type="button" class="npf-btn npf-secondary" data-file-slot="${index}">Choose File</button><button type="button" class="npf-btn npf-muted" data-clear-slot="${index}">Clear</button></div><label class="npf-label" style="margin-top:12px">Text Below Photo<input class="npf-input" data-card="heading" data-index="${index}" value="${this.escape(card.heading)}"></label><label class="npf-label">Subtext<textarea class="npf-textarea" data-card="subheading" data-index="${index}">${this.escape(card.subheading)}</textarea></label><label class="npf-label">Note<textarea class="npf-textarea" data-card="note" data-index="${index}">${this.escape(card.note)}</textarea></label></div>`;
      }).join('');
      Array.from(this.ui.slotWrap.querySelectorAll('[data-select]')).forEach((button) => button.addEventListener('click', () => {
        this.selectedSlot = Number(button.dataset.select || 0);
        this.persistState();
        this.renderUi();
      }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-photo-option]')).forEach((button) => button.addEventListener('click', () => {
        const parts = String(button.dataset.photoOption || '').split(':');
        this.selectPhotoOption(Number(parts[0] || 0), Number(parts[1] || 0));
      }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-camera-slot]')).forEach((button) => button.addEventListener('click', async () => {
        this.selectedSlot = Number(button.dataset.cameraSlot || 0);
        this.renderUi();
        await this.openCamera();
      }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-file-slot]')).forEach((button) => button.addEventListener('click', async () => {
        this.selectedSlot = Number(button.dataset.fileSlot || 0);
        this.renderUi();
        await this.pickFile(this.selectedSlot);
      }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-clear-slot]')).forEach((button) => button.addEventListener('click', () => {
        this.clearSlot(Number(button.dataset.clearSlot || 0));
      }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-card]')).forEach((field) => field.addEventListener('input', () => {
        const index = Number(field.dataset.index || 0);
        this.state.cards[index][field.dataset.card] = field.value;
        this.persistState();
        this.render().catch(() => {});
      }));
      this.setCameraStatus(this.getCameraStatusText());
    }
    persistState() {
      this.normalizeCards();
      try {
        sessionStorage.setItem(this.storageKey, JSON.stringify({
          state: this.state,
          selectedSlot: this.selectedSlot,
          cameraMode: this.cameraMode
        }));
      } catch (error) {}
    }

    restorePersistedState() {
      try {
        const raw = sessionStorage.getItem(this.storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.state && typeof parsed.state === 'object') this.state = parsed.state;
        if (parsed && Number.isFinite(Number(parsed.selectedSlot))) this.selectedSlot = Number(parsed.selectedSlot);
        if (parsed && parsed.cameraMode) this.cameraMode = String(parsed.cameraMode);
      } catch (error) {}
    }

    getCameraStatusText() {
      if (this.cameraMode === 'portrait') return `Portrait mode selected. Slot ${this.selectedSlot + 1} is ready for the phone camera handoff.`;
      if (this.cameraMode === 'video') return `Video mode selected. Slot ${this.selectedSlot + 1} is ready for a native camera handoff.`;
      return `Photo mode selected. Slot ${this.selectedSlot + 1} is ready for the phone camera handoff.`;
    }

    escape(value) {
      return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    setCameraStatus(text) {
      if (this.ui.cameraStatus) this.ui.cameraStatus.textContent = text;
    }

    setShareStatus(text) {
      if (this.ui.shareStatus) this.ui.shareStatus.textContent = text;
    }

    revokeBlobUrl(url) {
      const src = String(url || '').trim();
      if (src && src.indexOf('blob:') === 0) {
        try { URL.revokeObjectURL(src); } catch (error) {}
      }
    }

    selectPhotoOption(slotIndex, optionIndex) {
      const index = Math.max(0, Math.min(this.state.cards.length - 1, Number(slotIndex || 0)));
      const card = this.state.cards[index] = this.normalizeCard(this.state.cards[index], index);
      const option = card.photoOptions[Number(optionIndex || 0)];
      if (!option) return;
      card.selectedPhotoIndex = Number(optionIndex || 0);
      card.imageSrc = option.src;
      card.imageName = option.name;
      card.manualClear = false;
      this.selectedSlot = index;
      this.persistState();
      this.renderUi();
      this.render().catch(() => {});
    }

    clearSlot(slotIndex) {
      const index = Math.max(0, Math.min(this.state.cards.length - 1, Number(slotIndex || 0)));
      const card = this.state.cards[index] = this.normalizeCard(this.state.cards[index], index);
      const selected = card.selectedPhotoIndex >= 0 ? card.photoOptions[card.selectedPhotoIndex] : null;
      if (selected && selected.source !== 'row') {
        this.revokeBlobUrl(selected.src);
        card.photoOptions = card.photoOptions.filter((_, optionIndex) => optionIndex !== card.selectedPhotoIndex);
      }
      card.imageSrc = '';
      card.imageName = '';
      card.selectedPhotoIndex = -1;
      card.manualClear = true;
      this.persistState();
      this.renderUi();
      this.render().catch(() => {});
    }

    async openCamera() {
      const kind = this.cameraMode === 'video' ? 'video' : 'image';
      await this.camera.open(this.cameraMode);
      this.pendingNativeSlot = this.selectedSlot;
      this.pendingNativeKind = kind;
      const input = kind === 'video' ? this.ui.nativeVideoInput : this.ui.nativeImageInput;
      if (!input) {
        this.setCameraStatus('The native camera input is not ready yet.');
        return null;
      }
      try { input.value = ''; } catch (error) {}
      this.persistState();
      if (typeof global.showToast === 'function') global.showToast('Portrait Tip', 'Select "Camera" then swipe to "Portrait" mode.', false);
      this.setCameraStatus(this.cameraMode === 'portrait'
        ? 'Opening Samsung Camera. Switch to Portrait Mode there if available, then return with the file.'
        : (kind === 'video' ? 'Opening Samsung Camera for video capture...' : 'Opening Samsung Camera for photo capture...'));
      input.click();
      return true;
    }

    async captureSelected() {
      return await this.openCamera();
    }

    async handleNativeInputChange(kind) {
      const input = kind === 'video' ? this.ui.nativeVideoInput : this.ui.nativeImageInput;
      const file = input && input.files && input.files[0] ? input.files[0] : null;
      if (!file) {
        this.setCameraStatus('Native camera closed without a file.');
        return null;
      }
      const slotIndex = Math.max(0, Math.min(this.state.cards.length - 1, Number(this.pendingNativeSlot || 0)));
      try {
        return await this.applyCapturedFile(file, slotIndex, kind);
      } finally {
        try { input.value = ''; } catch (error) {}
      }
    }

    async applyCapturedFile(file, index, kind) {
      if (!file) return null;
      if (kind === 'video') {
        this.setCameraStatus(`Video returned from the phone camera for slot ${index + 1}. Flyer cards still use still photos only.`);
        return file;
      }
      const objectUrl = URL.createObjectURL(file);
      const imageName = file.name || `${safeName(this.state.title)}-${index + 1}.jpg`;
      const card = this.state.cards[index] = this.normalizeCard(this.state.cards[index], index);
      card.photoOptions = mergePhotoOptions(card.photoOptions, [{ src: objectUrl, name: imageName, displayName: imageName, source: 'upload' }]);
      const selectedIndex = card.photoOptions.findIndex((option) => String(option.src || '').trim() === objectUrl);
      card.selectedPhotoIndex = selectedIndex >= 0 ? selectedIndex : card.photoOptions.length - 1;
      card.imageSrc = objectUrl;
      card.imageName = imageName;
      card.manualClear = false;
      this.persistState();
      this.renderUi();
      this.render().catch(() => {});
      this.setCameraStatus(this.cameraMode === 'portrait'
        ? `Portrait photo returned from Samsung Camera into slot ${index + 1}.`
        : `Photo returned from Samsung Camera into slot ${index + 1}.`);
      return file;
    }

    async pickFile(index, options) {
      const opts = Object.assign({ camera: false }, options || {});
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';

      const file = await new Promise((resolve) => {
        input.addEventListener('change', () => resolve((input.files && input.files[0]) || null), { once: true });
        input.click();
      });
      if (!file) return null;
      return await this.applyCapturedFile(file, index, 'image');
    }

    async handleAction(action) {
      if (action === 'open') return await this.openCamera();
      if (action === 'capture') return await this.captureSelected();
      if (action === 'stop') {
        this.camera.stop();
        this.pendingNativeKind = 'image';
        this.setCameraStatus(this.getCameraStatusText());
        return;
      }
      if (action === 'png') return await this.exportPng();
      if (action === 'message') return await this.sendInAppMessage();
      if (action === 'outlook') return await this.openOutlookDraft();
    }

    async render() {
      const canvas = this.ui.canvas;
      const ctx = canvas.getContext('2d');
      const theme = this.state.theme;
      const padding = 64;
      const usable = canvas.width - padding * 2;
      const gap = 28;
      const cardWidth = (usable - gap) / 2;
      const topHeight = 240;
      const footerHeight = 128;
      const cards = this.state.cards.filter((card) => card.imageSrc || card.heading || card.subheading || card.note);
      const list = cards.length ? cards : this.state.cards;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      roundRect(ctx, padding, padding, usable, topHeight - 22, 34);
      ctx.fillStyle = theme.panel;
      ctx.fill();
      ctx.fillStyle = theme.accent;
      ctx.fillRect(padding + 28, padding + 28, 170, 12);
      ctx.fillStyle = theme.title;
      ctx.font = '900 64px Arial';
      ctx.fillText(this.state.title || 'Flyer Title', padding + 28, padding + 108);
      ctx.fillStyle = theme.body;
      ctx.font = '700 28px Arial';
      wrapText(ctx, this.state.subtitle || '', usable - 56, 3).forEach((line, index) => ctx.fillText(line, padding + 28, padding + 152 + (index * 36)));
      const rows = Math.max(1, Math.ceil(list.length / 2));
      const availableHeight = canvas.height - (padding + topHeight) - footerHeight - padding;
      const cardHeight = Math.max(300, Math.floor((availableHeight - ((rows - 1) * 28)) / rows));
      for (let i = 0; i < list.length; i += 1) {
        const card = list[i];
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = padding + (col * (cardWidth + gap));
        const y = padding + topHeight + (row * (cardHeight + 28));
        roundRect(ctx, x, y, cardWidth, cardHeight, 34);
        ctx.fillStyle = theme.panel;
        ctx.shadowColor = 'rgba(15,23,42,.12)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 10;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        const ix = x + 22;
        const iy = y + 22;
        const iw = cardWidth - 44;
        const ih = Math.min(250, cardHeight - 170);
        roundRect(ctx, ix, iy, iw, ih, 26);
        ctx.save();
        ctx.clip();
        if (card.imageSrc) {
          try {
            const image = await loadImage(card.imageSrc);
            const scale = Math.max(iw / image.width, ih / image.height);
            const dw = image.width * scale;
            const dh = image.height * scale;
            ctx.drawImage(image, ix + ((iw - dw) / 2), iy + ((ih - dh) / 2), dw, dh);
          } catch (error) {
            ctx.fillStyle = '#dbe7df';
            ctx.fillRect(ix, iy, iw, ih);
          }
        } else {
          ctx.fillStyle = '#eaf1ec';
          ctx.fillRect(ix, iy, iw, ih);
          ctx.fillStyle = theme.body;
          ctx.font = '900 24px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('Add Photo', ix + (iw / 2), iy + (ih / 2));
          ctx.textAlign = 'left';
        }
        ctx.restore();
        let ty = iy + ih + 36;
        ctx.fillStyle = theme.title;
        ctx.font = '900 28px Arial';
        wrapText(ctx, card.heading || `Photo ${i + 1}`, cardWidth - 48, 2).forEach((line) => {
          ctx.fillText(line, x + 24, ty);
          ty += 34;
        });
        ctx.fillStyle = theme.body;
        ctx.font = '700 19px Arial';
        wrapText(ctx, card.subheading || '', cardWidth - 48, 3).forEach((line) => {
          ctx.fillText(line, x + 24, ty);
          ty += 25;
        });
        if (card.note) {
          ty += 8;
          ctx.fillStyle = theme.accent;
          ctx.font = '900 16px Arial';
          wrapText(ctx, card.note, cardWidth - 48, 4).forEach((line) => {
            ctx.fillText(line, x + 24, ty);
            ty += 21;
          });
        }
      }
      roundRect(ctx, padding, canvas.height - footerHeight - padding, usable, footerHeight, 30);
      ctx.fillStyle = theme.panel;
      ctx.fill();
      ctx.fillStyle = theme.accent;
      ctx.fillRect(padding + 28, canvas.height - footerHeight - padding + 24, 140, 10);
      ctx.fillStyle = theme.title;
      ctx.font = '900 32px Arial';
      ctx.fillText(this.state.footer || '', padding + 28, canvas.height - footerHeight - padding + 68);
      ctx.fillStyle = theme.body;
      ctx.font = '700 20px Arial';
      wrapText(ctx, this.state.footerNote || '', usable - 56, 2).forEach((line, index) => ctx.fillText(line, padding + 28, canvas.height - footerHeight - padding + 102 + (index * 24)));
    }

    async exportAsBlob(type = 'image/png', quality = 1) {
      await this.render();
      return await canvasToBlob(this.ui.canvas, type, quality);
    }

    async exportPng() {
      const blob = await this.exportAsBlob('image/png', 1);
      const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      this.setShareStatus(`${fileName} downloaded.`);
      return { blob, fileName };
    }

    buildShareText(link) {
      const lines = [
        this.state.title,
        this.state.subtitle,
        '',
        ...this.state.cards.filter((card) => card.imageSrc || card.heading || card.subheading || card.note).flatMap((card, index) => {
          const row = [`${index + 1}. ${card.heading || `Photo ${index + 1}`}`];
          if (card.subheading) row.push(card.subheading);
          if (card.note) row.push(`Note: ${card.note}`);
          return row.concat(['']);
        }),
        `Footer: ${this.state.footer}`,
        `Footer Note: ${this.state.footerNote}`
      ];
      if (link) lines.push('', `Flyer Link: ${link}`);
      return lines.join('\n').trim();
    }

    async sendInAppMessage(options) {
      const opts = Object.assign({ threadId: '', recipients: [], table: 'v2_chat_messages', uploadFlyerBlob: this.uploadFlyerBlob, insertMessage: null, supabaseFetchFn: this.supabaseFetchFn }, options || {});
      await this.render();
      const blob = await canvasToBlob(this.ui.canvas, 'image/png', 1);
      const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}.png`;
      let flyerUrl = '';
      if (typeof opts.uploadFlyerBlob === 'function') flyerUrl = await opts.uploadFlyerBlob(blob, fileName, this.state);
      const messageText = this.buildShareText(flyerUrl);
      if (typeof opts.insertMessage === 'function') {
        const result = await opts.insertMessage({ threadId: opts.threadId, recipients: opts.recipients, messageText, attachmentUrl: flyerUrl, fileName, flyerState: this.state, sentBy: this.currentUser });
        this.setShareStatus('Flyer sent through in-app messaging.');
        return result;
      }
      if (typeof opts.supabaseFetchFn === 'function') {
        const result = await opts.supabaseFetchFn(opts.table, 'POST', { thread_id: opts.threadId || null, recipient_usernames: Array.isArray(opts.recipients) ? opts.recipients : [], message_type: 'flyer', message_text: messageText, attachment_url: flyerUrl || null, attachment_name: fileName, created_by: this.currentUser, flyer_title: this.state.title, flyer_theme: JSON.stringify(this.state.theme) });
        this.setShareStatus('Flyer sent through in-app messaging.');
        return result;
      }
      this.setShareStatus('No in-app messaging hook was configured.');
      return { messageText, flyerUrl, fileName, flyerState: this.state };
    }

    async openOutlookDraft(options) {
      const opts = Object.assign({ to: '', cc: '', subject: this.state.title, uploadFlyerBlob: this.uploadFlyerBlob }, options || {});
      await this.render();
      const blob = await canvasToBlob(this.ui.canvas, 'image/png', 1);
      const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}.png`;
      let flyerUrl = '';
      if (typeof opts.uploadFlyerBlob === 'function') flyerUrl = await opts.uploadFlyerBlob(blob, fileName, this.state);
      const body = this.buildShareText(flyerUrl);
      const url = `https://outlook.office.com/mail/deeplink/compose?${new URLSearchParams({ to: opts.to || '', cc: opts.cc || '', subject: opts.subject || this.state.title, body }).toString()}`;
      global.open(url, '_blank', 'noopener');
      this.setShareStatus('Outlook draft opened.');
      return { url, body, flyerUrl, fileName };
    }
  }

  global.NativePwaFlyer = { Builder, NativeCamera, THEMES };
})(window);













