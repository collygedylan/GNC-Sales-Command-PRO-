import { createAuraVoiceSession } from "../../services/auraVoiceService.js";
import { parseAuraIntent } from "../../utils/auraIntentParser.js";

const STYLE_ID = "aura-voice-widget-styles";
const FALLBACK = "I didn’t quite catch that, Dylan. Run that by me again?";

function formatQuantity(value) {
  if (value == null || String(value).trim() === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number) : "—";
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

const CSS = `
[data-aura-root]{--aura-bg:var(--bg-surface,#0a120e);--aura-text:var(--text-main,#f0fdf4);--aura-muted:var(--text-muted,#b7c8bd);--aura-accent:var(--accent,#22c55e);--aura-border:var(--border-subtle,rgba(34,197,94,.2));color:var(--aura-text);font:500 14px/1.45 system-ui,-apple-system,'Segoe UI',sans-serif}
[data-aura-root] *{box-sizing:border-box}
[data-aura-root] .aura-fab{position:fixed;z-index:10040;right:max(16px,env(safe-area-inset-right));bottom:calc(94px + env(safe-area-inset-bottom));width:56px;height:56px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.28);border-radius:50%;color:#f0fdf4;background:linear-gradient(145deg,rgba(16,43,29,.94),rgba(5,14,9,.96));box-shadow:0 0 0 1px rgba(255,255,255,.1) inset,0 8px 28px rgba(0,0,0,.38),0 0 20px -4px rgba(34,197,94,.3);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);cursor:pointer;transition:transform 150ms cubic-bezier(.4,0,.2,1),opacity 150ms cubic-bezier(.4,0,.2,1)}
[data-aura-root] .aura-fab:hover{transform:translateY(-2px)}[data-aura-root] .aura-fab:focus-visible,[data-aura-root] button:focus-visible,[data-aura-root] input:focus-visible{outline:3px solid #4ade80;outline-offset:2px}
[data-aura-root] .aura-orb{font-size:22px;font-weight:750;letter-spacing:-.08em;text-shadow:0 0 12px rgba(34,197,94,.55)}
[data-aura-root] .aura-panel{position:fixed;z-index:10041;right:max(12px,env(safe-area-inset-right));bottom:calc(160px + env(safe-area-inset-bottom));width:min(420px,calc(100vw - 24px));max-height:min(72dvh,720px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--aura-border);border-radius:20px;color:var(--aura-text);background:var(--aura-bg);background:linear-gradient(145deg,color-mix(in srgb,var(--aura-bg) 94%,white 6%),var(--aura-bg) 58%,color-mix(in srgb,var(--aura-bg) 94%,#16a34a 6%));box-shadow:0 0 0 1px rgba(255,255,255,.1) inset,0 18px 54px rgba(0,0,0,.5),0 0 22px -8px rgba(34,197,94,.2);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
[data-aura-root] .aura-panel[hidden]{display:none}
[data-aura-root] .aura-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--aura-border);background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,0))}
[data-aura-root] .aura-mark{display:grid;place-items:center;width:36px;height:36px;border:1px solid rgba(74,222,128,.55);border-radius:12px;color:#4ade80;font-weight:800;box-shadow:0 0 14px -5px rgba(34,197,94,.55)}
[data-aura-root] .aura-title{font-size:15px;font-weight:800;letter-spacing:.12em}[data-aura-root] .aura-status{display:block;color:var(--aura-muted);font-size:12px;letter-spacing:0;font-weight:500}
[data-aura-root] .aura-close{margin-left:auto;width:44px;height:44px;border:1px solid var(--aura-border);border-radius:12px;color:var(--aura-text);background:transparent;cursor:pointer;font-size:20px}
[data-aura-root] .aura-content{min-height:0;padding:14px;overflow:auto;overscroll-behavior:contain}
[data-aura-root] .aura-message{margin:0 0 12px;padding:11px 12px;border:1px solid var(--aura-border);border-radius:12px;background:rgba(255,255,255,.035);color:var(--aura-muted);white-space:pre-wrap}
[data-aura-root] .aura-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--aura-border)}
[data-aura-root] .aura-row>.aura-action{grid-column:1/-1}
[data-aura-root] .aura-row strong{display:block;color:var(--aura-text)}[data-aura-root] .aura-row small{display:block;color:var(--aura-muted);font-size:12px}
[data-aura-root] .aura-num{font:700 13px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
[data-aura-root] .aura-action{min-height:44px;padding:10px 14px;border:1px solid rgba(74,222,128,.65);border-radius:12px;color:var(--aura-text);background:rgba(34,197,94,.12);font:700 13px system-ui,sans-serif;cursor:pointer}
[data-aura-root] .aura-action.primary{color:#052e16;background:#4ade80;border-color:#4ade80}
[data-aura-root] .aura-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
[data-aura-root] .aura-inputbar{display:grid;grid-template-columns:minmax(0,1fr) 48px 48px;gap:8px;padding:12px;border-top:1px solid var(--aura-border);background:rgba(0,0,0,.12)}
[data-aura-root] input{width:100%;min-width:0;min-height:48px;padding:10px 12px;border:1px solid var(--aura-border);border-radius:12px;color:var(--aura-text);background:rgba(0,0,0,.16);font:16px/1.3 system-ui,sans-serif}
[data-aura-root] .aura-mic{position:relative;overflow:hidden;width:48px;height:48px;border:1px solid rgba(74,222,128,.7);border-radius:14px;color:#f0fdf4;background:rgba(34,197,94,.12);cursor:pointer}
[data-aura-root] .aura-mic[aria-pressed="true"]{box-shadow:0 0 16px -2px rgba(34,197,94,.45);background:rgba(34,197,94,.24)}
[data-aura-root] .aura-wave{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:2px;opacity:0;pointer-events:none}
[data-aura-root] .aura-mic[aria-pressed="true"] .aura-wave{opacity:1}[data-aura-root] .aura-wave i{width:2px;height:7px;border-radius:2px;background:#4ade80;animation:aura-wave 700ms ease-in-out infinite alternate}[data-aura-root] .aura-wave i:nth-child(2){animation-delay:100ms}[data-aura-root] .aura-wave i:nth-child(3){animation-delay:200ms}[data-aura-root] .aura-wave i:nth-child(4){animation-delay:300ms}[data-aura-root] .aura-wave i:nth-child(5){animation-delay:400ms}
@keyframes aura-wave{to{height:20px;opacity:.55}}
@media(prefers-reduced-motion:reduce){[data-aura-root] *,[data-aura-root] *::before,[data-aura-root] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){[data-aura-root] .aura-panel,[data-aura-root] .aura-fab{backdrop-filter:none;-webkit-backdrop-filter:none}}
`;

/** Mount after the shell has verified Dylan's native session; this module never authenticates users itself. */
export function mountAuraWidget({ host = document.body, requestInventory, saveScout, openOrder, isAuthorized = () => false } = {}) {
  if (typeof document === "undefined" || !host || !isAuthorized()) return { destroy() {} };
  let destroyed = false;
  let panelOpen = false;
  let commandController = null;
  let pendingIntent = null;
  let pendingRows = [];
  let selectedRow = null;
  let idempotencyKeys = new Map();
  let voiceStatus = { status: "idle", message: "" };
  const root = make("div");
  root.dataset.auraRoot = "";
  const fab = make("button", "aura-fab");
  fab.type = "button";
  fab.setAttribute("aria-label", "Open AURA voice assistant");
  fab.setAttribute("aria-expanded", "false");
  fab.append(make("span", "aura-orb", "A"));
  root.append(fab);
  host.append(root);

  let style = document.getElementById(STYLE_ID);
  const ownsStyle = !style;
  if (!style) {
    style = make("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.append(style);
  }

  const session = createAuraVoiceSession({
    onState: (next) => { voiceStatus = next; renderStatus(); },
    onTranscript: (transcript) => { input.value = transcript; submitCommand(transcript); },
  });

  const panel = make("section", "aura-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", "AURA assistant");
  const head = make("header", "aura-head");
  head.append(make("div", "aura-mark", "A"));
  const heading = make("div");
  heading.append(make("div", "aura-title", "AURA"));
  const status = make("small", "aura-status", "Ready when you are.");
  heading.append(status);
  head.append(heading);
  const closeButton = make("button", "aura-close", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close AURA");
  head.append(closeButton);
  const content = make("div", "aura-content");
  const message = make("p", "aura-message", "Ask about open stock, prepare a Bloom Picker order, or log a scouting issue.");
  content.append(message);
  const inputbar = make("form", "aura-inputbar");
  const input = make("input");
  input.type = "text";
  input.autocomplete = "off";
  input.placeholder = "Type a nursery command…";
  input.setAttribute("aria-label", "Type a command for AURA");
  const micButton = make("button", "aura-mic");
  micButton.type = "button";
  micButton.setAttribute("aria-label", "Start on-device voice input");
  micButton.setAttribute("aria-pressed", "false");
  micButton.append(document.createTextNode("🎙"));
  const wave = make("span", "aura-wave");
  wave.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 5; i += 1) wave.append(make("i"));
  micButton.append(wave);
  const sendButton = make("button", "aura-action primary", "Go");
  sendButton.type = "submit";
  inputbar.append(input, micButton, sendButton);
  panel.append(head, content, inputbar);
  root.append(panel);

  function setMessage(text) {
    message.textContent = text;
    content.scrollTop = content.scrollHeight;
  }

  function renderStatus() {
    micButton.setAttribute("aria-pressed", voiceStatus.status === "listening" || voiceStatus.status === "hearing" ? "true" : "false");
    if (voiceStatus.message) status.textContent = voiceStatus.message;
    else if (voiceStatus.status === "listening") status.textContent = "Listening on this device…";
    else if (voiceStatus.status === "hearing") status.textContent = "Parsing locally…";
    else if (voiceStatus.status === "starting") status.textContent = "Starting local recognition…";
    else status.textContent = "Ready when you are.";
  }

  function showRows(rows, actionLabel, onChoose) {
    content.querySelectorAll(".aura-row,.aura-actions").forEach((node) => node.remove());
    rows.forEach((row, index) => {
      const card = make("div", "aura-row");
      const details = make("div");
      const name = row.commonname || pendingIntent?.commonName || "Inventory match";
      details.append(make("strong", "", name));
      details.append(make("small", "", `${row.contsize || pendingIntent?.contSize || "Size unavailable"} · ${row.locationcode || "Location unavailable"} · Lot ${row.lotcode || "—"}`));
      const quantities = make("div", "aura-num", `AVL ${formatQuantity(row.ptravailable)}`);
      card.append(details, quantities);
      if (typeof onChoose === "function") {
        const choose = make("button", "aura-action", actionLabel);
        choose.type = "button";
        choose.addEventListener("click", () => onChoose(row, index));
        card.append(choose);
      }
      content.append(card);
    });
  }

  function current() {
    if (destroyed || !isAuthorized()) {
      destroy();
      return false;
    }
    return true;
  }

  function newSignal() {
    commandController?.abort();
    commandController = new AbortController();
    return commandController.signal;
  }

  async function submitCommand(rawText) {
    if (!current()) return;
    const intent = parseAuraIntent(rawText);
    pendingIntent = intent;
    pendingRows = [];
    selectedRow = null;
    idempotencyKeys = new Map();
    content.querySelectorAll(".aura-row,.aura-actions").forEach((node) => node.remove());
    if (intent.type === "unknown") {
      setMessage(FALLBACK);
      session.speak(FALLBACK);
      return;
    }
    if (typeof requestInventory !== "function") {
      setMessage("The inventory service is not connected yet. Your command is ready, but no data was requested.");
      return;
    }
    const signal = newSignal();
    setMessage("Checking the live inventory…");
    try {
      const response = await requestInventory(intent, { signal });
      if (!current() || signal.aborted) return;
      const data = response?.data ?? response;
      if (response?.ok === false || data?.ok === false) throw new Error(response?.error?.message || data?.error || "AURA could not verify this inventory request.");
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      pendingRows = rows;
      if (intent.type === "inventory") {
        const total = Number(data?.totalAvailable);
        if (data?.complete !== true || !Number.isFinite(total)) {
          setMessage("The inventory result is incomplete, so I’m not presenting a total. Narrow the search or try again.");
          return;
        }
        const summary = rows.length
          ? `${formatQuantity(total)} available across matching open-stock inventory. I’ve pulled the matching rows below.`
          : "No matching open-stock rows came back for that item and size.";
        setMessage(summary);
        if (data?.hasMore === true) {
          content.append(make("p", "aura-message", `Showing ${rows.length} matching rows. More rows are available in the inventory view.`));
        }
        if (rows.length) showRows(rows);
        session.speak(summary);
        return;
      }
      if (!rows.length) {
        const summary = intent.type === "order" ? "No eligible lot has enough available quantity for that order." : "I couldn’t find an exact inventory row at that location.";
        setMessage(summary);
        session.speak(summary);
        return;
      }
      const noun = intent.type === "order" ? "eligible lot" : "matching location";
      setMessage(rows.length === 1 ? `I found one ${noun}. Review the exact row below.` : `I found ${rows.length} ${noun}s. Choose the exact row before we continue.`);
      showRows(rows, intent.type === "order" ? "Review order" : "Select row", (row) => chooseRow(row));
    } catch (error) {
      if (!current() || signal.aborted) return;
      setMessage(error?.message || "The inventory check failed. No changes were made.");
    }
  }

  function chooseRow(row) {
    if (!current()) return;
    selectedRow = row;
    content.querySelectorAll(".aura-actions").forEach((node) => node.remove());
    const actions = make("div", "aura-actions");
    if (pendingIntent?.type === "order") {
      const review = make("button", "aura-action primary", "Open prefilled order for review");
      review.type = "button";
      review.addEventListener("click", async () => {
        if (!current() || typeof openOrder !== "function") return;
        try {
          const result = await openOrder(pendingIntent, row);
          if (!current()) return;
          if (result?.ok === false) throw new Error(result.message || "Bloom Picker could not prepare that draft.");
          setMessage(typeof result === "string" && result ? result : result?.message || "Order details are ready in Bloom Picker. Review them there, then submit when they look right.");
          session.speak("Order draft is staged. Give it a quick review, then you’re clear to submit.");
          togglePanel(false);
        } catch (error) { setMessage(error?.message || "I couldn’t open the Bloom Picker draft."); }
      });
      actions.append(review);
    } else if (pendingIntent?.type === "scout") {
      const confirmation = make("p", "aura-message", `Log “${pendingIntent.pestCode}” for ${row.commonname || pendingIntent.commonName}, ${row.contsize || pendingIntent.contSize}, ${row.locationcode || pendingIntent.locationCode}, lot ${row.lotcode || "—"}?`);
      const confirm = make("button", "aura-action primary", "Confirm scouting log");
      confirm.type = "button";
      confirm.addEventListener("click", async () => {
        if (!current() || typeof saveScout !== "function") return;
        const signal = newSignal();
        const inventoryUid = String(row.unique_id || row.source_inventory_uid || `${row.itemcode || ""}|${row.locationcode || ""}|${row.lotcode || ""}`);
        if (!idempotencyKeys.has(inventoryUid)) {
          const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
          idempotencyKeys.set(inventoryUid, `aura-scout-${requestId}`);
        }
        confirm.disabled = true;
        setMessage("Saving one scouting log for the selected row…");
        try {
          await saveScout(pendingIntent, row, { signal, idempotencyKey: idempotencyKeys.get(inventoryUid) });
          if (!current() || signal.aborted) return;
          setMessage("Scouting log sent for review. No inventory was changed.");
          session.speak("Scouting note logged for review. That row is flagged.");
          actions.remove();
        } catch (error) {
          if (!current() || signal.aborted) return;
          confirm.disabled = false;
          setMessage(error?.message || "The scouting log failed. Nothing was changed; you can retry explicitly.");
        }
      });
      actions.append(confirmation, confirm);
    }
    content.append(actions);
  }

  function togglePanel(force) {
    panelOpen = typeof force === "boolean" ? force : !panelOpen;
    if (!panelOpen) {
      commandController?.abort();
      commandController = null;
      session.stop();
    }
    panel.hidden = !panelOpen;
    fab.setAttribute("aria-expanded", String(panelOpen));
    fab.setAttribute("aria-label", panelOpen ? "Close AURA assistant" : "Open AURA voice assistant");
    if (panelOpen) input.focus({ preventScroll: true });
  }

  function onSubmit(event) {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    input.value = "";
    submitCommand(value);
  }
  function onMicClick() {
    if (!current()) return;
    if (session.listening) session.stop();
    else session.start();
  }

  fab.addEventListener("click", () => togglePanel());
  closeButton.addEventListener("click", () => togglePanel(false));
  inputbar.addEventListener("submit", onSubmit);
  micButton.addEventListener("click", onMicClick);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    commandController?.abort();
    commandController = null;
    session.destroy();
    root.remove();
    if (ownsStyle) style?.remove();
  }

  return { destroy };
}

export default mountAuraWidget;
