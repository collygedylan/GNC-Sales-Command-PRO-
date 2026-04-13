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

  const STEP_LIST = [
    { key: 'layout', label: 'Step 1', title: 'Layout' },
    { key: 'cards', label: 'Step 2', title: 'Photos & Text' },
    { key: 'style', label: 'Step 3', title: 'Style & Pricing' },
    { key: 'share', label: 'Step 4', title: 'Preview & Share' }
  ];

  const LAYOUT_PRESETS = [
    { id: '1x1', label: '1', columns: 1, rows: 1 },
    { id: '1x2', label: '2', columns: 1, rows: 2 },
    { id: '2x2', label: '4', columns: 2, rows: 2 },
    { id: '2x3', label: '6', columns: 2, rows: 3 },
    { id: '2x4', label: '8', columns: 2, rows: 4 },
    { id: '3x3', label: '9', columns: 3, rows: 3 },
    { id: '3x4', label: '12', columns: 3, rows: 4 },
    { id: '3x5', label: '15', columns: 3, rows: 5 },
    { id: '3x6', label: '18', columns: 3, rows: 6 }
  ];

  const PREVIEW_ZOOMS = [60, 80, 100, 125, 150];
  const PAGE_WIDTH = 1275;
  const PAGE_HEIGHT = 1650;
  const EXPORT_SCALE = 2;
  const PDF_PAGE_WIDTH = 612;
  const PDF_PAGE_HEIGHT = 792;
  const BUILDER_STATE_STORAGE_KEY = 'gnc_native_flyer_builder_state_v5';
  const RENDER_DEBOUNCE_MS = 240;

  const BUILDER_CSS = `
    .npf-wrap{display:grid;gap:18px}
    .npf-grid{display:grid;gap:18px;grid-template-columns:minmax(320px,.78fr) minmax(0,1.22fr);align-items:start}
    .npf-card{background:#fff;border:1px solid #d9e4dc;border-radius:28px;box-shadow:0 18px 40px rgba(15,23,42,.08);overflow:hidden}
    .npf-section{padding:18px}
    .npf-stack{display:grid;gap:12px}
    .npf-preview-column{display:grid;gap:18px;min-width:0}
    .npf-preview-card{position:sticky;top:18px}
    .npf-builder-column{display:grid;gap:18px;grid-template-columns:1fr;align-items:start;min-width:0}
    .npf-builder-column>.npf-card:first-child{position:sticky;top:18px}.npf-builder-column>.npf-card{min-width:0}
    .npf-label{font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#475569}
    .npf-input,.npf-textarea,.npf-select{width:100%;border:1px solid #d6e3db;border-radius:16px;padding:12px 14px;font:700 14px/1.4 Arial,sans-serif;color:#0f172a;background:#fff}
    .npf-textarea{min-height:92px;resize:vertical}
    .npf-select{appearance:none}
    .npf-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:42px;padding:10px 16px;border-radius:999px;border:1px solid transparent;font:900 11px/1 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;transition:.18s ease;text-align:center}
    .npf-primary{background:#0f7a4f;color:#fff}
    .npf-secondary{background:#eef6f1;color:#0f7a4f;border-color:#cfe4d6}
    .npf-muted{background:#f8fafc;color:#475569;border-color:#d8e0ea}
    .npf-soft{background:#fff;color:#0f7a4f;border-color:#dbe6dd}
    .npf-btn.active{box-shadow:inset 0 0 0 2px rgba(15,122,79,.18)}
    .npf-actions,.npf-theme-grid,.npf-segmented,.npf-page-chips,.npf-step-nav,.npf-preview-tools{display:flex;flex-wrap:wrap;gap:8px}
    .npf-theme-chip{min-width:96px;justify-content:flex-start}
    .npf-theme-chip .swatch{width:16px;height:16px;border-radius:999px;border:2px solid rgba(255,255,255,.72);box-shadow:0 0 0 1px rgba(15,23,42,.12)}
    .npf-control-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    .npf-control-grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}
    .npf-color-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .npf-color-chip{display:grid;gap:6px;padding:10px 12px;border:1px solid #dbe5dd;border-radius:18px;background:#f8fbf9}
    .npf-color-chip span{font:900 10px/1 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#64748b}
    .npf-color-chip input{width:100%;height:42px;border:none;background:transparent;padding:0;cursor:pointer}
    .npf-helper{font:700 12px/1.5 Arial,sans-serif;color:#64748b}
    .npf-kicker{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .npf-kicker strong{font:900 26px/1.08 Arial,sans-serif;color:#0f172a}
    .npf-summary-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
    .npf-stat{padding:14px;border-radius:20px;background:#f8fbf9;border:1px solid #deebe2}
    .npf-stat-value{font:900 22px/1 Arial,sans-serif;color:#0f172a}
    .npf-stat-label{font:900 10px/1.2 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-top:8px}
    .npf-step-pill{display:grid;gap:2px;padding:12px 14px;border-radius:18px;background:#fff;border:1px solid #dbe6dd;text-align:left;min-width:124px}
    .npf-step-pill.active{background:#0f7a4f;color:#fff;border-color:#0f7a4f;box-shadow:0 14px 28px rgba(15,122,79,.18)}
    .npf-step-pill span{font:900 10px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;opacity:.72}
    .npf-step-pill strong{font:900 15px/1.1 Arial,sans-serif}
    .npf-pagebar{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
    .npf-pagebar .status{font:900 11px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#64748b}
    .npf-preview-shell{padding:20px;background:linear-gradient(180deg,#f8fafc 0%,#edf3f7 100%);border-radius:24px;overflow:auto;max-height:82vh;overscroll-behavior:contain;display:flex;justify-content:center;align-items:flex-start}
    .npf-preview-stage{width:100%;max-width:1120px;min-width:0;display:flex;justify-content:center}
    .npf-canvas{width:100%;height:auto;display:block;border-radius:24px;box-shadow:0 28px 48px rgba(15,23,42,.18);background:#fff;transform-origin:top center}
    .npf-preview-tools{align-items:flex-start;justify-content:space-between}
    .npf-save-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:20px;border:1px solid #deebe2;background:#f8fbf9}
    .npf-save-status{font:800 12px/1.45 Arial,sans-serif;color:#0f7a4f}
    .npf-save-status[data-state="working"],.npf-save-status[data-state="dirty"]{color:#b45309}
    .npf-save-status[data-state="saved"]{color:#0f7a4f}
    .npf-export-note{font:700 12px/1.45 Arial,sans-serif;color:#64748b}
    .npf-row-filter{position:relative}
    .npf-row-filter input{padding-right:44px}
    .npf-row-filter .count{position:absolute;right:14px;top:50%;transform:translateY(-50%);font:900 11px/1 Arial,sans-serif;color:#94a3b8}
    .npf-slots{display:grid;gap:12px;max-height:960px;overflow:auto;padding-right:4px;scroll-behavior:smooth;overscroll-behavior:contain}
    .npf-slot{border:1px solid #dbe7df;border-radius:22px;padding:14px;background:#f8fbf9}
    .npf-slot.off{opacity:.62}
    .npf-slot-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}
    .npf-slot-meta{display:grid;gap:4px;min-width:0}
    .npf-slot-badge{font:900 10px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#0f7a4f}
    .npf-slot-title{font:900 16px/1.15 Arial,sans-serif;color:#0f172a}
    .npf-thumb{width:100%;aspect-ratio:16/10;border-radius:18px;background:#dfe9e2 center/cover no-repeat;border:1px dashed #bfd2c4;display:flex;align-items:center;justify-content:center;text-align:center;padding:12px;color:#64748b;font:800 12px/1.4 Arial,sans-serif}
    .npf-thumb-caption{margin-top:8px;font:800 11px/1.4 Arial,sans-serif;color:#475569}
    .npf-photo-picker{display:grid;gap:8px;margin-top:12px}
    .npf-photo-rail{display:flex;gap:10px;overflow-x:auto;padding-bottom:4px;scrollbar-width:none;scroll-snap-type:x proximity}
    .npf-photo-rail::-webkit-scrollbar{display:none}
    .npf-photo-option{min-width:104px;width:104px;border:1px solid #d6e3db;background:#fff;border-radius:18px;padding:6px;display:grid;gap:6px;cursor:pointer;box-shadow:0 8px 18px rgba(15,23,42,.05);scroll-snap-align:start}
    .npf-photo-option.active{border-color:#0f7a4f;box-shadow:0 0 0 2px rgba(15,122,79,.14),0 8px 18px rgba(15,23,42,.08)}
    .npf-photo-mini{width:100%;aspect-ratio:1/1;border-radius:12px;background:#dfe9e2 center/cover no-repeat}
    .npf-photo-caption{font:800 10px/1.3 Arial,sans-serif;color:#334155;text-align:left;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
        .npf-photo-empty{font:800 11px/1.4 Arial,sans-serif;color:#94a3b8;padding:6px 0 2px}
    .npf-live-editor{display:grid;gap:14px}
    .npf-live-selector{display:grid;gap:10px}
    .npf-live-stage-card{display:grid;gap:14px;position:sticky;top:18px;z-index:1}
    .npf-live-shell{display:grid;gap:14px;grid-template-columns:minmax(0,1.15fr) minmax(240px,.85fr);align-items:start}
    .npf-live-stage{display:grid;gap:12px;padding:16px;border:1px solid #dbe7df;border-radius:26px;background:linear-gradient(180deg,#f8fbf9 0%,#eef5f0 100%)}
    .npf-live-frame{position:relative;aspect-ratio:4/5;border-radius:24px;overflow:hidden;background:#dfe9e2;box-shadow:0 18px 42px rgba(15,23,42,.12)}
    .npf-live-layer,.npf-live-layer img{position:absolute;inset:0;width:100%;height:100%}
    .npf-live-layer img{transform-origin:center center}
    .npf-live-focus{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);overflow:hidden;border-radius:24px;box-shadow:0 0 0 2px rgba(255,255,255,.76),0 18px 32px rgba(15,23,42,.14)}
    .npf-live-warmth{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen}
    .npf-live-price-badge{position:absolute;display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:8px 14px;border-radius:999px;background:#0f7a4f;color:#fff;font:900 20px/1 Arial,sans-serif;letter-spacing:.01em;box-shadow:0 12px 28px rgba(15,122,79,.24);z-index:2}
    .npf-live-copy{display:grid;gap:8px;padding:16px 18px;border-radius:22px;background:rgba(255,255,255,.94);border:1px solid rgba(219,231,223,.92);backdrop-filter:blur(12px)}
    .npf-live-title{font:900 24px/1.08 Arial,sans-serif;color:#0f172a}
    .npf-live-subheading{font:800 13px/1.45 Arial,sans-serif;color:#475569}
    .npf-live-note{font:900 13px/1.4 Arial,sans-serif;color:#0f7a4f}
    .npf-live-sidebar{display:grid;gap:12px}
    .npf-live-card-list{display:flex;gap:8px;overflow:auto;padding-bottom:4px;scrollbar-width:none}
    .npf-live-card-list::-webkit-scrollbar{display:none}
    .npf-live-chip{min-width:132px;max-width:190px;display:grid;gap:4px;justify-items:start;padding:10px 12px;border-radius:18px;border:1px solid #dbe7df;background:#fff;box-shadow:0 10px 20px rgba(15,23,42,.06);cursor:pointer}
    .npf-live-chip span{font:900 10px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#64748b}
    .npf-live-chip strong{font:900 13px/1.25 Arial,sans-serif;color:#0f172a;text-align:left;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .npf-live-chip.active{border-color:#0f7a4f;background:#eef8f2;box-shadow:0 0 0 2px rgba(15,122,79,.14),0 12px 24px rgba(15,23,42,.08)}
    .npf-live-meta{display:grid;gap:8px;padding:14px;border-radius:20px;background:#fff;border:1px solid #dbe7df}
    .npf-live-meta strong{font:900 14px/1.25 Arial,sans-serif;color:#0f172a}
    .npf-live-meta .muted{font:800 11px/1.45 Arial,sans-serif;color:#64748b}
    .npf-live-placeholder{display:flex;align-items:center;justify-content:center;height:100%;padding:24px;text-align:center;font:900 18px/1.4 Arial,sans-serif;color:#64748b}
    .npf-live-control-shell{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start}
    .npf-live-control-card{display:grid;gap:12px;padding:16px;border:1px solid #dbe7df;border-radius:24px;background:#f8fbf9}
    .npf-live-form-grid{display:grid;gap:10px;grid-template-columns:repeat(2,minmax(0,1fr))}
    .npf-live-form-grid .wide{grid-column:1/-1}
    .npf-slot.current{border-color:#0f7a4f;box-shadow:0 0 0 2px rgba(15,122,79,.14),0 12px 22px rgba(15,23,42,.06)}
    .npf-slot.current .npf-slot-title{color:#0f7a4f}
    .npf-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
    .npf-editor-grid .wide{grid-column:1/-1}
    .npf-range-wrap{display:grid;gap:6px}
    .npf-range-wrap input[type=range]{width:100%;accent-color:#0f7a4f}
    .npf-range-value{font:900 10px/1 Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#64748b;text-align:right}
    .npf-share-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}
    .npf-share-list li{padding:12px 14px;border-radius:18px;border:1px solid #d9e6dd;background:#f8fbf9;font:700 13px/1.45 Arial,sans-serif;color:#334155}
    @media (max-width:1320px){.npf-grid{grid-template-columns:1fr}.npf-preview-card{position:static}.npf-builder-column{grid-template-columns:1fr}.npf-builder-column>.npf-card:first-child,.npf-live-stage-card{position:static}}
    @media (max-width:1480px){.npf-slots{max-height:none}.npf-preview-shell{max-height:none}.npf-preview-stage{min-width:0;width:100%;max-width:none}.npf-canvas{max-width:100%!important;width:100%!important}}
    @media (max-width:980px){.npf-live-shell,.npf-live-control-shell,.npf-live-form-grid{grid-template-columns:1fr}}
    @media (max-width:640px){.npf-control-grid,.npf-control-grid.three,.npf-color-grid,.npf-editor-grid,.npf-summary-grid{grid-template-columns:1fr}.npf-pagebar,.npf-preview-tools,.npf-save-row{align-items:flex-start;flex-direction:column}.npf-step-pill{min-width:0;flex:1 1 44%}.npf-live-chip{min-width:118px}.npf-live-title{font-size:20px}}
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
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

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
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

  function formatPriceValue(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/\$/.test(raw) || /[%A-Za-z]/.test(raw)) return raw;
    const numeric = Number(String(raw).replace(/,/g, ''));
    if (!Number.isFinite(numeric)) return raw;
    return '$' + (Number.isInteger(numeric) ? numeric.toFixed(0) : numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  }

  function asciiBytes(text) {
    return new TextEncoder().encode(String(text || ''));
  }

  function concatBytes(chunks) {
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    return output;
  }

  async function buildPdfFromJpegs(pages) {
    const objects = [];
    const pageRefs = [];
    let nextRef = 3;

    pages.forEach((page, index) => {
      const imageRef = nextRef++;
      const contentRef = nextRef++;
      const pageRef = nextRef++;
      const imageDict = `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>`;
      const contentStream = `q\n${PDF_PAGE_WIDTH} 0 0 ${PDF_PAGE_HEIGHT} 0 0 cm\n/Im${index + 1} Do\nQ\n`;
      objects.push({ ref: imageRef, dict: imageDict, stream: page.bytes });
      objects.push({ ref: contentRef, dict: `<< /Length ${asciiBytes(contentStream).length} >>`, stream: asciiBytes(contentStream) });
      objects.push({ ref: pageRef, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /XObject << /Im${index + 1} ${imageRef} 0 R >> >> /Contents ${contentRef} 0 R >>` });
      pageRefs.push(`${pageRef} 0 R`);
    });

    const ordered = [
      { ref: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      { ref: 2, body: `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>` }
    ].concat(objects.sort((a, b) => a.ref - b.ref));

    const chunks = [];
    const offsets = [0];
    let cursor = 0;
    const pushBytes = (bytes) => { chunks.push(bytes); cursor += bytes.length; };
    const pushText = (text) => pushBytes(asciiBytes(text));

    pushText('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    ordered.forEach((object) => {
      offsets[object.ref] = cursor;
      if (object.stream) {
        pushText(`${object.ref} 0 obj\n${object.dict}\nstream\n`);
        pushBytes(object.stream);
        pushText('\nendstream\nendobj\n');
      } else {
        pushText(`${object.ref} 0 obj\n${object.body}\nendobj\n`);
      }
    });

    const xrefOffset = cursor;
    pushText(`xref\n0 ${ordered.length + 1}\n`);
    pushText('0000000000 65535 f \n');
    for (let ref = 1; ref <= ordered.length; ref += 1) pushText(`${String(offsets[ref] || 0).padStart(10, '0')} 00000 n \n`);
    pushText(`trailer\n<< /Size ${ordered.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

    return new Blob([concatBytes(chunks)], { type: 'application/pdf' });
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
        currentUser: (global.currentUserDisplay || global.currentUser || 'Unknown User'),
        logoUrl: '',
        storageNamespace: ''
      }, options || {});

      this.root = root;
      this.uploadFlyerBlob = opts.uploadFlyerBlob;
      this.supabaseFetchFn = opts.supabaseFetchFn;
      this.currentUser = opts.currentUser;
      this.logoUrl = opts.logoUrl;
      this.imageCache = new Map();
      this.logoPromise = null;
      this.renderTimer = null;
      this.renderFrame = null;
      this.renderInFlight = false;
      this.renderQueued = false;
      this.pendingViewportState = null;
      this.persistTimer = null;
      this.renderDebounceMs = RENDER_DEBOUNCE_MS;
      this.saveStatusMessage = 'Draft ready. Auto-save is on for this device.';
      this.saveStatusState = 'saved';
      this.state = {
        step: 'layout',
        themeKey: opts.theme,
        theme: Object.assign({}, THEMES[opts.theme] || THEMES.sage),
        title: opts.title,
        subtitle: opts.subtitle,
        footer: opts.footer,
        footerNote: opts.footerNote,
        columns: 2,
        rowsPerPage: 4,
        photoFit: 'cover',
        cardStyle: 'soft',
        rowFilter: '',
        activeCardIndex: 0,
        pageIndex: 0,
        previewZoom: 100,
        showLogo: true,
        cards: Array.from({ length: Math.max(1, opts.slots) }).map((_, index) => this.createDefaultCard(index))
      };
      this.ui = {};
      this.storageKey = `${BUILDER_STATE_STORAGE_KEY}:${safeName(opts.storageNamespace || opts.title || 'flyer')}`;
    }

    createDefaultCard(index) {
      return {
        heading: `Photo ${Number(index || 0) + 1}`,
        subheading: '',
        note: '',
        price: '',
        pricePosition: 'top-right',
        priceSize: 'md',
        priceOffsetX: 0,
        priceOffsetY: 0,
        brightness: 100,
        contrast: 100,
        saturation: 100,
        warmth: 0,
        backgroundBlur: 0,
        focusArea: 62,
        imageZoom: 100,
        imageOffsetX: 0,
        imageOffsetY: 0,
        imageSrc: '',
        imageName: '',
        photoOptions: [],
        selectedPhotoIndex: -1,
        sourceUniqueId: '',
        enabled: true
      };
    }

    normalizeCard(card, index) {
      const base = Object.assign({}, this.createDefaultCard(index), card || {});
      let photoOptions = mergePhotoOptions(base.photoOptions || []);
      const imageSrc = String(base.imageSrc || '').trim();
      const imageName = String(base.imageName || '').trim() || `Photo ${Number(index || 0) + 1}`;
      if (imageSrc) photoOptions = mergePhotoOptions(photoOptions, [{ src: imageSrc, name: imageName, displayName: imageName, source: 'selected' }]);
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
      base.priceOffsetX = clamp(base.priceOffsetX || 0, -40, 40);
      base.priceOffsetY = clamp(base.priceOffsetY || 0, -40, 40);
      base.brightness = clamp(base.brightness || 100, 60, 160);
      base.contrast = clamp(base.contrast || 100, 60, 160);
      base.saturation = clamp(base.saturation || 100, 40, 180);
      base.warmth = clamp(base.warmth || 0, -30, 30);
      base.backgroundBlur = clamp(base.backgroundBlur || 0, 0, 40);
      base.focusArea = clamp(base.focusArea || 62, 40, 90);
      base.imageZoom = clamp(base.imageZoom || 100, 60, 220);
      base.imageOffsetX = clamp(base.imageOffsetX || 0, -40, 40);
      base.imageOffsetY = clamp(base.imageOffsetY || 0, -40, 40);
      return base;
    }

    normalizeCards() {
      const incoming = Array.isArray(this.state.cards) ? this.state.cards : [];
      this.state.cards = incoming.length ? incoming.map((card, index) => this.normalizeCard(card, index)) : [this.createDefaultCard(0)];
      const maxCardIndex = Math.max(0, this.state.cards.length - 1);
      this.state.activeCardIndex = clamp(Number(this.state.activeCardIndex || 0), 0, maxCardIndex);
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
            <div class="npf-preview-column">
              <div class="npf-card npf-preview-card">
                <div class="npf-section npf-stack">
                  <div class="npf-pagebar">
                    <div>
                      <div class="npf-label">Live Preview</div>
                      <div class="npf-helper" style="margin-top:6px">Review a larger working page while you edit. PDF export always includes the whole finished flyer.</div>
                    </div>
                    <div class="npf-actions">
                      <button type="button" class="npf-btn npf-muted" data-page-nav="prev">Previous</button>
                      <div class="status" data-page-status></div>
                      <button type="button" class="npf-btn npf-muted" data-page-nav="next">Next</button>
                    </div>
                  </div>
                  <div class="npf-preview-tools">
                    <div class="npf-stack" style="gap:4px">
                      <div class="npf-label">Preview Zoom</div>
                      <div class="npf-helper">Use this larger view while you work. Share and email always use the complete flyer PDF.</div>
                    </div>
                    <div class="npf-segmented" data-preview-zoom-wrap></div>
                  </div>
                  <div class="npf-page-chips" data-page-chips></div>
                  <div class="npf-preview-shell">
                    <div class="npf-preview-stage">
                      <canvas class="npf-canvas"></canvas>
                    </div>
                  </div>
                  <div class="npf-save-row">
                    <div class="npf-stack" style="gap:4px">
                      <div class="npf-label">Draft Progress</div>
                      <div class="npf-save-status" data-save-status>Draft ready.</div>
                    </div>
                    <div class="npf-actions">
                      <button type="button" class="npf-btn npf-primary" data-save-progress>Save Progress</button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="npf-card">
                <div class="npf-section npf-stack">
                  <div>
                    <div class="npf-label">Export & Share</div>
                    <div class="npf-export-note" style="margin-top:6px">Download, share, or email the full flyer PDF. The current page preview is only for editing.</div>
                  </div>
                  <div class="npf-actions">
                    <button type="button" class="npf-btn npf-primary" data-action="pdf">Download PDF</button>
                    <button type="button" class="npf-btn npf-secondary" data-action="png">Page PNG</button>
                    <button type="button" class="npf-btn npf-secondary" data-action="all">All PNG Pages</button>
                    <button type="button" class="npf-btn npf-secondary" data-action="message">Share PDF</button>
                    <button type="button" class="npf-btn npf-secondary" data-action="outlook">Email PDF</button>
                  </div>
                  <div class="npf-label" data-share-status style="color:#64748b">Ready to build.</div>
                </div>
              </div>
            </div>
            <div class="npf-builder-column">
              <div class="npf-card">
                <div class="npf-section npf-stack">
                  <div class="npf-kicker">
                    <div class="npf-stack" style="gap:6px">
                      <div class="npf-label">Flyer Builder</div>
                      <strong>Build It Step By Step</strong>
                      <div class="npf-helper">Choose layout, then photos and text, then styling and pricing, then send the whole finished flyer as a PDF.</div>
                    </div>
                  </div>
                  <div class="npf-step-nav" data-steps></div>
                </div>
              </div>
              <div class="npf-card">
                <div class="npf-section" data-step-body></div>
              </div>
            </div>
          </div>
        </div>`;

      this.ui.canvas = this.root.querySelector('.npf-canvas');
      this.ui.shareStatus = this.root.querySelector('[data-share-status]');
      this.ui.pageStatus = this.root.querySelector('[data-page-status]');
      this.ui.pageChips = this.root.querySelector('[data-page-chips]');
      this.ui.stepNav = this.root.querySelector('[data-steps]');
      this.ui.stepBody = this.root.querySelector('[data-step-body]');
      this.ui.previewZoomWrap = this.root.querySelector('[data-preview-zoom-wrap]');
      this.ui.previewShell = this.root.querySelector('.npf-preview-shell');
      this.ui.saveStatus = this.root.querySelector('[data-save-status]');

      Array.from(this.root.querySelectorAll('[data-action]')).forEach((button) => button.addEventListener('click', () => this.handleAction(button.dataset.action)));
      Array.from(this.root.querySelectorAll('[data-page-nav]')).forEach((button) => button.addEventListener('click', () => {
        this.state.pageIndex += button.dataset.pageNav === 'next' ? 1 : -1;
        this.clampPageIndex();
        this.queuePersistState();
        this.renderPageControls();
        this.scrollPreviewToTop();
        this.scheduleRender(true);
      }));
      const saveButton = this.root.querySelector('[data-save-progress]');
      if (saveButton) saveButton.addEventListener('click', () => this.saveProgress());

      if (!this.saveStatusMessage) this.setSaveStatus('Draft ready. Auto-save is on for this device.', 'saved');
      this.renderUi();
      this.render().catch(() => {});
      if (!this.visibilityPersistHandler) {
        this.visibilityPersistHandler = () => {
          if (document.hidden) this.flushQueuedState(false);
        };
        document.addEventListener('visibilitychange', this.visibilityPersistHandler, { passive: true });
      }
      if (!this.pageHidePersistHandler) {
        this.pageHidePersistHandler = () => this.flushQueuedState(false);
        global.addEventListener('pagehide', this.pageHidePersistHandler, { passive: true });
      }
      return this;
    }

    renderUi() {
      this.normalizeCards();
      this.renderStepNav();
      this.renderPageControls();
      this.renderStepBody();
    }

    renderStepNav() {
      this.ui.stepNav.innerHTML = STEP_LIST.map((step) => `
        <button type="button" class="npf-step-pill ${this.state.step === step.key ? 'active' : ''}" data-step="${step.key}">
          <span>${this.escape(step.label)}</span>
          <strong>${this.escape(step.title)}</strong>
        </button>`).join('');
      Array.from(this.ui.stepNav.querySelectorAll('[data-step]')).forEach((button) => button.addEventListener('click', () => {
        this.state.step = button.dataset.step || 'layout';
        this.queuePersistState();
        this.renderUi();
        this.scrollPreviewToTop();
      }));
    }

    renderPageControls() {
      const pageCount = this.getPageCount();
      if (this.ui.pageStatus) this.ui.pageStatus.textContent = `Page ${this.state.pageIndex + 1} of ${pageCount}`;
      this.ui.pageChips.innerHTML = Array.from({ length: pageCount }).map((_, index) => `
        <button type="button" class="npf-btn ${index === this.state.pageIndex ? 'npf-primary active' : 'npf-muted'}" data-page-chip="${index}">${index + 1}</button>`).join('');
      Array.from(this.ui.pageChips.querySelectorAll('[data-page-chip]')).forEach((button) => button.addEventListener('click', () => {
        this.state.pageIndex = clamp(button.dataset.pageChip || 0, 0, pageCount - 1);
        this.queuePersistState();
        this.renderPageControls();
        this.scrollPreviewToTop();
        this.scheduleRender(true);
      }));
      if (this.ui.previewZoomWrap) {
        this.ui.previewZoomWrap.innerHTML = PREVIEW_ZOOMS.map((zoom) => `<button type="button" class="npf-btn ${Number(this.state.previewZoom || 100) === zoom ? 'npf-primary active' : 'npf-muted'}" data-preview-zoom="${zoom}">${zoom}%</button>`).join('');
        Array.from(this.ui.previewZoomWrap.querySelectorAll('[data-preview-zoom]')).forEach((button) => button.addEventListener('click', () => {
          this.state.previewZoom = clamp(button.dataset.previewZoom || 100, 60, 150);
          this.queuePersistState();
          this.renderPageControls();
          this.applyPreviewZoom();
        }));
      }
      this.applyPreviewZoom();
      Array.from(this.root.querySelectorAll('[data-page-nav]')).forEach((button) => {
        button.disabled = (button.dataset.pageNav === 'prev' && this.state.pageIndex <= 0) || (button.dataset.pageNav === 'next' && this.state.pageIndex >= pageCount - 1);
        button.style.opacity = button.disabled ? '0.45' : '1';
      });
      if (this.ui.saveStatus) {
        this.ui.saveStatus.textContent = this.saveStatusMessage || 'Draft ready.';
        this.ui.saveStatus.dataset.state = this.saveStatusState || 'saved';
      }
    }

    renderStepBody() {
      if (this.state.step === 'layout') this.ui.stepBody.innerHTML = this.renderLayoutStep();
      else if (this.state.step === 'cards') this.ui.stepBody.innerHTML = this.renderCardsStep();
      else if (this.state.step === 'style') this.ui.stepBody.innerHTML = this.renderStyleStep();
      else this.ui.stepBody.innerHTML = this.renderShareStep();
      this.bindStepEvents();
    }

    renderLayoutStep() {
      const presetValue = this.getLayoutPresetValue();
      const included = this.getIncludedCards().length;
      return `
        <div class="npf-stack">
          <div class="npf-kicker">
            <div class="npf-stack" style="gap:6px">
              <div class="npf-label">Step 1</div>
              <strong>Choose The Page Layout</strong>
              <div class="npf-helper">Set how many cards land on each page, then the preview updates right away so you can judge legibility before you move on.</div>
            </div>
          </div>
          <div class="npf-summary-grid">
            <div class="npf-stat"><div class="npf-stat-value">${this.getCardsPerPage()}</div><div class="npf-stat-label">Cards Per Page</div></div>
            <div class="npf-stat"><div class="npf-stat-value">${this.getPageCount()}</div><div class="npf-stat-label">Estimated Pages</div></div>
            <div class="npf-stat"><div class="npf-stat-value">${included}</div><div class="npf-stat-label">Included Rows</div></div>
          </div>
          <div>
            <div class="npf-label">Quick Layout</div>
            <div class="npf-segmented" data-layout-presets>
              ${LAYOUT_PRESETS.map((preset) => `<button type="button" class="npf-btn ${presetValue === preset.id ? 'npf-primary active' : 'npf-muted'}" data-layout-preset="${preset.id}">${preset.label}</button>`).join('')}
            </div>
          </div>
          <div class="npf-control-grid three">
            <div>
              <div class="npf-label">Columns</div>
              <div class="npf-segmented" data-columns></div>
            </div>
            <div>
              <div class="npf-label">Rows Per Page</div>
              <div class="npf-segmented" data-rows></div>
            </div>
            <div>
              <div class="npf-label">Logo Footer</div>
              <div class="npf-segmented" data-logo-toggle></div>
            </div>
          </div>
          <div class="npf-control-grid">
            <label class="npf-label">Headline<input class="npf-input" data-field="title" value="${this.escape(this.state.title)}"></label>
            <label class="npf-label">Footer<input class="npf-input" data-field="footer" value="${this.escape(this.state.footer)}"></label>
            <label class="npf-label" style="grid-column:1/-1">Subheadline<textarea class="npf-textarea" data-field="subtitle">${this.escape(this.state.subtitle)}</textarea></label>
            <label class="npf-label" style="grid-column:1/-1">Footer Note<textarea class="npf-textarea" data-field="footerNote">${this.escape(this.state.footerNote)}</textarea></label>
          </div>
        </div>`;
    }

    renderCardsStep() {
      return `
        <div class="npf-stack">
          <div class="npf-kicker">
            <div class="npf-stack" style="gap:6px">
              <div class="npf-label">Step 2</div>
              <strong>Select The Row Photo And Text</strong>
              <div class="npf-helper">Scroll each row's saved photo stack, tap the exact image you want, and type freely without losing focus while the preview updates.</div>
            </div>
          </div>
          ${this.renderRowFilter('Choose rows in this flyer...')}
          <div class="npf-slots">${this.renderCardEditorCards('cards')}</div>
        </div>`;
    }

    renderStyleStep() {
      return `
        <div class="npf-stack">
          <div class="npf-kicker">
            <div class="npf-stack" style="gap:6px">
              <div class="npf-label">Step 3</div>
              <strong>Style, Price, And Edit Each Photo</strong>
              <div class="npf-helper">Work one selected flyer card at a time. Keep the live image stage in view while you blur, brighten, crop, move, and place pricing, then confirm the full page in the flyer preview.</div>
            </div>
          </div>
          ${this.renderRowFilter('Search flyer rows for styling...')}
          ${this.renderLiveCardSelector()}
          ${this.renderLiveEditorPanel()}
          ${this.renderActiveCardStyleControls()}
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
              <div class="npf-label">Photo Crop</div>
              <div class="npf-segmented" data-fit></div>
            </div>
            <div>
              <div class="npf-label">Card Style</div>
              <div class="npf-segmented" data-card-style></div>
            </div>
          </div>
        </div>`;
    }

    getActiveEditorCardIndex(filteredCards) {
      const filtered = Array.isArray(filteredCards) ? filteredCards : this.getFilteredEditorCards();
      if (!filtered.length) {
        this.state.activeCardIndex = 0;
        return 0;
      }
      let index = Number(this.state.activeCardIndex || 0);
      if (!Number.isFinite(index)) index = filtered[0].index;
      if (!filtered.some((entry) => entry.index === index)) index = filtered[0].index;
      index = clamp(index, 0, this.state.cards.length - 1);
      this.state.activeCardIndex = index;
      return index;
    }

    getActiveEditorEntry(filteredCards) {
      const filtered = Array.isArray(filteredCards) ? filteredCards : this.getFilteredEditorCards();
      if (!filtered.length) return null;
      const activeIndex = this.getActiveEditorCardIndex(filtered);
      return filtered.find((item) => item.index === activeIndex) || filtered[0];
    }

    buildLiveImageStyle(card, withBlur) {
      const fit = this.state.photoFit === 'contain' ? 'contain' : 'cover';
      const translateX = clamp(card.imageOffsetX || 0, -40, 40) * 0.35;
      const translateY = clamp(card.imageOffsetY || 0, -40, 40) * 0.35;
      const zoom = clamp(card.imageZoom || 100, 60, 220) / 100;
      const filters = [
        `brightness(${clamp(card.brightness || 100, 60, 170)}%)`,
        `contrast(${clamp(card.contrast || 100, 60, 170)}%)`,
        `saturate(${clamp(card.saturation || 100, 40, 190)}%)`
      ];
      if (withBlur) filters.push(`blur(${(Math.max(0, Number(card.backgroundBlur || 0)) * 0.6).toFixed(2)}px)`);
      return `object-fit:${fit};transform:translate(${translateX}%, ${translateY}%) scale(${zoom});filter:${filters.join(' ')};`;
    }

    renderLiveCardSelector() {
      const filtered = this.getFilteredEditorCards();
      if (!filtered.length) return `<div class="npf-photo-empty">No rows match that search.</div>`;
      const activeIndex = this.getActiveEditorCardIndex(filtered);
      const chips = filtered.map(({ card, index }) => `
        <button type="button" class="npf-live-chip ${index === activeIndex ? 'active' : ''}" data-live-card="${index}">
          <span>Row ${index + 1}</span>
          <strong data-live-card-title="${index}">${this.escape(card.heading || `Photo ${index + 1}`)}</strong>
        </button>`).join('');
      return `
        <div class="npf-live-selector">
          <div class="npf-save-row">
            <div class="npf-stack" style="gap:4px">
              <div class="npf-label">Selected Flyer Card</div>
              <div class="npf-helper">Tap any row below to switch the live editor without leaving this step.</div>
            </div>
            <div class="npf-label" style="color:${this.state.theme.accent}">Editing Row ${activeIndex + 1}</div>
          </div>
          <div class="npf-live-card-list">${chips}</div>
        </div>`;
    }
    renderLiveEditorPanel() {
      const entry = this.getActiveEditorEntry();
      if (!entry) return `<div class="npf-photo-empty" data-live-editor-panel>No rows match that search.</div>`;
      const card = this.state.cards[entry.index] = this.normalizeCard(entry.card, entry.index);
      const theme = this.state.theme;
      const warmth = clamp(card.warmth || 0, -30, 30);
      const warmthOpacity = Math.min(0.2, Math.abs(warmth) / 140).toFixed(3);
      const warmthStyle = warmth ? `background:${warmth > 0 ? `rgba(255,191,120,${warmthOpacity})` : `rgba(125,175,255,${warmthOpacity})`};` : 'background:transparent;';
      const focusWidth = clamp(card.focusArea || 62, 40, 90);
      const focusHeight = Math.min(94, focusWidth + 8);
      const priceText = formatPriceValue(card.price);
      const priceSizeMap = { sm: 16, md: 20, lg: 24, xl: 28 };
      const priceSize = priceSizeMap[String(card.priceSize || 'md')] || priceSizeMap.md;
      let priceBadge = '';
      if (priceText && String(card.pricePosition || 'top-right') !== 'below-title') {
        const pos = String(card.pricePosition || 'top-right');
        const isRight = pos === 'top-right' || pos === 'bottom-right';
        const isBottom = pos === 'bottom-left' || pos === 'bottom-right';
        const offsetX = Number(card.priceOffsetX || 0) * 1.2;
        const offsetY = Number(card.priceOffsetY || 0) * 1.2;
        const badgeStyle = `${isRight ? 'right:18px;' : 'left:18px;'}${isBottom ? 'bottom:18px;' : 'top:18px;'}transform:translate(${offsetX}px, ${offsetY}px);font-size:${priceSize}px;background:${theme.accent};`;
        priceBadge = `<div class="npf-live-price-badge" style="${badgeStyle}">${this.escape(priceText)}</div>`;
      }
      const photoMarkup = card.imageSrc
        ? `
          <div class="npf-live-layer"><img alt="${this.escape(card.imageName || card.heading || 'Flyer photo')}" src="${this.escape(card.imageSrc)}" style="${this.buildLiveImageStyle(card, true)}"></div>
          <div class="npf-live-focus" style="width:${focusWidth}%;height:${focusHeight}%"><div class="npf-live-layer"><img alt="${this.escape(card.imageName || card.heading || 'Flyer photo')}" src="${this.escape(card.imageSrc)}" style="${this.buildLiveImageStyle(card, false)}"></div></div>
          <div class="npf-live-warmth" style="${warmthStyle}"></div>
          ${priceBadge}`
        : `<div class="npf-live-placeholder">Pick a saved row photo below to start styling this card.</div>`;
      return `
        <div class="npf-live-stage-card" data-live-editor-panel>
          <div class="npf-live-shell">
            <div class="npf-live-stage">
              <div class="npf-live-frame">${photoMarkup}</div>
              <div class="npf-live-copy">
                <div class="npf-live-title" style="color:${theme.title}">${this.escape(card.heading || `Photo ${entry.index + 1}`)}</div>
                ${priceText && String(card.pricePosition || 'top-right') === 'below-title' ? `<div class="npf-live-price-badge" style="position:relative;left:auto;right:auto;top:auto;bottom:auto;transform:translate(${Number(card.priceOffsetX || 0) * 1.2}px, ${Number(card.priceOffsetY || 0) * 1.2}px);font-size:${priceSize}px;background:${theme.accent};width:max-content;">${this.escape(priceText)}</div>` : ''}
                ${card.subheading ? `<div class="npf-live-subheading" style="color:${theme.body}">${this.escape(card.subheading)}</div>` : ''}
                ${card.note ? `<div class="npf-live-note" style="color:${theme.accent}">${this.escape(card.note)}</div>` : ''}
              </div>
            </div>
            <div class="npf-live-sidebar">
              <div class="npf-live-meta">
                <div class="npf-label">Selected Photo</div>
                <strong>${this.escape(card.imageName || 'No photo selected')}</strong>
                <div class="muted">${Array.isArray(card.photoOptions) ? card.photoOptions.length : 0} saved row photo${Array.isArray(card.photoOptions) && card.photoOptions.length === 1 ? '' : 's'} available for this card.</div>
              </div>
              <div class="npf-live-meta">
                <div class="npf-label">Live Settings</div>
                <strong>Blur ${Number(card.backgroundBlur || 0)}px | Size ${Number(card.imageZoom || 100)}%</strong>
                <div class="muted">Brightness ${Number(card.brightness || 100)}% | Contrast ${Number(card.contrast || 100)}% | Saturation ${Number(card.saturation || 100)}% | Warmth ${Number(card.warmth || 0)}</div>
              </div>
              <div class="npf-live-meta">
                <div class="npf-label">Editing Tip</div>
                <div class="muted">Leave this large stage in view while you adjust the selected row below. The page preview stays as the whole-flyer check, and the live stage is where you judge the image edits instantly.</div>
              </div>
            </div>
          </div>
        </div>`;
    }
    renderActiveCardStyleControls() {
      const entry = this.getActiveEditorEntry();
      if (!entry) return `<div class="npf-photo-empty" data-active-style-controls>No rows match that search.</div>`;
      const index = entry.index;
      const card = this.state.cards[index] = this.normalizeCard(entry.card, index);
      const thumbStyle = card.imageSrc ? `background-image:url('${String(card.imageSrc || '').replace(/'/g, '%27')}');color:transparent;` : '';
      const photoRail = card.photoOptions.length
        ? `<div class="npf-photo-picker"><div class="npf-label" style="color:#0f7a4f">Row Photos</div><div class="npf-photo-rail">${card.photoOptions.map((option, optionIndex) => `<button type="button" class="npf-photo-option ${card.selectedPhotoIndex === optionIndex ? 'active' : ''}" data-photo-option="${index}:${optionIndex}" title="${this.escape(option.displayName || option.name || `Photo ${optionIndex + 1}`)}"><div class="npf-photo-mini" style="background-image:url('${String(option.src || '').replace(/'/g, '%27')}')"></div><div class="npf-photo-caption">${this.escape(option.displayName || option.name || `Photo ${optionIndex + 1}`)}</div></button>`).join('')}</div><div class="npf-actions" style="margin-top:10px"><button type="button" class="npf-btn npf-secondary" data-duplicate-card="${index}">Add Another Photo From This Row</button></div></div>`
        : `<div class="npf-photo-empty">No saved row photos yet for this flyer item.</div>`;
      return `
        <div class="npf-stack" data-active-style-controls>
          <div class="npf-kicker">
            <div class="npf-stack" style="gap:6px">
              <div class="npf-label">Selected Row Controls</div>
              <strong>${this.escape(card.heading || `Photo ${index + 1}`)}</strong>
              <div class="npf-helper">Everything here updates the live stage above right away, and the full flyer preview refreshes behind it.</div>
            </div>
            <button type="button" class="npf-btn ${card.enabled ? 'npf-primary' : 'npf-muted'}" data-toggle-card="${index}" data-card-toggle="${index}">${card.enabled ? 'Included' : 'Hidden'}</button>
          </div>
          <div class="npf-live-control-shell">
            <div class="npf-live-control-card">
              <div class="npf-label">Selected Image</div>
              <div class="npf-thumb" data-card-thumb="${index}" style="${thumbStyle}">${card.imageSrc ? this.escape(card.imageName || `Photo ${index + 1}`) : 'Pick a saved row photo below'}</div>
              <div class="npf-thumb-caption" data-card-caption="${index}">${this.escape(card.imageName || 'Tap the exact saved row photo you want on the flyer.')}</div>
              ${photoRail}
              <div class="npf-live-form-grid">
                <label class="npf-label wide">Text Below Photo<input class="npf-input" data-card="heading" data-index="${index}" value="${this.escape(card.heading)}"></label>
                <label class="npf-label">Subtext<textarea class="npf-textarea" data-card="subheading" data-index="${index}">${this.escape(card.subheading)}</textarea></label>
                <label class="npf-label">Notes / Details<textarea class="npf-textarea" data-card="note" data-index="${index}">${this.escape(card.note)}</textarea></label>
              </div>
            </div>
            <div class="npf-live-control-card">
              <div class="npf-label">Price Placement</div>
              <div class="npf-live-form-grid">
                <label class="npf-label">Price<input class="npf-input" data-card="price" data-index="${index}" value="${this.escape(card.price || '')}" placeholder="$19.99"></label>
                <label class="npf-label">Price Spot<select class="npf-select" data-card="pricePosition" data-index="${index}"><option value="top-left" ${String(card.pricePosition || 'top-right') === 'top-left' ? 'selected' : ''}>Top Left</option><option value="top-right" ${String(card.pricePosition || 'top-right') === 'top-right' ? 'selected' : ''}>Top Right</option><option value="bottom-left" ${String(card.pricePosition || 'top-right') === 'bottom-left' ? 'selected' : ''}>Bottom Left</option><option value="bottom-right" ${String(card.pricePosition || 'top-right') === 'bottom-right' ? 'selected' : ''}>Bottom Right</option><option value="below-title" ${String(card.pricePosition || 'top-right') === 'below-title' ? 'selected' : ''}>Below Title</option></select></label>
                <label class="npf-label">Price Size<select class="npf-select" data-card="priceSize" data-index="${index}"><option value="sm" ${String(card.priceSize || 'md') === 'sm' ? 'selected' : ''}>Small</option><option value="md" ${String(card.priceSize || 'md') === 'md' ? 'selected' : ''}>Medium</option><option value="lg" ${String(card.priceSize || 'md') === 'lg' ? 'selected' : ''}>Large</option><option value="xl" ${String(card.priceSize || 'md') === 'xl' ? 'selected' : ''}>XL</option></select></label>
                <label class="npf-label npf-range-wrap">Price X Offset<span class="npf-range-value">${this.formatRangeValue('priceOffsetX', card.priceOffsetX || 0)}</span><input type="range" min="-40" max="40" step="1" data-card="priceOffsetX" data-index="${index}" value="${Number(card.priceOffsetX || 0)}"></label>
                <label class="npf-label npf-range-wrap">Price Y Offset<span class="npf-range-value">${this.formatRangeValue('priceOffsetY', card.priceOffsetY || 0)}</span><input type="range" min="-40" max="40" step="1" data-card="priceOffsetY" data-index="${index}" value="${Number(card.priceOffsetY || 0)}"></label>
              </div>
              <div class="npf-label" style="margin-top:4px">Photo Adjustments</div>
              <div class="npf-live-form-grid">
                <label class="npf-label npf-range-wrap">Brightness<span class="npf-range-value">${this.formatRangeValue('brightness', card.brightness || 100)}</span><input type="range" min="60" max="160" step="1" data-card="brightness" data-index="${index}" value="${Number(card.brightness || 100)}"></label>
                <label class="npf-label npf-range-wrap">Contrast<span class="npf-range-value">${this.formatRangeValue('contrast', card.contrast || 100)}</span><input type="range" min="60" max="160" step="1" data-card="contrast" data-index="${index}" value="${Number(card.contrast || 100)}"></label>
                <label class="npf-label npf-range-wrap">Saturation<span class="npf-range-value">${this.formatRangeValue('saturation', card.saturation || 100)}</span><input type="range" min="40" max="180" step="1" data-card="saturation" data-index="${index}" value="${Number(card.saturation || 100)}"></label>
                <label class="npf-label npf-range-wrap">Warmth<span class="npf-range-value">${this.formatRangeValue('warmth', card.warmth || 0)}</span><input type="range" min="-30" max="30" step="1" data-card="warmth" data-index="${index}" value="${Number(card.warmth || 0)}"></label>
                <label class="npf-label npf-range-wrap">Background Blur<span class="npf-range-value">${this.formatRangeValue('backgroundBlur', card.backgroundBlur || 0)}</span><input type="range" min="0" max="40" step="1" data-card="backgroundBlur" data-index="${index}" value="${Number(card.backgroundBlur || 0)}"></label>
                <label class="npf-label npf-range-wrap">Focus Window<span class="npf-range-value">${this.formatRangeValue('focusArea', card.focusArea || 62)}</span><input type="range" min="40" max="90" step="1" data-card="focusArea" data-index="${index}" value="${Number(card.focusArea || 62)}"></label>
                <label class="npf-label npf-range-wrap">Photo Size<span class="npf-range-value">${this.formatRangeValue('imageZoom', card.imageZoom || 100)}</span><input type="range" min="60" max="220" step="1" data-card="imageZoom" data-index="${index}" value="${Number(card.imageZoom || 100)}"></label>
                <label class="npf-label npf-range-wrap">Move Left / Right<span class="npf-range-value">${this.formatRangeValue('imageOffsetX', card.imageOffsetX || 0)}</span><input type="range" min="-40" max="40" step="1" data-card="imageOffsetX" data-index="${index}" value="${Number(card.imageOffsetX || 0)}"></label>
                <label class="npf-label npf-range-wrap wide">Move Up / Down<span class="npf-range-value">${this.formatRangeValue('imageOffsetY', card.imageOffsetY || 0)}</span><input type="range" min="-40" max="40" step="1" data-card="imageOffsetY" data-index="${index}" value="${Number(card.imageOffsetY || 0)}"></label>
              </div>
            </div>
          </div>
        </div>`;
    }
    bindLiveEditorEvents() {
      Array.from(this.ui.stepBody.querySelectorAll('[data-live-card]')).forEach((button) => button.addEventListener('click', () => {
        const viewportState = this.captureViewportState();
        this.state.activeCardIndex = clamp(button.dataset.liveCard || 0, 0, this.state.cards.length - 1);
        this.renderStepBody();
        this.restoreViewportState(viewportState);
        this.refreshCardSelectionUi();
      }));
      Array.from(this.ui.stepBody.querySelectorAll('[data-card-slot]')).forEach((slot) => slot.addEventListener('click', (event) => {
        if (event.target.closest('input,textarea,select,button')) return;
        const viewportState = this.captureViewportState();
        this.state.activeCardIndex = clamp(slot.dataset.selectCard || slot.dataset.cardSlot || 0, 0, this.state.cards.length - 1);
        this.renderStepBody();
        this.restoreViewportState(viewportState);
        this.refreshCardSelectionUi();
      }));
    }

    refreshCardSelectionUi() {
      const activeIndex = this.getActiveEditorCardIndex();
      Array.from(this.ui.stepBody.querySelectorAll('[data-card-slot]')).forEach((slot) => {
        slot.classList.toggle('current', Number(slot.dataset.cardSlot || -1) === activeIndex);
      });
      Array.from(this.ui.stepBody.querySelectorAll('[data-live-card]')).forEach((button) => {
        const index = Number(button.dataset.liveCard || -1);
        button.classList.toggle('active', index === activeIndex);
        const label = button.querySelector('[data-live-card-title]');
        if (label && this.state.cards[index]) label.textContent = String(this.state.cards[index].heading || '').trim() || `Photo ${index + 1}`;
      });
    }

    refreshLiveEditorPanel() {
      const panel = this.ui.stepBody ? this.ui.stepBody.querySelector('[data-live-editor-panel]') : null;
      if (!panel) return;
      panel.outerHTML = this.renderLiveEditorPanel();
      this.refreshCardSelectionUi();
    }

    renderShareStep() {
      return `
        <div class="npf-stack">
          <div class="npf-kicker">
            <div class="npf-stack" style="gap:6px">
              <div class="npf-label">Step 4</div>
              <strong>Review Pages And Send The Full PDF</strong>
              <div class="npf-helper">Every PDF action sends the entire finished flyer, not just the page you are looking at in preview.</div>
            </div>
          </div>
          <div class="npf-summary-grid">
            <div class="npf-stat"><div class="npf-stat-value">${this.getIncludedCards().length}</div><div class="npf-stat-label">Rows Included</div></div>
            <div class="npf-stat"><div class="npf-stat-value">${this.getCardsPerPage()}</div><div class="npf-stat-label">Cards Per Page</div></div>
            <div class="npf-stat"><div class="npf-stat-value">${this.getPageCount()}</div><div class="npf-stat-label">Flyer Pages</div></div>
          </div>
          <ul class="npf-share-list">
            <li>The preview is page-by-page, but the PDF export always includes the full build result.</li>
            <li>Email PDF and Share PDF both work from the complete flyer, including every page and the footer logo.</li>
            <li>Save Progress keeps the current flyer draft on this device so you can come back and finish it later.</li>
          </ul>
          <div class="npf-actions">
            <button type="button" class="npf-btn npf-primary" data-action="pdf">Download PDF</button>
            <button type="button" class="npf-btn npf-secondary" data-action="message">Share PDF</button>
            <button type="button" class="npf-btn npf-secondary" data-action="outlook">Email PDF</button>
          </div>
        </div>`;
    }

    renderRowFilter(placeholder) {
      return `
        <label class="npf-row-filter">
          <input class="npf-input" data-field="rowFilter" value="${this.escape(this.state.rowFilter)}" placeholder="${this.escape(placeholder)}">
          <span class="count">${this.getIncludedCards().length} on flyer</span>
        </label>`;
    }

    renderCardEditorCards(mode) {
      const filteredCards = this.getFilteredEditorCards();
      if (!filteredCards.length) return `<div class="npf-photo-empty">No rows match that search.</div>`;
      return filteredCards.map(({ card, index }) => this.buildCardMarkup(card, index, mode)).join('');
    }

    buildCardHelperText(card) {
      const count = Array.isArray(card.photoOptions) ? card.photoOptions.length : 0;
      return `${count} saved photo${count === 1 ? '' : 's'} - Tap a thumbnail to switch the flyer image, or add this row again to use another saved photo.`;
    }


    buildCardMarkup(card, index, mode) {
      const thumbStyle = card.imageSrc ? `background-image:url('${String(card.imageSrc || '').replace(/'/g, '%27')}');color:transparent;` : '';
      const photoRail = card.photoOptions.length
        ? `<div class="npf-photo-picker"><div class="npf-label" style="color:#0f7a4f">Row Photos</div><div class="npf-photo-rail">${card.photoOptions.map((option, optionIndex) => `<button type="button" class="npf-photo-option ${card.selectedPhotoIndex === optionIndex ? 'active' : ''}" data-photo-option="${index}:${optionIndex}" title="${this.escape(option.displayName || option.name || `Photo ${optionIndex + 1}`)}"><div class="npf-photo-mini" style="background-image:url('${String(option.src || '').replace(/'/g, '%27')}')"></div><div class="npf-photo-caption">${this.escape(option.displayName || option.name || `Photo ${optionIndex + 1}`)}</div></button>`).join('')}</div><div class="npf-actions" style="margin-top:10px"><button type="button" class="npf-btn npf-secondary" data-duplicate-card="${index}">Add Another Photo From This Row</button></div></div>`
        : `<div class="npf-photo-empty">No saved row photos yet for this flyer item.</div>`;
      const cardsFields = mode === 'cards'
        ? `
          <div class="npf-editor-grid">
            <label class="npf-label wide">Text Below Photo<input class="npf-input" data-card="heading" data-index="${index}" value="${this.escape(card.heading)}"></label>
            <label class="npf-label">Subtext<textarea class="npf-textarea" data-card="subheading" data-index="${index}">${this.escape(card.subheading)}</textarea></label>
            <label class="npf-label">Notes / Details<textarea class="npf-textarea" data-card="note" data-index="${index}">${this.escape(card.note)}</textarea></label>
          </div>`
        : `
          <div class="npf-stack" style="margin-top:12px">
            <div>
              <div class="npf-label" style="margin-bottom:8px">Price Placement</div>
              <div class="npf-editor-grid">
                <label class="npf-label">Price<input class="npf-input" data-card="price" data-index="${index}" value="${this.escape(card.price || '')}" placeholder="$19.99"></label>
                <label class="npf-label">Price Spot<select class="npf-select" data-card="pricePosition" data-index="${index}"><option value="top-left" ${String(card.pricePosition || 'top-right') === 'top-left' ? 'selected' : ''}>Top Left</option><option value="top-right" ${String(card.pricePosition || 'top-right') === 'top-right' ? 'selected' : ''}>Top Right</option><option value="bottom-left" ${String(card.pricePosition || 'top-right') === 'bottom-left' ? 'selected' : ''}>Bottom Left</option><option value="bottom-right" ${String(card.pricePosition || 'top-right') === 'bottom-right' ? 'selected' : ''}>Bottom Right</option><option value="below-title" ${String(card.pricePosition || 'top-right') === 'below-title' ? 'selected' : ''}>Below Title</option></select></label>
                <label class="npf-label">Price Size<select class="npf-select" data-card="priceSize" data-index="${index}"><option value="sm" ${String(card.priceSize || 'md') === 'sm' ? 'selected' : ''}>Small</option><option value="md" ${String(card.priceSize || 'md') === 'md' ? 'selected' : ''}>Medium</option><option value="lg" ${String(card.priceSize || 'md') === 'lg' ? 'selected' : ''}>Large</option><option value="xl" ${String(card.priceSize || 'md') === 'xl' ? 'selected' : ''}>XL</option></select></label>
                <label class="npf-label npf-range-wrap">Price X Offset<span class="npf-range-value">${this.formatRangeValue('priceOffsetX', card.priceOffsetX || 0)}</span><input type="range" min="-40" max="40" step="1" data-card="priceOffsetX" data-index="${index}" value="${Number(card.priceOffsetX || 0)}"></label>
                <label class="npf-label npf-range-wrap">Price Y Offset<span class="npf-range-value">${this.formatRangeValue('priceOffsetY', card.priceOffsetY || 0)}</span><input type="range" min="-40" max="40" step="1" data-card="priceOffsetY" data-index="${index}" value="${Number(card.priceOffsetY || 0)}"></label>
              </div>
            </div>
            <div>
              <div class="npf-label" style="margin-bottom:8px">Photo Adjustments</div>
              <div class="npf-editor-grid">
                <label class="npf-label npf-range-wrap">Brightness<span class="npf-range-value">${this.formatRangeValue('brightness', card.brightness || 100)}</span><input type="range" min="60" max="160" step="1" data-card="brightness" data-index="${index}" value="${Number(card.brightness || 100)}"></label>
                <label class="npf-label npf-range-wrap">Contrast<span class="npf-range-value">${this.formatRangeValue('contrast', card.contrast || 100)}</span><input type="range" min="60" max="160" step="1" data-card="contrast" data-index="${index}" value="${Number(card.contrast || 100)}"></label>
                <label class="npf-label npf-range-wrap">Saturation<span class="npf-range-value">${this.formatRangeValue('saturation', card.saturation || 100)}</span><input type="range" min="40" max="180" step="1" data-card="saturation" data-index="${index}" value="${Number(card.saturation || 100)}"></label>
                <label class="npf-label npf-range-wrap">Warmth<span class="npf-range-value">${this.formatRangeValue('warmth', card.warmth || 0)}</span><input type="range" min="-30" max="30" step="1" data-card="warmth" data-index="${index}" value="${Number(card.warmth || 0)}"></label>
                <label class="npf-label npf-range-wrap">Background Blur<span class="npf-range-value">${this.formatRangeValue('backgroundBlur', card.backgroundBlur || 0)}</span><input type="range" min="0" max="40" step="1" data-card="backgroundBlur" data-index="${index}" value="${Number(card.backgroundBlur || 0)}"></label>
                <label class="npf-label npf-range-wrap">Focus Window<span class="npf-range-value">${this.formatRangeValue('focusArea', card.focusArea || 62)}</span><input type="range" min="40" max="90" step="1" data-card="focusArea" data-index="${index}" value="${Number(card.focusArea || 62)}"></label>
                <label class="npf-label npf-range-wrap">Photo Size<span class="npf-range-value">${this.formatRangeValue('imageZoom', card.imageZoom || 100)}</span><input type="range" min="60" max="220" step="1" data-card="imageZoom" data-index="${index}" value="${Number(card.imageZoom || 100)}"></label>
                <label class="npf-label npf-range-wrap">Move Left / Right<span class="npf-range-value">${this.formatRangeValue('imageOffsetX', card.imageOffsetX || 0)}</span><input type="range" min="-40" max="40" step="1" data-card="imageOffsetX" data-index="${index}" value="${Number(card.imageOffsetX || 0)}"></label>
                <label class="npf-label npf-range-wrap wide">Move Up / Down<span class="npf-range-value">${this.formatRangeValue('imageOffsetY', card.imageOffsetY || 0)}</span><input type="range" min="-40" max="40" step="1" data-card="imageOffsetY" data-index="${index}" value="${Number(card.imageOffsetY || 0)}"></label>
              </div>
            </div>
          </div>`;
      return `
        <div class="npf-slot ${card.enabled ? '' : 'off'}" data-card-slot="${index}">
          <div class="npf-slot-head">
            <div class="npf-slot-meta">
              <div class="npf-slot-badge">Row ${index + 1}</div>
              <div class="npf-slot-title" data-card-title="${index}">${this.escape(card.heading || `Photo ${index + 1}`)}</div>
              <div class="npf-helper" data-card-helper="${index}">${this.escape(this.buildCardHelperText(card))}</div>
            </div>
            <button type="button" class="npf-btn ${card.enabled ? 'npf-primary' : 'npf-muted'}" data-toggle-card="${index}" data-card-toggle="${index}">${card.enabled ? 'Included' : 'Hidden'}</button>
          </div>
          <div class="npf-thumb" data-card-thumb="${index}" style="${thumbStyle}">${card.imageSrc ? this.escape(card.imageName || `Photo ${index + 1}`) : 'Pick a saved row photo below'}</div>
          <div class="npf-thumb-caption" data-card-caption="${index}">${this.escape(card.imageName || 'Tap the exact saved row photo you want on the flyer.')}</div>
          ${photoRail}
          ${cardsFields}
        </div>`;
    }


    bindStepEvents() {
      const bindFieldInput = (selector, handler) => Array.from(this.ui.stepBody.querySelectorAll(selector)).forEach((node) => {
        node.addEventListener('input', handler);
        node.addEventListener('change', handler);
      });

      bindFieldInput('[data-field]', (event) => {
        const target = event.currentTarget;
        const key = String(target.dataset.field || '').trim();
        this.state[key] = target.value;
        this.clampPageIndex();
        const viewportState = this.captureViewportState(target);
        this.queuePersistState();
        if (key === 'rowFilter') {
          const snapshot = this.captureFocusState(target);
          this.renderUi();
          this.restoreViewportState(viewportState);
          this.restoreFocusState(snapshot);
          this.scheduleRender(true, viewportState);
          return;
        }
        this.scheduleRender(false, viewportState);
      });

      Array.from(this.ui.stepBody.querySelectorAll('[data-layout-preset]')).forEach((button) => button.addEventListener('click', () => this.applyLayoutPreset(button.dataset.layoutPreset)));

      const buildSegmented = (target, values, current, attr) => {
        if (!target) return;
        target.innerHTML = values.map((entry) => `<button type="button" class="npf-btn ${String(entry.value) === String(current) ? 'npf-primary active' : 'npf-muted'}" data-${attr}="${this.escape(entry.value)}">${this.escape(entry.label)}</button>`).join('');
      };

      buildSegmented(this.ui.stepBody.querySelector('[data-columns]'), [{ value: 1, label: '1 Col' }, { value: 2, label: '2 Col' }, { value: 3, label: '3 Col' }], this.state.columns, 'columns');
      buildSegmented(this.ui.stepBody.querySelector('[data-rows]'), [{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }, { value: 5, label: '5' }, { value: 6, label: '6' }], this.state.rowsPerPage, 'rows');
      buildSegmented(this.ui.stepBody.querySelector('[data-logo-toggle]'), [{ value: 'on', label: 'Show' }, { value: 'off', label: 'Hide' }], this.state.showLogo ? 'on' : 'off', 'logoToggle');
      buildSegmented(this.ui.stepBody.querySelector('[data-fit]'), [{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }], this.state.photoFit, 'fit');
      buildSegmented(this.ui.stepBody.querySelector('[data-card-style]'), [{ value: 'soft', label: 'Soft' }, { value: 'outline', label: 'Outline' }, { value: 'flat', label: 'Flat' }], this.state.cardStyle, 'cardStyle');

      const rerenderWithCanvas = () => {
        this.renderUi();
        this.scrollPreviewToTop();
        this.scheduleRender(true);
      };

      Array.from(this.ui.stepBody.querySelectorAll('[data-columns] button[data-columns]')).forEach((button) => button.addEventListener('click', () => {
        this.state.columns = clamp(button.dataset.columns || 2, 1, 3);
        this.clampPageIndex();
        this.queuePersistState();
        rerenderWithCanvas();
      }));
      Array.from(this.ui.stepBody.querySelectorAll('[data-rows] button[data-rows]')).forEach((button) => button.addEventListener('click', () => {
        this.state.rowsPerPage = clamp(button.dataset.rows || 4, 1, 6);
        this.clampPageIndex();
        this.queuePersistState();
        rerenderWithCanvas();
      }));
      Array.from(this.ui.stepBody.querySelectorAll('[data-logo-toggle] button[data-logo-toggle]')).forEach((button) => button.addEventListener('click', () => {
        this.state.showLogo = String(button.dataset.logoToggle) === 'on';
        this.queuePersistState();
        rerenderWithCanvas();
      }));
      Array.from(this.ui.stepBody.querySelectorAll('[data-fit] button[data-fit]')).forEach((button) => button.addEventListener('click', () => {
        this.state.photoFit = String(button.dataset.fit || 'cover');
        this.queuePersistState();
        rerenderWithCanvas();
      }));
      Array.from(this.ui.stepBody.querySelectorAll('[data-card-style] button[data-card-style]')).forEach((button) => button.addEventListener('click', () => {
        this.state.cardStyle = String(button.dataset.cardStyle || 'soft');
        this.queuePersistState();
        rerenderWithCanvas();
      }));
      if (this.state.step === 'style') {
        const themeWrap = this.ui.stepBody.querySelector('[data-themes]');
        if (themeWrap) {
          themeWrap.innerHTML = Object.keys(THEMES).map((key) => {
            const theme = THEMES[key];
            return `<button type="button" class="npf-btn npf-secondary npf-theme-chip ${this.state.themeKey === key ? 'active' : ''}" data-theme="${key}" style="background:${theme.background};color:${theme.title};border-color:${theme.accent}"><span class="swatch" style="background:${theme.accent}"></span>${this.escape(key)}</button>`;
          }).join('');
          Array.from(themeWrap.querySelectorAll('[data-theme]')).forEach((button) => button.addEventListener('click', () => {
            const nextKey = button.dataset.theme;
            this.state.themeKey = nextKey;
            this.state.theme = Object.assign({}, THEMES[nextKey] || THEMES.sage);
            this.queuePersistState();
            rerenderWithCanvas();
          }));
        }
        Array.from(this.ui.stepBody.querySelectorAll('[data-color]')).forEach((input) => {
          input.value = this.state.theme[input.dataset.color] || '#ffffff';
          input.oninput = () => {
            const viewportState = this.captureViewportState(input);
            this.state.theme[input.dataset.color] = input.value;
            this.refreshLiveEditorPanel();
            this.queuePersistState();
            this.scheduleRender(false, viewportState);
          };
        });
      }

      Array.from(this.ui.stepBody.querySelectorAll('[data-photo-option]')).forEach((button) => button.addEventListener('click', () => {
        const parts = String(button.dataset.photoOption || '').split(':');
        this.selectPhotoOption(Number(parts[0] || 0), Number(parts[1] || 0));
      }));
      Array.from(this.ui.stepBody.querySelectorAll('[data-duplicate-card]')).forEach((button) => button.addEventListener('click', () => {
        this.duplicateCard(Number(button.dataset.duplicateCard || 0));
      }));
      Array.from(this.ui.stepBody.querySelectorAll('[data-toggle-card]')).forEach((button) => button.addEventListener('click', () => {
        this.toggleCardEnabled(Number(button.dataset.toggleCard || 0));
      }));
      Array.from(this.ui.stepBody.querySelectorAll('[data-card]')).forEach((field) => {
        const applyCardField = (event) => {
          const target = event.currentTarget;
          const index = Number(target.dataset.index || 0);
          if (!this.state.cards[index]) return;
          const key = String(target.dataset.card || '').trim();
          const value = target.type === 'range' ? Number(target.value) : target.value;
          this.state.cards[index][key] = value;
          if (target.type === 'range') {
            const valueLabel = target.parentElement ? target.parentElement.querySelector('.npf-range-value') : null;
            if (valueLabel) valueLabel.textContent = this.formatRangeValue(key, value);
          }
          if (key === 'heading') {
            const slotTitle = target.closest('.npf-slot') ? target.closest('.npf-slot').querySelector('.npf-slot-title') : null;
            if (slotTitle) slotTitle.textContent = String(value || '').trim() || `Photo ${index + 1}`;
          }
          this.state.activeCardIndex = index;
          this.refreshCardSelectionUi();
          this.refreshLiveEditorPanel();
          const viewportState = this.captureViewportState(target);
          this.queuePersistState();
          this.scheduleRender(false, viewportState);
        };
        field.addEventListener('input', applyCardField);
        field.addEventListener('change', applyCardField);
      });
      this.bindLiveEditorEvents();
      this.refreshCardSelectionUi();
    }

    captureFocusState(node) {
      const target = node || document.activeElement;
      if (!target || !this.ui.stepBody || !this.ui.stepBody.contains(target)) return null;
      if (target.dataset && target.dataset.field) return { selector: `[data-field="${target.dataset.field}"]`, start: target.selectionStart, end: target.selectionEnd };
      if (target.dataset && target.dataset.card && typeof target.dataset.index !== 'undefined') return { selector: `[data-card="${target.dataset.card}"][data-index="${target.dataset.index}"]`, start: target.selectionStart, end: target.selectionEnd };
      return null;
    }

    restoreFocusState(snapshot) {
      if (!snapshot || !snapshot.selector) return;
      const target = this.ui.stepBody ? this.ui.stepBody.querySelector(snapshot.selector) : null;
      if (!target) return;
      target.focus();
      if (typeof snapshot.start === 'number' && typeof target.setSelectionRange === 'function') {
        const end = typeof snapshot.end === 'number' ? snapshot.end : snapshot.start;
        target.setSelectionRange(snapshot.start, end);
      }
    }

    captureViewportState(node) {
      const doc = document.scrollingElement || document.documentElement || document.body;
      return {
        docTop: doc ? Number(doc.scrollTop || 0) : 0,
        docLeft: doc ? Number(doc.scrollLeft || 0) : 0,
        slot: this.captureSlotScrollState(),
        focus: this.captureFocusState(node)
      };
    }

    restoreViewportState(snapshot) {
      if (!snapshot) return;
      const doc = document.scrollingElement || document.documentElement || document.body;
      if (doc) {
        doc.scrollTop = Number(snapshot.docTop || 0);
        doc.scrollLeft = Number(snapshot.docLeft || 0);
      }
      this.restoreSlotScrollState(snapshot.slot);
      if (snapshot.focus) this.restoreFocusState(snapshot.focus);
    }

    captureSlotScrollState() {
      const slots = this.ui.stepBody ? this.ui.stepBody.querySelector('.npf-slots') : null;
      if (!slots) return null;
      return { top: Number(slots.scrollTop || 0), left: Number(slots.scrollLeft || 0) };
    }

    restoreSlotScrollState(snapshot) {
      if (!snapshot) return;
      const slots = this.ui.stepBody ? this.ui.stepBody.querySelector('.npf-slots') : null;
      if (!slots) return;
      slots.scrollTop = Number(snapshot.top || 0);
      slots.scrollLeft = Number(snapshot.left || 0);
    }

    refreshCardSlotUi(index) {
      const slot = this.ui.stepBody ? this.ui.stepBody.querySelector(`[data-card-slot="${index}"]`) : null;
      if (!slot || !this.state.cards[index]) return;
      const card = this.state.cards[index] = this.normalizeCard(this.state.cards[index], index);
      slot.classList.toggle('off', !card.enabled);
      const title = slot.querySelector(`[data-card-title="${index}"]`);
      if (title) title.textContent = String(card.heading || '').trim() || `Photo ${index + 1}`;
      const helper = slot.querySelector(`[data-card-helper="${index}"]`);
      if (helper) helper.textContent = this.buildCardHelperText(card);
      const toggle = slot.querySelector(`[data-card-toggle="${index}"]`);
      if (toggle) {
        toggle.textContent = card.enabled ? 'Included' : 'Hidden';
        toggle.classList.toggle('npf-primary', !!card.enabled);
        toggle.classList.toggle('npf-muted', !card.enabled);
      }
      const thumb = slot.querySelector(`[data-card-thumb="${index}"]`);
      if (thumb) {
        thumb.style.backgroundImage = card.imageSrc ? `url("${String(card.imageSrc || '').replace(/"/g, '%22')}")` : '';
        thumb.style.color = card.imageSrc ? 'transparent' : '#64748b';
        thumb.textContent = card.imageSrc ? (String(card.imageName || '').trim() || `Photo ${index + 1}`) : 'Pick a saved row photo below';
      }
      const caption = slot.querySelector(`[data-card-caption="${index}"]`);
      if (caption) caption.textContent = String(card.imageName || '').trim() || 'Tap the exact saved row photo you want on the flyer.';
      Array.from(slot.querySelectorAll('[data-photo-option]')).forEach((button) => {
        const parts = String(button.dataset.photoOption || '').split(':');
        const optionIndex = Number(parts[1] || 0);
        button.classList.toggle('active', optionIndex === Number(card.selectedPhotoIndex || -1));
      });
    }

    formatRangeValue(key, value) {
      const numeric = Number(value || 0);
      if (key === 'backgroundBlur') return `${numeric}px`;
      if (key === 'priceOffsetX' || key === 'priceOffsetY' || key === 'imageOffsetX' || key === 'imageOffsetY') return `${numeric}px`;
      if (key === 'warmth') return numeric > 0 ? `+${numeric}` : `${numeric}`;
      return `${numeric}%`;
    }

    escape(value) {
      return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    getLayoutPresetValue() {
      const match = LAYOUT_PRESETS.find((preset) => preset.columns === Number(this.state.columns || 2) && preset.rows === Number(this.state.rowsPerPage || 4));
      return match ? match.id : '';
    }

    applyLayoutPreset(presetId) {
      const preset = LAYOUT_PRESETS.find((entry) => entry.id === presetId);
      if (!preset) return;
      this.state.columns = preset.columns;
      this.state.rowsPerPage = preset.rows;
      this.clampPageIndex();
      this.queuePersistState();
      this.renderUi();
      this.render().catch(() => {});
    }

    getFilteredEditorCards() {
      const filter = String(this.state.rowFilter || '').trim().toLowerCase();
      return this.state.cards.map((card, index) => ({ card, index })).filter(({ card }) => {
        if (!filter) return true;
        return [card.heading, card.subheading, card.note, card.imageName, card.price].join(' ').toLowerCase().indexOf(filter) !== -1;
      });
    }

    getIncludedCards() {
      return this.state.cards.filter((card) => card.enabled !== false && (card.imageSrc || card.heading || card.subheading || card.note || card.price || (card.photoOptions && card.photoOptions.length)));
    }

    getRowsPerPage() {
      return clamp(this.state.rowsPerPage || 4, 1, 6);
    }

    getCardsPerPage() {
      return Math.max(1, clamp(this.state.columns || 2, 1, 3) * this.getRowsPerPage());
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
      this.state.pageIndex = clamp(this.state.pageIndex || 0, 0, maxPage);
    }
    saveProgress() {
      this.flushQueuedState(true);
      this.scheduleRender(true);
    }

    queuePersistState() {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.setSaveStatus('Draft changes pending...', 'dirty');
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.persistState(false);
      }, 320);
    }

    flushQueuedState(manual) {
      if (this.persistTimer) {
        clearTimeout(this.persistTimer);
        this.persistTimer = null;
      }
      return this.persistState(!!manual);
    }

    selectPhotoOption(slotIndex, optionIndex) {
      const index = clamp(slotIndex || 0, 0, this.state.cards.length - 1);
      const card = this.state.cards[index] = this.normalizeCard(this.state.cards[index], index);
      const option = card.photoOptions[Number(optionIndex || 0)];
      if (!option) return;
      const viewportState = this.captureViewportState();
      this.state.activeCardIndex = index;
      card.selectedPhotoIndex = Number(optionIndex || 0);
      card.imageSrc = option.src;
      card.imageName = option.name;
      card.enabled = true;
      this.queuePersistState();
      if (this.state.step === 'style') {
        this.renderStepBody();
        this.restoreViewportState(viewportState);
        this.refreshCardSelectionUi();
      } else {
        this.refreshCardSlotUi(index);
        this.restoreViewportState(viewportState);
      }
      this.refreshLiveEditorPanel();
      this.scheduleRender(false, viewportState);
    }
    duplicateCard(index) {
      const cardIndex = clamp(index || 0, 0, this.state.cards.length - 1);
      const sourceCard = this.state.cards[cardIndex] = this.normalizeCard(this.state.cards[cardIndex], cardIndex);
      const viewportState = this.captureViewportState();
      const clone = Object.assign({}, sourceCard, {
        photoOptions: (Array.isArray(sourceCard.photoOptions) ? sourceCard.photoOptions : []).map((option) => Object.assign({}, option)),
        enabled: true
      });
      if (clone.photoOptions.length > 1) {
        const nextIndex = (Number(sourceCard.selectedPhotoIndex || 0) + 1) % clone.photoOptions.length;
        clone.selectedPhotoIndex = nextIndex;
        clone.imageSrc = clone.photoOptions[nextIndex].src;
        clone.imageName = clone.photoOptions[nextIndex].name;
      }
      this.state.cards.splice(cardIndex + 1, 0, clone);
      this.normalizeCards();
      this.state.activeCardIndex = Math.min(cardIndex + 1, this.state.cards.length - 1);
      this.queuePersistState();
      this.renderStepBody();
      this.restoreViewportState(viewportState);
      this.refreshCardSelectionUi();
      this.refreshLiveEditorPanel();
      this.scheduleRender(true, viewportState);
    }


    toggleCardEnabled(index) {
      const cardIndex = clamp(index || 0, 0, this.state.cards.length - 1);
      const card = this.state.cards[cardIndex] = this.normalizeCard(this.state.cards[cardIndex], cardIndex);
      this.state.activeCardIndex = cardIndex;
      const viewportState = this.captureViewportState();
      card.enabled = card.enabled === false;
      this.clampPageIndex();
      this.queuePersistState();
      if (this.state.step === 'style') {
        this.renderStepBody();
        this.restoreViewportState(viewportState);
        this.refreshCardSelectionUi();
      } else {
        this.refreshCardSlotUi(cardIndex);
        this.restoreViewportState(viewportState);
      }
      this.refreshLiveEditorPanel();
      this.renderPageControls();
      this.scheduleRender(false, viewportState);
    }


    formatSavedTime(timestamp) {
      const date = timestamp ? new Date(timestamp) : new Date();
      if (!date || Number.isNaN(date.getTime())) return 'just now';
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }

    setSaveStatus(text, state) {
      this.saveStatusMessage = text || 'Draft ready.';
      this.saveStatusState = state || 'saved';
      if (this.ui.saveStatus) {
        this.ui.saveStatus.textContent = this.saveStatusMessage;
        this.ui.saveStatus.dataset.state = this.saveStatusState;
      }
    }

    applyPreviewZoom() {
      if (!this.ui.canvas) return;
      const zoom = clamp(this.state.previewZoom || 100, 60, 150);
      this.ui.canvas.style.width = `${zoom}%`;
      this.ui.canvas.style.maxWidth = 'none';
    }

    scrollPreviewToTop() {
      if (this.ui.previewShell) this.ui.previewShell.scrollTop = 0;
    }

    scheduleRender(immediate, viewportState) {
      if (viewportState) this.pendingViewportState = viewportState;
      const runRender = async () => {
        if (this.renderInFlight) {
          this.renderQueued = true;
          return;
        }
        this.renderInFlight = true;
        const nextViewportState = this.pendingViewportState;
        this.pendingViewportState = null;
        try {
          await this.render();
          if (nextViewportState) this.restoreViewportState(nextViewportState);
        } finally {
          this.renderInFlight = false;
          if (this.renderQueued) {
            this.renderQueued = false;
            this.scheduleRender(true);
          }
        }
      };
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
        this.renderTimer = null;
      }
      if (this.renderFrame) {
        cancelAnimationFrame(this.renderFrame);
        this.renderFrame = null;
      }
      const queueFrameRender = () => {
        this.renderFrame = requestAnimationFrame(() => {
          this.renderFrame = null;
          runRender().catch((error) => {
            if (global.console && typeof global.console.warn === 'function') global.console.warn('Native flyer render failed.', error);
          });
        });
      };
      if (immediate) {
        queueFrameRender();
        return;
      }
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null;
        queueFrameRender();
      }, this.renderDebounceMs);
    }

    persistState(manual) {
      this.normalizeCards();
      const savedAt = new Date().toISOString();
      const payload = JSON.stringify({ state: this.state, savedAt });
      try { localStorage.setItem(this.storageKey, payload); } catch (error) {}
      try { sessionStorage.setItem(this.storageKey, payload); } catch (error) {}
      this.setSaveStatus(`${manual ? 'Progress saved' : 'Auto-saved'} at ${this.formatSavedTime(savedAt)}.`, 'saved');
      return savedAt;
    }

    restorePersistedState() {
      try {
        const raw = localStorage.getItem(this.storageKey) || sessionStorage.getItem(this.storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.state && typeof parsed.state === 'object') {
          this.state = Object.assign({}, this.state, parsed.state);
          if (parsed.state.theme && typeof parsed.state.theme === 'object') this.state.theme = Object.assign({}, this.state.theme, parsed.state.theme);
        }
        if (parsed && parsed.savedAt) this.setSaveStatus(`Saved progress restored from ${this.formatSavedTime(parsed.savedAt)}.`, 'saved');
      } catch (error) {}
    }


    async getCachedImage(src) {
      const key = String(src || '').trim();
      if (!key) return null;
      if (!this.imageCache.has(key)) this.imageCache.set(key, loadImage(key).catch(() => null));
      return await this.imageCache.get(key);
    }

    async getLogoImage() {
      if (!this.logoUrl || this.state.showLogo === false) return null;
      if (!this.logoPromise) this.logoPromise = loadImage(this.logoUrl).catch(() => null);
      return await this.logoPromise;
    }

    getImagePlacement(image, frameX, frameY, frameWidth, frameHeight, card) {
      const fitMode = this.state.photoFit === 'contain' ? 'contain' : 'cover';
      const baseScale = fitMode === 'contain'
        ? Math.min(frameWidth / image.width, frameHeight / image.height)
        : Math.max(frameWidth / image.width, frameHeight / image.height);
      const zoom = clamp(card.imageZoom || 100, 60, 220) / 100;
      const scaleValue = baseScale * zoom;
      const drawWidth = image.width * scaleValue;
      const drawHeight = image.height * scaleValue;
      const overflowX = Math.max(0, drawWidth - frameWidth);
      const overflowY = Math.max(0, drawHeight - frameHeight);
      const moveX = (clamp(card.imageOffsetX || 0, -40, 40) / 80) * overflowX;
      const moveY = (clamp(card.imageOffsetY || 0, -40, 40) / 80) * overflowY;
      return {
        drawX: frameX + ((frameWidth - drawWidth) / 2) - moveX,
        drawY: frameY + ((frameHeight - drawHeight) / 2) - moveY,
        drawWidth,
        drawHeight
      };
    }

    applyWarmthOverlay(ctx, x, y, width, height, warmth) {
      const amount = clamp(warmth || 0, -30, 30);
      if (!amount) return;
      const opacity = Math.min(0.18, Math.abs(amount) / 160);
      ctx.save();
      ctx.fillStyle = amount > 0 ? `rgba(255,191,120,${opacity})` : `rgba(125,175,255,${opacity})`;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
    }

    drawImageFrame(ctx, image, frameX, frameY, frameWidth, frameHeight, card, extraBlur) {
      const placement = this.getImagePlacement(image, frameX, frameY, frameWidth, frameHeight, card);
      const filters = [
        `brightness(${clamp(card.brightness || 100, 60, 170)}%)`,
        `contrast(${clamp(card.contrast || 100, 60, 170)}%)`,
        `saturate(${clamp(card.saturation || 100, 40, 190)}%)`
      ];
      if (Number(extraBlur || 0) > 0) filters.push(`blur(${Number(extraBlur).toFixed(2)}px)`);
      ctx.save();
      ctx.filter = filters.join(' ');
      ctx.drawImage(image, placement.drawX, placement.drawY, placement.drawWidth, placement.drawHeight);
      ctx.restore();
      this.applyWarmthOverlay(ctx, frameX, frameY, frameWidth, frameHeight, card.warmth);
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

      const inner = 22 * scale;
      const imageX = x + inner;
      const imageY = y + inner;
      const imageWidth = cardWidth - (inner * 2);
      const imageHeight = Math.max(160 * scale, Math.min(cardHeight * 0.55, cardHeight - (170 * scale)));

      roundRect(ctx, imageX, imageY, imageWidth, imageHeight, 22 * scale);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#edf4ef';
      ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
      if (card.imageSrc) {
        const image = await this.getCachedImage(card.imageSrc);
        if (image) {
          const blurStrength = Math.max(0, Number(card.backgroundBlur || 0)) * 0.45 * scale;
          if (blurStrength > 0) {
            this.drawImageFrame(ctx, image, imageX, imageY, imageWidth, imageHeight, card, blurStrength);
            const focusRatio = clamp(card.focusArea || 62, 40, 90) / 100;
            const focusWidth = imageWidth * Math.min(0.96, focusRatio);
            const focusHeight = imageHeight * Math.min(0.92, focusRatio + 0.08);
            const focusX = imageX + ((imageWidth - focusWidth) / 2);
            const focusY = imageY + ((imageHeight - focusHeight) / 2);
            ctx.save();
            roundRect(ctx, focusX, focusY, focusWidth, focusHeight, 18 * scale);
            ctx.clip();
            this.drawImageFrame(ctx, image, imageX, imageY, imageWidth, imageHeight, card, 0);
            ctx.restore();
            ctx.save();
            roundRect(ctx, focusX, focusY, focusWidth, focusHeight, 18 * scale);
            ctx.lineWidth = 2 * scale;
            ctx.strokeStyle = 'rgba(255,255,255,.60)';
            ctx.shadowColor = 'rgba(15,23,42,.10)';
            ctx.shadowBlur = 16 * scale;
            ctx.stroke();
            ctx.restore();
          } else {
            this.drawImageFrame(ctx, image, imageX, imageY, imageWidth, imageHeight, card, 0);
          }
        } else {
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

      const priceText = formatPriceValue(card.price);
      const priceSizeMap = { sm: 18 * scale, md: 24 * scale, lg: 30 * scale, xl: 36 * scale };
      const priceFontSize = priceSizeMap[String(card.priceSize || 'md')] || priceSizeMap.md;
      const priceBadgeHeight = priceText ? priceFontSize + (14 * scale) : 0;
      ctx.font = `900 ${priceFontSize}px Arial`;
      const priceBadgeWidth = priceText ? Math.min(cardWidth - (inner * 2), ctx.measureText(priceText).width + (26 * scale)) : 0;
      const drawPriceBadge = (badgeX, badgeY) => {
        const minX = imageX + (10 * scale);
        const maxX = imageX + imageWidth - priceBadgeWidth - (10 * scale);
        const minY = imageY + (10 * scale);
        const maxY = imageY + imageHeight - priceBadgeHeight - (10 * scale);
        const finalX = clamp(badgeX, minX, Math.max(minX, maxX));
        const finalY = clamp(badgeY, minY, Math.max(minY, maxY));
        roundRect(ctx, finalX, finalY, priceBadgeWidth, priceBadgeHeight, 18 * scale);
        ctx.fillStyle = theme.accent;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${priceFontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(priceText, finalX + (priceBadgeWidth / 2), finalY + (priceBadgeHeight / 2));
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      };

      if (priceText && String(card.pricePosition || 'top-right') !== 'below-title') {
        let badgeX = imageX + (16 * scale);
        let badgeY = imageY + (16 * scale);
        const position = String(card.pricePosition || 'top-right');
        if (position === 'top-right' || position === 'bottom-right') badgeX = imageX + imageWidth - priceBadgeWidth - (16 * scale);
        if (position === 'bottom-left' || position === 'bottom-right') badgeY = imageY + imageHeight - priceBadgeHeight - (16 * scale);
        badgeX += Number(card.priceOffsetX || 0) * scale;
        badgeY += Number(card.priceOffsetY || 0) * scale;
        drawPriceBadge(badgeX, badgeY);
      }

      let textY = imageY + imageHeight + (28 * scale);
      const titleSize = fitTextSize(ctx, card.heading || 'Flyer Item', cardWidth - (inner * 2), Math.max(16 * scale, Math.min(34 * scale, cardHeight / 6.6)), 13 * scale, 900);
      const titleLines = wrapText(ctx, card.heading || 'Flyer Item', cardWidth - (inner * 2), cardHeight < (300 * scale) ? 2 : 3);
      ctx.fillStyle = theme.title;
      ctx.font = `900 ${titleSize}px Arial`;
      titleLines.forEach((line) => {
        ctx.fillText(line, x + inner, textY);
        textY += titleSize + (6 * scale);
      });

      if (priceText && String(card.pricePosition || 'top-right') === 'below-title') {
        drawPriceBadge(x + inner + (Number(card.priceOffsetX || 0) * scale), textY - (priceFontSize * 0.15) + (Number(card.priceOffsetY || 0) * scale));
        textY += priceBadgeHeight + (10 * scale);
      }

      if (card.subheading) {
        const subSize = Math.max(12 * scale, Math.min(19 * scale, cardHeight / 11));
        ctx.fillStyle = theme.body;
        ctx.font = `700 ${subSize}px Arial`;
        wrapText(ctx, card.subheading, cardWidth - (inner * 2), cardHeight < (320 * scale) ? 2 : 3).forEach((line) => {
          ctx.fillText(line, x + inner, textY);
          textY += subSize + (8 * scale);
        });
      }

      if (card.note) {
        textY += 4 * scale;
        const noteSize = Math.max(11 * scale, Math.min(15 * scale, cardHeight / 13));
        ctx.fillStyle = theme.accent;
        ctx.font = `900 ${noteSize}px Arial`;
        wrapText(ctx, card.note, cardWidth - (inner * 2), cardHeight < (320 * scale) ? 3 : 4).forEach((line) => {
          ctx.fillText(line, x + inner, textY);
          textY += noteSize + (7 * scale);
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
      const padding = 64 * exportScale;
      const rowsPerPage = this.getRowsPerPage();
      const gap = (rowsPerPage >= 6 ? 14 : (rowsPerPage >= 5 ? 18 : 24)) * exportScale;
      const headerHeight = (this.state.subtitle ? 226 : 192) * exportScale;
      const footerHeight = (this.state.footer || this.state.footerNote || this.state.showLogo) ? 176 * exportScale : 0;
      const usableWidth = width - (padding * 2);
      const cards = this.getPageCards(pageIndex);
      const columns = clamp(this.state.columns || 2, 1, 3);
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
      ctx.fillRect(padding + (28 * exportScale), padding + (26 * exportScale), 180 * exportScale, 12 * exportScale);

      const title = this.state.title || 'Flyer';
      const titleMaxWidth = usableWidth - (60 * exportScale) - (210 * exportScale);
      const titleSize = fitTextSize(ctx, title, titleMaxWidth, 62 * exportScale, 36 * exportScale, 900);
      ctx.fillStyle = theme.title;
      ctx.font = `900 ${titleSize}px Arial`;
      ctx.fillText(title, padding + (28 * exportScale), padding + (100 * exportScale));

      ctx.fillStyle = theme.body;
      ctx.font = `700 ${28 * exportScale}px Arial`;
      wrapText(ctx, this.state.subtitle || '', usableWidth - (56 * exportScale), 3).forEach((line, index) => {
        ctx.fillText(line, padding + (28 * exportScale), padding + (148 * exportScale) + (index * (36 * exportScale)));
      });

      ctx.fillStyle = theme.body;
      ctx.font = `900 ${18 * exportScale}px Arial`;
      const pageLabel = `PAGE ${Number(pageIndex || 0) + 1} OF ${this.getPageCount()}`;
      const labelWidth = ctx.measureText(pageLabel).width;
      ctx.fillText(pageLabel, padding + usableWidth - labelWidth - (28 * exportScale), padding + (48 * exportScale));

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

        const logoAreaWidth = this.state.showLogo ? 260 * exportScale : 0;
        const textMaxWidth = usableWidth - (56 * exportScale) - logoAreaWidth;
        ctx.fillStyle = theme.title;
        ctx.font = `900 ${30 * exportScale}px Arial`;
        ctx.fillText(this.state.footer || '', padding + (28 * exportScale), footerY + (72 * exportScale));
        ctx.fillStyle = theme.body;
        ctx.font = `700 ${20 * exportScale}px Arial`;
        wrapText(ctx, this.state.footerNote || '', textMaxWidth, 2).forEach((line, index) => {
          ctx.fillText(line, padding + (28 * exportScale), footerY + (108 * exportScale) + (index * (24 * exportScale)));
        });

        if (this.state.showLogo) {
          const logoImage = await this.getLogoImage();
          if (logoImage) {
            const logoBoxWidth = 220 * exportScale;
            const logoBoxHeight = footerHeight - (38 * exportScale);
            const logoX = padding + usableWidth - logoBoxWidth - (28 * exportScale);
            const logoY = footerY + ((footerHeight - logoBoxHeight) / 2);
            const fit = Math.min(logoBoxWidth / logoImage.width, logoBoxHeight / logoImage.height);
            const drawWidth = logoImage.width * fit;
            const drawHeight = logoImage.height * fit;
            ctx.drawImage(logoImage, logoX + ((logoBoxWidth - drawWidth) / 2), logoY + ((logoBoxHeight - drawHeight) / 2), drawWidth, drawHeight);
          }
        }
      }
    }

    async render() {
      this.clampPageIndex();
      this.applyPreviewZoom();
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
      const extension = (type || 'image/png').indexOf('jpeg') !== -1 ? 'jpg' : 'png';
      const pages = [];
      for (let pageIndex = 0; pageIndex < this.getPageCount(); pageIndex += 1) {
        const blob = await this.exportPageBlob(pageIndex, type || 'image/png', quality || 1);
        pages.push({ pageIndex, blob, fileName: `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}-page-${pageIndex + 1}.${extension}` });
      }
      return pages;
    }

    async exportPdfFile(download) {
      const pages = [];
      for (let pageIndex = 0; pageIndex < this.getPageCount(); pageIndex += 1) {
        const canvas = document.createElement('canvas');
        await this.renderPageToCanvas(canvas, pageIndex, EXPORT_SCALE);
        const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 1);
        pages.push({ width: canvas.width, height: canvas.height, bytes: new Uint8Array(await jpegBlob.arrayBuffer()) });
      }
      const blob = await buildPdfFromJpegs(pages);
      const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}.pdf`;
      if (download) {
        downloadBlob(blob, fileName);
        this.setShareStatus(`${fileName} downloaded.`);
      }
      return { blob, fileName };
    }

    async exportPdf() {
      return await this.exportPdfFile(true);
    }

    async exportPng() {
      const blob = await this.exportAsBlob('image/png', 1);
      const fileName = `${safeName(this.state.title)}-${new Date().toISOString().slice(0, 10)}-page-${this.state.pageIndex + 1}.png`;
      downloadBlob(blob, fileName);
      this.setShareStatus(`${fileName} downloaded.`);
      return { blob, fileName };
    }

    async exportAllPng() {
      const pages = await this.exportAllPageBlobs('image/png', 1);
      pages.forEach((page) => downloadBlob(page.blob, page.fileName));
      this.setShareStatus(`${pages.length} flyer page${pages.length === 1 ? '' : 's'} downloaded.`);
      return pages;
    }

    buildShareText(linkOrLinks, label) {
      const links = Array.isArray(linkOrLinks) ? linkOrLinks.filter(Boolean) : (linkOrLinks ? [linkOrLinks] : []);
      const lines = [this.state.title, this.state.subtitle, '', `Rows Included: ${this.getIncludedCards().length}`, `Cards Per Page: ${this.getCardsPerPage()}`, `Pages: ${this.getPageCount()}`];
      if (this.state.footer) lines.push(`Footer: ${this.state.footer}`);
      if (this.state.footerNote) lines.push(`Footer Note: ${this.state.footerNote}`);
      if (links.length) {
        lines.push('');
        links.forEach((link, index) => lines.push(`${label || 'Flyer PDF'}${links.length > 1 ? ` ${index + 1}` : ''}: ${link}`));
      }
      return lines.join('\n').trim();
    }

    setShareStatus(text) {
      if (this.ui.shareStatus) this.ui.shareStatus.textContent = text;
    }

    async sharePdfFile(options) {
      const opts = Object.assign({ title: this.state.title, text: this.buildShareText() }, options || {});
      const pdf = await this.exportPdfFile(false);
      if (typeof File === 'function' && navigator.share && navigator.canShare) {
        try {
          const file = new File([pdf.blob], pdf.fileName, { type: 'application/pdf' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ title: opts.title || this.state.title, text: opts.text || '', files: [file] });
            this.setShareStatus('PDF share sheet opened.');
            return Object.assign({ shared: true, file }, pdf);
          }
        } catch (error) {
          if (error && error.name === 'AbortError') {
            this.setShareStatus('Share canceled.');
            return Object.assign({ shared: false, canceled: true }, pdf);
          }
        }
      }
      return Object.assign({ shared: false }, pdf);
    }

    async sendInAppMessage(options) {
      const opts = Object.assign({ uploadFlyerBlob: this.uploadFlyerBlob, insertMessage: null, table: 'v2_chat_messages', supabaseFetchFn: this.supabaseFetchFn, subject: `${this.state.title} Flyer` }, options || {});
      const shared = await this.sharePdfFile({ title: opts.subject, text: this.buildShareText() });
      if (shared.shared) return shared;
      let pdfUrl = '';
      if (typeof opts.uploadFlyerBlob === 'function') pdfUrl = await opts.uploadFlyerBlob(shared.blob, shared.fileName, this.state);
      const messageText = this.buildShareText(pdfUrl, 'Flyer PDF');
      if (typeof opts.insertMessage === 'function') return await opts.insertMessage({ messageText, attachmentUrl: pdfUrl || '', fileName: shared.fileName, flyerState: this.state, sentBy: this.currentUser });
      if (typeof opts.supabaseFetchFn === 'function') return await opts.supabaseFetchFn(opts.table, 'POST', { message_type: 'flyer_pdf', message_text: messageText, attachment_url: pdfUrl || null, attachment_name: shared.fileName || null, created_by: this.currentUser, flyer_title: this.state.title });
      this.setShareStatus('No in-app messaging hook was configured.');
      return { messageText, pdfUrl, pdf: shared };
    }

    async openOutlookDraft(options) {
      const opts = Object.assign({ to: '', cc: '', subject: this.state.title, uploadFlyerBlob: this.uploadFlyerBlob, preferShare: true }, options || {});
      if (opts.preferShare !== false) {
        const shared = await this.sharePdfFile({ title: opts.subject || this.state.title, text: this.buildShareText() });
        if (shared.shared) return shared;
        opts.pdf = shared;
      }
      const pdf = opts.pdf || await this.exportPdfFile(false);
      let pdfUrl = '';
      if (typeof opts.uploadFlyerBlob === 'function') pdfUrl = await opts.uploadFlyerBlob(pdf.blob, pdf.fileName, this.state);
      const body = this.buildShareText(pdfUrl, 'Flyer PDF');
      const params = new URLSearchParams({ to: opts.to || '', cc: opts.cc || '', subject: opts.subject || this.state.title, body });
      const mailtoUrl = `mailto:?${params.toString()}`;
      const outlookUrl = `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
      let opened = false;
      try {
        const popup = global.open(outlookUrl, '_blank', 'noopener');
        opened = !!popup;
      } catch (error) {}
      if (!opened) global.location.href = mailtoUrl;
      this.setShareStatus('Email draft opened.');
      return { body, pdfUrl, fileName: pdf.fileName };
    }

    async handleAction(action) {
      this.flushQueuedState(false);
      if (action === 'pdf') return await this.exportPdf();
      if (action === 'png') return await this.exportPng();
      if (action === 'all') return await this.exportAllPng();
      if (action === 'message') return await this.sendInAppMessage();
      if (action === 'outlook') return await this.openOutlookDraft();
      return null;
    }
  }

  global.NativePwaFlyer = { Builder, THEMES, LAYOUT_PRESETS };
})(window);


