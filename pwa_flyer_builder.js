(function (global) {
  'use strict';

  const THEMES = {
    sage: { background: '#f4f3ee', panel: '#ffffff', accent: '#0f7a4f', title: '#13233a', body: '#475569' },
    warm: { background: '#fff6ec', panel: '#fffdf8', accent: '#c7671f', title: '#44210b', body: '#6b4b35' },
    bloom: { background: '#fff5f9', panel: '#ffffff', accent: '#c53b72', title: '#3f1830', body: '#6f3856' },
    slate: { background: '#f6f8fc', panel: '#ffffff', accent: '#265fd6', title: '#10203a', body: '#45556c' },
    meadow: { background: '#eef7f2', panel: '#ffffff', accent: '#1a8f62', title: '#163527', body: '#466255' },
    sunset: { background: '#fff4ef', panel: '#fffdfa', accent: '#dc5b3f', title: '#4e1d17', body: '#7a544e' }
  };

  const PAGE_WIDTH = 1275;
  const PAGE_HEIGHT = 1650;
  const EXPORT_SCALE = 2;
  const BUILDER_STATE_STORAGE_KEY = 'gnc_native_flyer_builder_state_v2';

  const DENSITY_ROWS = {
    airy: { 1: 4, 2: 4, 3: 3 },
    standard: { 1: 5, 2: 5, 3: 4 },
    compact: { 1: 6, 2: 6, 3: 5 }
  };

  const BUILDER_CSS = `
    .npf-wrap{display:grid;gap:18px}
    .npf-grid{display:grid;gap:18px;grid-template-columns:minmax(340px,460px) minmax(360px,1fr);align-items:start}
    .npf-card{background:#fff;border:1px solid #d9e4dc;border-radius:26px;box-shadow:0 18px 40px rgba(15,23,42,.08);overflow:hidden}
    .npf-section{padding:18px}
    .npf-stack{display:grid;gap:12px}
    .npf-label{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#475569}
    .npf-input,.npf-textarea{width:100%;border:1px solid #d6e3db;border-radius:16px;padding:12px 14px;font:700 14px/1.4 Arial,sans-serif;color:#0f172a;background:#fff}
    .npf-textarea{min-height:76px;resize:vertical}
    .npf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:10px 16px;border-radius:999px;border:1px solid transparent;font:900 11px/1 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:.18s ease}
    .npf-primary{background:#0f7a4f;color:#fff}
    .npf-secondary{background:#eef6f1;color:#0f7a4f;border-color:#cfe4d6}
    .npf-muted{background:#f8fafc;color:#475569;border-color:#d8e0ea}
    .npf-btn.active{box-shadow:inset 0 0 0 2px rgba(15,122,79,.16)}
    .npf-theme-grid,.npf-segmented,.npf-actions{display:flex;flex-wrap:wrap;gap:8px}
    .npf-theme-chip{min-width:96px;justify-content:flex-start}
    .npf-theme-chip .swatch{width:16px;height:16px;border-radius:999px;border:2px solid rgba(255,255,255,.72);box-shadow:0 0 0 1px rgba(15,23,42,.12)}
    .npf-control-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .npf-color-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .npf-color-chip{display:grid;gap:6px;padding:10px 12px;border:1px solid #dbe5dd;border-radius:18px;background:#f8fbf9}
    .npf-color-chip span{font:900 10px/1 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#64748b}
    .npf-color-chip input{width:100%;height:42px;border:none;background:transparent;padding:0;cursor:pointer}
    .npf-helper{font:700 12px/1.45 Arial,sans-serif;color:#64748b}
    .npf-row-toolbar{display:grid;gap:10px}
    .npf-row-filter{position:relative}
    .npf-row-filter input{padding-right:44px}
    .npf-row-filter .count{position:absolute;right:14px;top:50%;transform:translateY(-50%);font:900 11px/1 Arial,sans-serif;color:#94a3b8}
    .npf-slots{display:grid;gap:12px;max-height:1180px;overflow:auto;padding-right:4px}
    .npf-slot{border:1px solid #dbe7df;border-radius:22px;padding:14px;background:#f8fbf9}
    .npf-slot.off{opacity:.62}
    .npf-slot-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}
    .npf-slot-meta{display:grid;gap:4px}
    .npf-slot-badge{font:900 10px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#0f7a4f}
    .npf-slot-title{font:900 16px/1.15 Arial,sans-serif;color:#0f172a}
    .npf-thumb{width:100%;aspect-ratio:16/10;border-radius:18px;background:#dfe9e2 center/cover no-repeat;border:1px dashed #bfd2c4;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;color:#64748b;font:800 12px/1.4 Arial,sans-serif}
    .npf-thumb-caption{margin-top:8px;font:800 11px/1.4 Arial,sans-serif;color:#475569}
    .npf-photo-picker{display:grid;gap:8px;margin-top:12px}
    .npf-photo-rail{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none}
    .npf-photo-rail::-webkit-scrollbar{display:none}
    .npf-photo-option{min-width:104px;width:104px;border:1px solid #d6e3db;background:#fff;border-radius:18px;padding:6px;display:grid;gap:6px;cursor:pointer;box-shadow:0 8px 18px rgba(15,23,42,.05)}
    .npf-photo-option.active{border-color:#0f7a4f;box-shadow:0 0 0 2px rgba(15,122,79,.14),0 8px 18px rgba(15,23,42,.08)}
    .npf-photo-mini{width:100%;aspect-ratio:1/1;border-radius:12px;background:#dfe9e2 center/cover no-repeat}
    .npf-photo-caption{font:800 10px/1.3 Arial,sans-serif;color:#334155;text-align:left;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .npf-photo-empty{font:800 11px/1.4 Arial,sans-serif;color:#94a3b8;padding:6px 0 2px}
    .npf-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
    .npf-editor-grid .wide{grid-column:1/-1}
    .npf-preview-shell{padding:20px;background:linear-gradient(180deg,#f8fafc 0%,#edf3f7 100%);border-radius:24px}
    .npf-canvas{width:100%;height:auto;display:block;border-radius:24px;box-shadow:0 28px 48px rgba(15,23,42,.18);background:#fff}
    .npf-pagebar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
    .npf-pagebar .status{font:900 11px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#64748b}
    .npf-export-note{font:700 12px/1.45 Arial,sans-serif;color:#64748b}
    @media (max-width:1120px){.npf-grid{grid-template-columns:1fr}.npf-slots{max-height:none}}
    @media (max-width:640px){.npf-control-grid,.npf-color-grid,.npf-editor-grid{grid-template-columns:1fr}}
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

  function fitTextSize(ctx, text, maxWidth, startSize, minSize, weight) {
    const value = String(text || '').trim();
    let size = startSize;
    while (size > minSize) {
      ctx.font = `${weight || 900} ${size}px Arial`;
      if (ctx.measureText(value).width <= maxWidth) return size;
      size -= 2;
    }
    return minSize;
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

  class Builder {
    constructor(root, options) {
      const opts = Object.assign({
        theme: 'sage',
        title: 'Annual Crop Update',
        subtitle: 'Build flyers from your phone',
        footer: 'Greenleaf Nursery Company',
        footerNote: 'Call or message for availability.',
        slots: 1,
        uploadFlyerBlob: null,
        supabaseFetchFn: global.supabaseFetch || null,
        currentUser: (global.currentUserDisplay || global.currentUser || 'Unknown User')
      }, options || {});

      this.root = root;
      this.uploadFlyerBlob = opts.uploadFlyerBlob;
      this.supabaseFetchFn = opts.supabaseFetchFn;
      this.currentUser = opts.currentUser;
      this.state = {
        themeKey: opts.theme,
        theme: Object.assign({}, THEMES[opts.theme] || THEMES.sage),
        title: opts.title,
        subtitle: opts.subtitle,
        footer: opts.footer,
        footerNote: opts.footerNote,
        columns: 2,
        density: 'standard',
        photoFit: 'cover',
        cardStyle: 'soft',
        rowFilter: '',
        pageIndex: 0,
        cards: Array.from({ length: Math.max(1, opts.slots) }).map((_, index) => this.createDefaultCard(index))
      };
      this.ui = {};
      this.storageKey = BUILDER_STATE_STORAGE_KEY;
    }

    createDefaultCard(index) {
      return {
        heading: `Photo ${Number(index || 0) + 1}`,
        subheading: '',
        note: '',
        imageSrc: '',
        imageName: '',
        photoOptions: [],
        selectedPhotoIndex: -1,
        enabled: true
      };
    }

    normalizeCard(card, index) {
      const base = Object.assign({}, this.createDefaultCard(index), card || {});
      let photoOptions = mergePhotoOptions(base.photoOptions || []);
      const imageSrc = String(base.imageSrc || '').trim();
      const imageName = String(base.imageName || '').trim() || `Photo ${Number(index || 0) + 1}`;
      if (imageSrc) {
        photoOptions = mergePhotoOptions(photoOptions, [{
          src: imageSrc,
          name: imageName,
          displayName: imageName,
          source: 'selected'
        }]);
      }
      base.photoOptions = photoOptions;
      let selectedPhotoIndex = Number.isFinite(Number(base.selectedPhotoIndex)) ? Number(base.selectedPhotoIndex) : -1;
      if (imageSrc) {
        const matchedIndex = photoOptions.findIndex((option) => String(option.src || '').trim() === imageSrc);
        if (matchedIndex >= 0) selectedPhotoIndex = matchedIndex;
      }
      if (selectedPhotoIndex < 0 && photoOptions.length) selectedPhotoIndex = 0;
      if (selectedPhotoIndex >= photoOptions.length) selectedPhotoIndex = photoOptions.length ? 0 : -1;
      if (selectedPhotoIndex >= 0 && photoOptions[selectedPhotoIndex]) {
        base.selectedPhotoIndex = selectedPhotoIndex;
        base.imageSrc = photoOptions[selectedPhotoIndex].src;
        base.imageName = photoOptions[selectedPhotoIndex].name;
      } else {
        base.selectedPhotoIndex = -1;
        base.imageSrc = imageSrc;
        base.imageName = imageSrc ? imageName : '';
      }
      base.enabled = base.enabled !== false;
      return base;
    }

    normalizeCards() {
      const incoming = Array.isArray(this.state.cards) ? this.state.cards : [];
      this.state.cards = incoming.length ? incoming.map((card, index) => this.normalizeCard(card, index)) : [this.createDefaultCard(0)];
      this.clampPageIndex();
    }

    mount() {
      if (!this.root) throw new Error('Builder root element is required.');
      injectCss();
      this.restorePersistedState();
      this.normalizeCards();
      this.root.innerHTML = `
        <div class="npf-wrap">
          <div class="npf-grid">
            <div class="npf-stack">
              <div class="npf-card">
                <div class="npf-section npf-stack">
                  <div>
                    <div class="npf-label">Flyer Builder</div>
                    <div style="margin-top:6px;font:900 28px/1.08 Arial,sans-serif;color:#0f172a">Build The Flyer In-App</div>
                    <div class="npf-helper" style="margin-top:6px">Pick the row photo you want, tune the layout and colors, then export clean full-page flyer pages.</div>
                  </div>
                  <label class="npf-label">Headline<input class="npf-input" data-field="title"></label>
                  <label class="npf-label">Subheadline<textarea class="npf-textarea" data-field="subtitle"></textarea></label>
                  <div class="npf-control-grid">
                    <label class="npf-label">Footer<input class="npf-input" data-field="footer"></label>
                    <label class="npf-label">Footer Note<input class="npf-input" data-field="footerNote"></label>
                  </div>
                  <div>
                    <div class="npf-label">Theme Presets</div>
                    <div class="npf-theme-grid" data-themes></div>
                  </div>
                  <div>
                    <div class="npf-label">Color Controls</div>
                    <div class="npf-color-grid">
                      <label class="npf-color-chip"><span>Background</span><input type="color" data-color="background"></label>
                      <label class="npf-color-chip"><span>Card</span><input type="color" data-color="panel"></label>
                      <label class="npf-color-chip"><span>Accent</span><input type="color" data-color="accent"></label>
                      <label class="npf-color-chip"><span>Title</span><input type="color" data-color="title"></label>
                      <label class="npf-color-chip"><span>Body</span><input type="color" data-color="body"></label>
                    </div>
                  </div>
                  <div class="npf-control-grid">
                    <div>
                      <div class="npf-label">Columns</div>
                      <div class="npf-segmented" data-columns></div>
                    </div>
                    <div>
                      <div class="npf-label">Density</div>
                      <div class="npf-segmented" data-density></div>
                    </div>
                    <div>
                      <div class="npf-label">Photo Crop</div>
                      <div class="npf-segmented" data-fit></div>
                    </div>
                    <div>
                      <div class="npf-label">Card Style</div>
                      <div class="npf-segmented" data-card-style></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="npf-card">
                <div class="npf-section npf-stack">
                  <div class="npf-row-toolbar">
                    <div>
                      <div class="npf-label">Flyer Rows</div>
                      <div class="npf-helper" style="margin-top:6px">Each row keeps its saved photo stack. Tap the exact picture you want to use on the flyer.</div>
                    </div>
                    <label class="npf-row-filter">
                      <input class="npf-input" data-field="rowFilter" placeholder="Search rows in this flyer...">
                      <span class="count" data-row-count></span>
                    </label>
                  </div>
                  <div class="npf-slots" data-slots></div>
                </div>
              </div>
            </div>
            <div class="npf-stack">
              <div class="npf-card">
                <div class="npf-section">
                  <div class="npf-pagebar">
                    <div>
                      <div class="npf-label">Preview</div>
                      <div class="npf-helper" style="margin-top:6px">Preview the exact export page. Large folders automatically split into multiple pages.</div>
                    </div>
                    <div class="npf-actions">
                      <button type="button" class="npf-btn npf-muted" data-page-nav="prev">Previous</button>
                      <div class="status" data-page-status></div>
                      <button type="button" class="npf-btn npf-muted" data-page-nav="next">Next</button>
                    </div>
                  </div>
                  <div class="npf-preview-shell">
                    <canvas class="npf-canvas"></canvas>
                  </div>
                </div>
              </div>
              <div class="npf-card">
                <div class="npf-section npf-stack">
                  <div>
                    <div class="npf-label">Export And Share</div>
                    <div class="npf-export-note" style="margin-top:6px">Export the current page, export every flyer page, send by message, or open an email draft with the flyer links.</div>
                  </div>
                  <div class="npf-actions">
                    <button type="button" class="npf-btn npf-primary" data-action="png">Export Page</button>
                    <button type="button" class="npf-btn npf-secondary" data-action="all">Export All Pages</button>
                    <button type="button" class="npf-btn npf-secondary" data-action="message">In-App Message</button>
                    <button type="button" class="npf-btn npf-secondary" data-action="outlook">Email Draft</button>
                  </div>
                  <div class="npf-label" data-share-status style="color:#64748b">Ready to export.</div>
                </div>
              </div>
            </div>
          </div>
        </div>`;

      this.ui.canvas = this.root.querySelector('.npf-canvas');
      this.ui.themeWrap = this.root.querySelector('[data-themes]');
      this.ui.slotWrap = this.root.querySelector('[data-slots]');
      this.ui.shareStatus = this.root.querySelector('[data-share-status]');
      this.ui.pageStatus = this.root.querySelector('[data-page-status]');
      this.ui.rowCount = this.root.querySelector('[data-row-count]');
      this.ui.fields = Array.from(this.root.querySelectorAll('[data-field]'));
      this.ui.fields.forEach((field) => field.addEventListener('input', () => {
        this.state[field.dataset.field] = field.value;
        this.clampPageIndex();
        this.persistState();
        this.renderUi();
        this.render().catch(() => {});
      }));
      Array.from(this.root.querySelectorAll('[data-action]')).forEach((button) => button.addEventListener('click', () => this.handleAction(button.dataset.action)));
      Array.from(this.root.querySelectorAll('[data-page-nav]')).forEach((button) => button.addEventListener('click', () => {
        this.state.pageIndex += button.dataset.pageNav === 'next' ? 1 : -1;
        this.clampPageIndex();
        this.persistState();
        this.renderUi();
        this.render().catch(() => {});
      }));
      this.renderUi();
      this.render();
      return this;
    }

    renderUi() {
      this.normalizeCards();
      this.ui.fields.forEach((field) => { field.value = this.state[field.dataset.field] || ''; });

      this.ui.themeWrap.innerHTML = Object.keys(THEMES).map((key) => {
        const theme = THEMES[key];
        return `<button type="button" class="npf-btn npf-secondary npf-theme-chip ${this.state.themeKey === key ? 'active' : ''}" data-theme="${key}" style="background:${theme.background};color:${theme.title};border-color:${theme.accent}"><span class="swatch" style="background:${theme.accent}"></span>${this.escape(key)}</button>`;
      }).join('');
      Array.from(this.ui.themeWrap.querySelectorAll('[data-theme]')).forEach((button) => button.addEventListener('click', () => {
        const nextKey = button.dataset.theme;
        this.state.themeKey = nextKey;
        this.state.theme = Object.assign({}, THEMES[nextKey] || THEMES.sage);
        this.persistState();
        this.renderUi();
        this.render().catch(() => {});
      }));

      const buildSegmented = (target, values, current, attr) => {
        target.innerHTML = values.map((entry) => `<button type="button" class="npf-btn ${String(entry.value) === String(current) ? 'npf-primary active' : 'npf-muted'}" data-${attr}="${this.escape(entry.value)}">${this.escape(entry.label)}</button>`).join('');
      };

      buildSegmented(this.root.querySelector('[data-columns]'), [{ value: 1, label: '1 Col' }, { value: 2, label: '2 Col' }, { value: 3, label: '3 Col' }], this.state.columns, 'columns');
      buildSegmented(this.root.querySelector('[data-density]'), [{ value: 'airy', label: 'Airy' }, { value: 'standard', label: 'Standard' }, { value: 'compact', label: 'Compact' }], this.state.density, 'density');
      buildSegmented(this.root.querySelector('[data-fit]'), [{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }], this.state.photoFit, 'fit');
      buildSegmented(this.root.querySelector('[data-card-style]'), [{ value: 'soft', label: 'Soft' }, { value: 'outline', label: 'Outline' }, { value: 'flat', label: 'Flat' }], this.state.cardStyle, 'cardStyle');

      Array.from(this.root.querySelectorAll('[data-columns] button[data-columns]')).forEach((button) => button.addEventListener('click', () => {
        this.state.columns = Math.max(1, Math.min(3, Number(button.dataset.columns || 2)));
        this.clampPageIndex();
        this.persistState();
        this.renderUi();
        this.render().catch(() => {});
      }));
      Array.from(this.root.querySelectorAll('[data-density] button[data-density]')).forEach((button) => button.addEventListener('click', () => {
        this.state.density = String(button.dataset.density || 'standard');
        this.clampPageIndex();
        this.persistState();
        this.renderUi();
        this.render().catch(() => {});
      }));
      Array.from(this.root.querySelectorAll('[data-fit] button[data-fit]')).forEach((button) => button.addEventListener('click', () => {
        this.state.photoFit = String(button.dataset.fit || 'cover');
        this.persistState();
        this.renderUi();
        this.render().catch(() => {});
      }));
      Array.from(this.root.querySelectorAll('[data-card-style] button[data-card-style]')).forEach((button) => button.addEventListener('click', () => {
        this.state.cardStyle = String(button.dataset.cardStyle || 'soft');
        this.persistState();
        this.renderUi();
        this.render().catch(() => {});
      }));
      Array.from(this.root.querySelectorAll('[data-color]')).forEach((input) => {
        input.value = this.state.theme[input.dataset.color] || '#ffffff';
        input.oninput = () => {
          this.state.theme[input.dataset.color] = input.value;
          this.persistState();
          this.render().catch(() => {});
        };
      });

      const filteredCards = this.getFilteredEditorCards();
      const activeCards = this.getIncludedCards();
      const pageCount = this.getPageCount();
      if (this.ui.rowCount) this.ui.rowCount.textContent = `${activeCards.length} on flyer`;
      if (this.ui.pageStatus) this.ui.pageStatus.textContent = `Page ${this.state.pageIndex + 1} of ${pageCount}`;

      this.ui.slotWrap.innerHTML = filteredCards.length ? filteredCards.map(({ card, index }) => {
        const thumbStyle = card.imageSrc ? `background-image:url('${String(card.imageSrc || '').replace(/'/g, '%27')}');color:transparent;` : '';
        const photoRail = card.photoOptions.length
          ? `<div class="npf-photo-picker"><div class="npf-label" style="color:#0f7a4f">Row Photos</div><div class="npf-photo-rail">${card.photoOptions.map((option, optionIndex) => `<button type="button" class="npf-photo-option ${card.selectedPhotoIndex === optionIndex ? 'active' : ''}" data-photo-option="${index}:${optionIndex}" title="${this.escape(option.displayName || option.name || `Photo ${optionIndex + 1}`)}"><div class="npf-photo-mini" style="background-image:url('${String(option.src || '').replace(/'/g, '%27')}')"></div><div class="npf-photo-caption">${this.escape(option.displayName || option.name || `Photo ${optionIndex + 1}`)}</div></button>`).join('')}</div></div>`
          : `<div class="npf-photo-empty">No saved row photos yet for this flyer item.</div>`;
        return `
          <div class="npf-slot ${card.enabled ? '' : 'off'}">
            <div class="npf-slot-head">
              <div class="npf-slot-meta">
                <div class="npf-slot-badge">Row ${index + 1}</div>
                <div class="npf-slot-title">${this.escape(card.heading || `Photo ${index + 1}`)}</div>
                <div class="npf-helper">${card.photoOptions.length} saved photo${card.photoOptions.length === 1 ? '' : 's'}</div>
              </div>
              <button type="button" class="npf-btn ${card.enabled ? 'npf-primary' : 'npf-muted'}" data-toggle-card="${index}">${card.enabled ? 'Included' : 'Hidden'}</button>
            </div>
            <div class="npf-thumb" style="${thumbStyle}">${card.imageSrc ? this.escape(card.imageName || `Photo ${index + 1}`) : 'Choose a saved row photo below'}</div>
            <div class="npf-thumb-caption">${this.escape(card.imageName || 'Tap the row photo you want to use on the flyer.')}</div>
            ${photoRail}
            <div class="npf-editor-grid">
              <label class="npf-label wide">Text Below Photo<input class="npf-input" data-card="heading" data-index="${index}" value="${this.escape(card.heading)}"></label>
              <label class="npf-label">Subtext<textarea class="npf-textarea" data-card="subheading" data-index="${index}">${this.escape(card.subheading)}</textarea></label>
              <label class="npf-label">Note<textarea class="npf-textarea" data-card="note" data-index="${index}">${this.escape(card.note)}</textarea></label>
            </div>
          </div>`;
      }).join('') : `<div class="npf-photo-empty">No rows match that search.</div>`;

      Array.from(this.ui.slotWrap.querySelectorAll('[data-photo-option]')).forEach((button) => button.addEventListener('click', () => {
        const parts = String(button.dataset.photoOption || '').split(':');
        this.selectPhotoOption(Number(parts[0] || 0), Number(parts[1] || 0));
      }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-toggle-card]')).forEach((button) => button.addEventListener('click', () => {
        this.toggleCardEnabled(Number(button.dataset.toggleCard || 0));
      }));
      Array.from(this.ui.slotWrap.querySelectorAll('[data-card]')).forEach((field) => field.addEventListener('input', () => {
        const index = Number(field.dataset.index || 0);
        this.state.cards[index][field.dataset.card] = field.value;
        this.persistState();
        this.render().catch(() => {});
      }));

      Array.from(this.root.querySelectorAll('[data-page-nav]')).forEach((button) => {
        button.disabled = (button.dataset.pageNav === 'prev' && this.state.pageIndex <= 0) || (button.dataset.pageNav === 'next' && this.state.pageIndex >= pageCount - 1);
        button.style.opacity = button.disabled ? '0.45' : '1';
      });
    }

    escape(value) {
      return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    getFilteredEditorCards() {
      const filter = String(this.state.rowFilter || '').trim().toLowerCase();
      return this.state.cards.map((card, index) => ({ card, index })).filter(({ card }) => {
        if (!filter) return true;
        return [
          card.heading,
          card.subheading,
          card.note,
          card.imageName,
          ...(Array.isArray(card.photoOptions) ? card.photoOptions.map((option) => option.displayName || option.name || '') : [])
        ].join(' ').toLowerCase().indexOf(filter) !== -1;
      });
    }

    getIncludedCards() {
      return this.state.cards.filter((card) => card.enabled !== false && (card.imageSrc || card.heading || card.subheading || card.note || (card.photoOptions && card.photoOptions.length)));
    }

    getRowsPerPage() {
      const density = DENSITY_ROWS[this.state.density] || DENSITY_ROWS.standard;
      return density[this.state.columns] || density[2] || 5;
    }

    getCardsPerPage() {
      return Math.max(1, this.state.columns * this.getRowsPerPage());
    }

    getPageCount() {
      const included = this.getIncludedCards();
      return Math.max(1, Math.ceil(Math.max(included.length, 1) / this.getCardsPerPage()));
    }

    getPageCards(pageIndex) {
      const included = this.getIncludedCards();
      const cards = included.length ? included : [this.createDefaultCard(0)];
      const start = Math.max(0, Number(pageIndex || 0)) * this.getCardsPerPage();
      return cards.slice(start, start + this.getCardsPerPage());
    }

    clampPageIndex() {
      const maxPage = this.getPageCount() - 1;
      if (!Number.isFinite(Number(this.state.pageIndex))) this.state.pageIndex = 0;
      this.state.pageIndex = Math.max(0, Math.min(maxPage, Number(this.state.pageIndex || 0)));
    }

    persistState() {
      this.normalizeCards();
      try {
        sessionStorage.setItem(this.storageKey, JSON.stringify({ state: this.state }));
      } catch (error) {}
    }

    restorePersistedState() {
      try {
        const raw = sessionStorage.getItem(this.storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.state && typeof parsed.state === 'object') this.state = Object.assign({}, this.state, parsed.state);
      } catch (error) {}
    }

    selectPhotoOption(slotIndex, optionIndex) {
      const index = Math.max(0, Math.min(this.state.cards.length - 1, Number(slotIndex || 0)));
      const card = this.state.cards[index] = this.normalizeCard(this.state.cards[index], index);
      const option = card.photoOptions[Number(optionIndex || 0)];
      if (!option) return;
      card.selectedPhotoIndex = Number(optionIndex || 0);
      card.imageSrc = option.src;
      card.imageName = option.name;
      card.enabled = true;
      this.persistState();
      this.renderUi();
      this.render().catch(() => {});
    }

    toggleCardEnabled(index) {
      const cardIndex = Math.max(0, Math.min(this.state.cards.length - 1, Number(index || 0)));
      const card = this.state.cards[cardIndex] = this.normalizeCard(this.state.cards[cardIndex], cardIndex);
      card.enabled = card.enabled === false;
      this.clampPageIndex();
      this.persistState();
      this.renderUi();
      this.render().catch(() => {});
    }

    async drawCard(ctx, card, x, y, cardWidth, cardHeight, scale) {
      const theme = this.state.theme;
      if (this.state.cardStyle === 'soft') {
        ctx.save();
        ctx.shadowColor = 'rgba(15,23,42,.12)';
        ctx.shadowBlur = 26 * scale;
        ctx.shadowOffsetY = 10 * scale;
        roundRect(ctx, x, y, cardWidth, cardHeight, 30 * scale);
        ctx.fillStyle = theme.panel;
        ctx.fill();
        ctx.restore();
      } else {
        roundRect(ctx, x, y, cardWidth, cardHeight, 30 * scale);
        ctx.fillStyle = theme.panel;
        ctx.fill();
      }

      if (this.state.cardStyle === 'outline') {
        roundRect(ctx, x, y, cardWidth, cardHeight, 30 * scale);
        ctx.lineWidth = 2 * scale;
        ctx.strokeStyle = `${theme.accent}55`;
        ctx.stroke();
      }

      if (this.state.cardStyle === 'flat') {
        ctx.fillStyle = theme.accent;
        ctx.fillRect(x, y, cardWidth, 14 * scale);
      }

      const inner = 24 * scale;
      const imageX = x + inner;
      const imageY = y + inner;
      const imageWidth = cardWidth - (inner * 2);
      const imageHeight = Math.max(180 * scale, Math.min(cardHeight * 0.56, cardHeight - (170 * scale)));

      roundRect(ctx, imageX, imageY, imageWidth, imageHeight, 22 * scale);
      ctx.save();
      ctx.clip();
      if (card.imageSrc) {
        try {
          const image = await loadImage(card.imageSrc);
          const scaleValue = this.state.photoFit === 'contain'
            ? Math.min(imageWidth / image.width, imageHeight / image.height)
            : Math.max(imageWidth / image.width, imageHeight / image.height);
          const drawWidth = image.width * scaleValue;
          const drawHeight = image.height * scaleValue;
          ctx.fillStyle = '#edf4ef';
          ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
          ctx.drawImage(image, imageX + ((imageWidth - drawWidth) / 2), imageY + ((imageHeight - drawHeight) / 2), drawWidth, drawHeight);
        } catch (error) {
          ctx.fillStyle = '#e5ece7';
          ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
        }
      } else {
        ctx.fillStyle = '#e8efea';
        ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
        ctx.fillStyle = theme.body;
        ctx.font = `900 ${24 * scale}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('Photo Needed', imageX + (imageWidth / 2), imageY + (imageHeight / 2));
        ctx.textAlign = 'left';
      }
      ctx.restore();

      let textY = imageY + imageHeight + (32 * scale);
      const titleFont = Math.max(22 * scale, Math.min(34 * scale, cardWidth / 10.5));
      ctx.fillStyle = theme.title;
      ctx.font = `900 ${titleFont}px Arial`;
      wrapText(ctx, card.heading || 'Flyer Item', cardWidth - (inner * 2), 3).forEach((line) => {
        ctx.fillText(line, x + inner, textY);
        textY += titleFont + (6 * scale);
      });

      if (card.subheading) {
        ctx.fillStyle = theme.body;
        ctx.font = `700 ${19 * scale}px Arial`;
        wrapText(ctx, card.subheading, cardWidth - (inner * 2), 3).forEach((line) => {
          ctx.fillText(line, x + inner, textY);
          textY += 24 * scale;
        });
      }

      if (card.note) {
        textY += 8 * scale;
        ctx.fillStyle = theme.accent;
        ctx.font = `900 ${15 * scale}px Arial`;
        wrapText(ctx, card.note, cardWidth - (inner * 2), 4).forEach((line) => {
          ctx.fillText(line, x + inner, textY);
          textY += 20 * scale;
        });
      }
    }

    async renderPageToCanvas(canvas, pageIndex, scale) {
      const exportScale = Math.max(1, Number(scale || 1));
      const width = PAGE_WIDTH * exportScale;
      const height = PAGE_HEIGHT * exportScale;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const theme = this.state.theme;
      const padding = 70 * exportScale;
      const gap = (this.state.density === 'airy' ? 30 : (this.state.density === 'compact' ? 18 : 24)) * exportScale;
      const headerHeight = (this.state.subtitle ? 250 : 210) * exportScale;
      const footerHeight = (this.state.footer || this.state.footerNote) ? 150 * exportScale : 0;
      const usableWidth = width - (padding * 2);
      const cards = this.getPageCards(pageIndex);
      const columns = Math.max(1, Math.min(3, Number(this.state.columns || 2)));
      const rowCount = Math.max(1, Math.ceil(cards.length / columns));
      const cardWidth = (usableWidth - (gap * (columns - 1))) / columns;
      const pageBodyTop = padding + headerHeight + gap;
      const pageBodyBottom = height - padding - footerHeight;
      const bodyHeight = pageBodyBottom - pageBodyTop;
      const cardHeight = rowCount > 0 ? Math.floor((bodyHeight - (gap * (rowCount - 1))) / rowCount) : bodyHeight;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = theme.background;
      ctx.fillRect(0, 0, width, height);

      roundRect(ctx, padding, padding, usableWidth, headerHeight, 34 * exportScale);
      ctx.fillStyle = theme.panel;
      ctx.fill();
      ctx.fillStyle = theme.accent;
      ctx.fillRect(padding + (30 * exportScale), padding + (28 * exportScale), 180 * exportScale, 12 * exportScale);

      const title = this.state.title || 'Flyer';
      const titleMaxWidth = usableWidth - (60 * exportScale) - (180 * exportScale);
      const titleSize = fitTextSize(ctx, title, titleMaxWidth, 64 * exportScale, 38 * exportScale, 900);
      ctx.fillStyle = theme.title;
      ctx.font = `900 ${titleSize}px Arial`;
      ctx.fillText(title, padding + (30 * exportScale), padding + (105 * exportScale));

      ctx.fillStyle = theme.body;
      ctx.font = `700 ${28 * exportScale}px Arial`;
      wrapText(ctx, this.state.subtitle || '', usableWidth - (60 * exportScale), 3).forEach((line, index) => {
        ctx.fillText(line, padding + (30 * exportScale), padding + (156 * exportScale) + (index * (36 * exportScale)));
      });

      ctx.fillStyle = theme.body;
      ctx.font = `900 ${18 * exportScale}px Arial`;
      const pageLabel = `PAGE ${Number(pageIndex || 0) + 1} OF ${this.getPageCount()}`;
      const labelWidth = ctx.measureText(pageLabel).width;
      ctx.fillText(pageLabel, padding + usableWidth - labelWidth - (28 * exportScale), padding + (52 * exportScale));

      for (let i = 0; i < cards.length; i += 1) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = padding + (col * (cardWidth + gap));
        const y = pageBodyTop + (row * (cardHeight + gap));
        await this.drawCard(ctx, cards[i], x, y, cardWidth, cardHeight, exportScale);
      }

      if (footerHeight) {
        const footerY = height - padding - footerHeight;
        roundRect(ctx, padding, footerY, usableWidth, footerHeight, 28 * exportScale);
        ctx.fillStyle = theme.panel;
        ctx.fill();
        ctx.fillStyle = theme.accent;
        ctx.fillRect(padding + (28 * exportScale), footerY + (22 * exportScale), 140 * exportScale, 10 * exportScale);
        ctx.fillStyle = theme.title;
        ctx.font = `900 ${30 * exportScale}px Arial`;
        ctx.fillText(this.state.footer || '', padding + (28 * exportScale), footerY + (72 * exportScale));
        ctx.fillStyle = theme.body;
        ctx.font = `700 ${20 * exportScale}px Arial`;
        wrapText(ctx, this.state.footerNote || '', usableWidth - (56 * exportScale), 2).forEach((line, index) => {
          ctx.fillText(line, padding + (28 * exportScale), footerY + (108 * exportScale) + (index * (24 * exportScale)));
        });
      }
    }

    async render() {
      this.clampPageIndex();
      await this.renderPageToCanvas(this.ui.canvas, this.state.pageIndex, 1);
      if (this.ui.pageStatus) this.ui.pageStatus.textContent = `Page ${this.state.pageIndex + 1} of ${this.getPageCount()}`;
    }

    async exportPageBlob(pageIndex, type, quality) {
      const canvas = document.createElement('canvas');
      await this.renderPageToCanvas(canvas, pageIndex, EXPORT_SCALE);
      return await canvasToBlob(canvas, type || 'image/png', quality || 1);
    }

    async exportAsBlob(type, quality) {
      return await this.exportPageBlob(this.state.pageIndex, type || 'image/png', quality || 1);
    }

    async exportAllPageBlobs(type, quality) {
      const pages = [];
      for (let pageIndex = 0; pageIndex < this.getPageCount(); pageIndex += 1) {
        const blob = await this.exportPageBlob(pageIndex, type || 'image/png', quality || 1);
        pages.push({
          pageIndex,
          blob,
          fileName: `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}-page-${pageIndex + 1}.png`
        });
      }
      return pages;
    }

    async exportPng() {
      const blob = await this.exportAsBlob('image/png', 1);
      const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}-page-${this.state.pageIndex + 1}.png`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      this.setShareStatus(`${fileName} downloaded.`);
      return { blob, fileName };
    }

    async exportAllPng() {
      const pages = await this.exportAllPageBlobs('image/png', 1);
      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        const url = URL.createObjectURL(page.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = page.fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500 + (i * 250));
      }
      this.setShareStatus(`${pages.length} flyer page${pages.length === 1 ? '' : 's'} downloaded.`);
      return pages;
    }

    buildShareText(linkOrLinks) {
      const links = Array.isArray(linkOrLinks) ? linkOrLinks.filter(Boolean) : (linkOrLinks ? [linkOrLinks] : []);
      const included = this.getIncludedCards();
      const lines = [
        this.state.title,
        this.state.subtitle,
        '',
        `Rows Included: ${included.length}`,
        `Pages: ${this.getPageCount()}`
      ];
      if (this.state.footer) lines.push(`Footer: ${this.state.footer}`);
      if (this.state.footerNote) lines.push(`Footer Note: ${this.state.footerNote}`);
      if (links.length) {
        lines.push('');
        links.forEach((link, index) => lines.push(`Flyer Page ${index + 1}: ${link}`));
      }
      return lines.join('\n').trim();
    }

    setShareStatus(text) {
      if (this.ui.shareStatus) this.ui.shareStatus.textContent = text;
    }

    async sendInAppMessage(options) {
      const opts = Object.assign({ threadId: '', recipients: [], table: 'v2_chat_messages', uploadFlyerBlob: this.uploadFlyerBlob, insertMessage: null, supabaseFetchFn: this.supabaseFetchFn }, options || {});
      const exports = await this.exportAllPageBlobs('image/png', 1);
      const flyerUrls = [];
      if (typeof opts.uploadFlyerBlob === 'function') {
        for (let i = 0; i < exports.length; i += 1) {
          flyerUrls.push(await opts.uploadFlyerBlob(exports[i].blob, exports[i].fileName, this.state));
        }
      }
      const messageText = this.buildShareText(flyerUrls);
      if (typeof opts.insertMessage === 'function') {
        const result = await opts.insertMessage({
          threadId: opts.threadId,
          recipients: opts.recipients,
          messageText,
          attachmentUrl: flyerUrls[0] || '',
          fileName: exports[0] ? exports[0].fileName : '',
          flyerState: this.state,
          sentBy: this.currentUser
        });
        this.setShareStatus('Flyer sent through in-app messaging.');
        return result;
      }
      if (typeof opts.supabaseFetchFn === 'function') {
        const result = await opts.supabaseFetchFn(opts.table, 'POST', {
          thread_id: opts.threadId || null,
          recipient_usernames: Array.isArray(opts.recipients) ? opts.recipients : [],
          message_type: 'flyer',
          message_text: messageText,
          attachment_url: flyerUrls[0] || null,
          attachment_name: exports[0] ? exports[0].fileName : null,
          created_by: this.currentUser,
          flyer_title: this.state.title,
          flyer_theme: JSON.stringify(this.state.theme)
        });
        this.setShareStatus('Flyer sent through in-app messaging.');
        return result;
      }
      this.setShareStatus('No in-app messaging hook was configured.');
      return { messageText, flyerUrls, exports, flyerState: this.state };
    }

    async openOutlookDraft(options) {
      const opts = Object.assign({ to: '', cc: '', subject: this.state.title, uploadFlyerBlob: this.uploadFlyerBlob }, options || {});
      const exports = await this.exportAllPageBlobs('image/png', 1);
      const flyerUrls = [];
      if (typeof opts.uploadFlyerBlob === 'function') {
        for (let i = 0; i < exports.length; i += 1) {
          flyerUrls.push(await opts.uploadFlyerBlob(exports[i].blob, exports[i].fileName, this.state));
        }
      }
      const body = this.buildShareText(flyerUrls);
      const url = `https://outlook.office.com/mail/deeplink/compose?${new URLSearchParams({
        to: opts.to || '',
        cc: opts.cc || '',
        subject: opts.subject || this.state.title,
        body
      }).toString()}`;
      global.open(url, '_blank', 'noopener');
      this.setShareStatus('Outlook draft opened.');
      return { url, body, flyerUrls, exports };
    }

    async handleAction(action) {
      if (action === 'png') return await this.exportPng();
      if (action === 'all') return await this.exportAllPng();
      if (action === 'message') return await this.sendInAppMessage();
      if (action === 'outlook') return await this.openOutlookDraft();
    }
  }

  global.NativePwaFlyer = { Builder, THEMES };
})(window);
