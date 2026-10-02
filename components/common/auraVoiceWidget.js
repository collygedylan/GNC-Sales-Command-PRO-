import { createAuraVoiceSession } from "../../services/auraVoiceService.js?v=V2026.10.01.009";
import { parseAuraIntent } from "../../utils/auraIntentParser.js?v=V2026.10.01.009";
import { matchAuraProduct, canonicalAuraSize } from "../../utils/auraLingo.js?v=V2026.10.01.009";
import { createAuraConversation, acceptsAuraFollowUp, reduceAuraConversation } from "../../services/auraConversation.js?v=V2026.10.01.009";

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
[data-aura-root] .aura-panel{position:fixed;z-index:10041;right:max(12px,env(safe-area-inset-right));bottom:calc(160px + env(safe-area-inset-bottom));width:min(420px,calc(100vw - 24px));max-height:min(72dvh,calc(100dvh - 176px - env(safe-area-inset-bottom)),720px);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--aura-border);border-radius:20px;color:var(--aura-text);background:var(--aura-bg);background:linear-gradient(145deg,color-mix(in srgb,var(--aura-bg) 94%,white 6%),var(--aura-bg) 58%,color-mix(in srgb,var(--aura-bg) 94%,#16a34a 6%));box-shadow:0 0 0 1px rgba(255,255,255,.1) inset,0 18px 54px rgba(0,0,0,.5),0 0 22px -8px rgba(34,197,94,.2);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}
[data-aura-root] .aura-panel[hidden]{display:none}
[data-aura-root] .aura-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--aura-border);background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,0))}
[data-aura-root] .aura-head>div:nth-child(2){flex:1 1 auto;min-width:0}
[data-aura-root] .aura-mark{display:grid;place-items:center;width:36px;height:36px;border:1px solid rgba(74,222,128,.55);border-radius:12px;color:#4ade80;font-weight:800;box-shadow:0 0 14px -5px rgba(34,197,94,.55)}
[data-aura-root] .aura-title{font-size:15px;font-weight:800;letter-spacing:.12em}[data-aura-root] .aura-status{display:block;color:var(--aura-muted);font-size:12px;letter-spacing:0;font-weight:500}
[data-aura-root] .aura-mode{display:inline-block;max-width:100%;margin-top:4px;padding:3px 7px;border:1px solid var(--aura-border);border-radius:999px;color:var(--aura-muted);font-size:11px;line-height:1.3;letter-spacing:0;font-weight:650;white-space:normal;overflow-wrap:anywhere}
[data-aura-root] .aura-mode[data-mode="local"]{color:var(--aura-text);border-color:rgba(34,197,94,.38)}
[data-aura-root] .aura-mode[data-mode="browser"]{color:var(--aura-text);border-color:rgba(245,158,11,.55);background:rgba(245,158,11,.08)}
[data-aura-root] .aura-close{margin-left:auto;flex:0 0 44px;min-width:44px;width:44px;height:44px;border:1px solid var(--aura-border);border-radius:12px;color:var(--aura-text);background:transparent;cursor:pointer;font-size:20px}
[data-aura-root] .aura-content{min-height:0;padding:14px;overflow:auto;overscroll-behavior:contain}
[data-aura-root] .aura-message{margin:0 0 12px;padding:11px 12px;border:1px solid var(--aura-border);border-radius:12px;background:rgba(255,255,255,.035);color:var(--aura-muted);white-space:pre-wrap}
[data-aura-root] .aura-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--aura-border)}
[data-aura-root] .aura-row>.aura-action{grid-column:1/-1}
[data-aura-root] .aura-row strong{display:block;color:var(--aura-text)}[data-aura-root] .aura-row small{display:block;color:var(--aura-muted);font-size:12px}
[data-aura-root] .aura-num{display:grid;gap:3px;font:700 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
[data-aura-root] .aura-action{min-height:44px;padding:10px 14px;border:1px solid rgba(74,222,128,.65);border-radius:12px;color:var(--aura-text);background:rgba(34,197,94,.12);font:700 13px system-ui,sans-serif;cursor:pointer;max-width:100%;white-space:normal;overflow-wrap:anywhere}
[data-aura-root] .aura-choice{display:block;width:100%;text-align:left;margin:6px 0}
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
export function mountAuraWidget({ host = document.body, requestInventory, requestV2, resolveOrderParty, openDraft, saveScout, openOrder, sendMessage, isAuthorized = () => false } = {}) {
  if (typeof document === "undefined" || !host || !isAuthorized()) return { destroy() {} };
  let destroyed = false;
  let panelOpen = false;
  let commandController = null;
  let pendingIntent = null;
  let pendingRows = [];
  let selectedRow = null;
  let pendingChoice = null;
  let currentCommandText = "";
  let idempotencyKeys = new Map();
  let wakeArmed = false;
  let recognitionEpoch = null;
  let lastConsumedResultIndex = -1;
  let conversation = createAuraConversation();
  let catalogCache = null;
  let catalogCacheAt = 0;
  let busy = false;
  let operationEpoch = 0;
  let inactivityTimer = null;
  let voiceStatus = { status: "idle", message: "" };
  let recognitionMode = null;
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
    onState: (next) => {
      voiceStatus = next;
      if (Object.prototype.hasOwnProperty.call(next || {}, "recognitionMode")) {
        if (next.recognitionMode === "local" || next.recognitionMode === "browser") {
          recognitionMode = next.recognitionMode;
        }
      }
      renderVoiceMode();
      renderStatus();
    },
    onRecognition: handleRecognition,
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
  const voiceMode = make("small", "aura-mode", "Voice input mode not selected");
  voiceMode.setAttribute("aria-live", "polite");
  voiceMode.setAttribute("aria-atomic", "true");
  heading.append(voiceMode);
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
  micButton.setAttribute("aria-label", "Start voice input");
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

  function renderVoiceMode() {
    if (recognitionMode === "local") {
      voiceMode.textContent = "On-device speech";
      voiceMode.dataset.mode = "local";
    } else if (recognitionMode === "browser") {
      voiceMode.textContent = "Browser speech — tap per command · may use network";
      voiceMode.dataset.mode = "browser";
    } else {
      voiceMode.textContent = "Voice input mode not selected";
      voiceMode.dataset.mode = "unknown";
    }
  }

  function renderStatus() {
    const micOpen = session.enabled && (voiceStatus.status === "listening" || voiceStatus.status === "hearing");
    micButton.setAttribute("aria-pressed", micOpen ? "true" : "false");
    const paused = voiceStatus.status === "paused" || conversation.auraMode === "PAUSED";
    micButton.setAttribute("aria-label", paused ? "Resume voice input" : session.enabled ? "Pause voice input" : "Start voice input");
    if (voiceStatus.status === "idle" && recognitionMode === "browser") {
      status.textContent = `Tap the microphone for your next command.${conversation.party ? " Your current draft is still here." : ""}`;
    } else if (voiceStatus.message) status.textContent = voiceStatus.message;
    else if (voiceStatus.status === "listening") status.textContent = recognitionMode === "local" ? "Listening on this device…" : recognitionMode === "browser" ? "Listening with browser speech…" : "Listening…";
    else if (voiceStatus.status === "hearing") status.textContent = "Processing speech…";
    else if (voiceStatus.status === "starting") status.textContent = recognitionMode === "local" ? "Starting on-device speech…" : recognitionMode === "browser" ? "Starting browser speech…" : "Starting voice input…";
    else if (voiceStatus.status === "restarting") status.textContent = recognitionMode === "local" ? "Reconnecting to on-device speech…" : recognitionMode === "browser" ? "Reconnecting to browser speech…" : "Reconnecting to speech…";
    else if (voiceStatus.status === "speaking") status.textContent = "AURA is responding…";
    else if (voiceStatus.status === "paused") status.textContent = "Paused while the app is hidden.";
    else if (wakeArmed) status.textContent = "AURA heard you. Say the command.";
    else status.textContent = "Ready when you are.";
  }

  function armInactivityPause() {
    if (inactivityTimer != null) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      inactivityTimer = null;
      if (current() && (session.enabled || conversation.auraMode !== "IDLE")) {
        session.stop();
        commandController?.abort();
        commandController = null;
        operationEpoch += 1;
        busy = false;
        session.setBusy(false);
        if (conversation.auraMode !== "IDLE") conversation = reduceAuraConversation(conversation, { type: "PAUSE" });
        renderCartControls();
        voiceStatus = { status: "paused", message: "Paused after two quiet minutes. Tap Resume to listen again." };
        renderStatus();
        setMessage("Paused after two quiet minutes. Tap Resume to continue your request.");
        if (!panelOpen) togglePanel(true);
      }
    }, 120_000);
  }

  function joinedResults(results) {
    const spans = [];
    let text = "";
    results.forEach((result, index) => {
      const transcript = String(result.transcript ?? "").trim();
      if (!transcript) return;
      if (text) text += " ";
      const start = text.length;
      text += transcript;
      spans.push({ start, end: text.length, isFinal: result.isFinal === true, index });
    });
    return { text, spans };
  }

  function handleRecognition({ results = [], text = "", resultIndex = 0, epoch = null, recognitionId = null, recognitionMode: resultMode = null } = {}) {
    if (!current()) return;
    epoch = recognitionId ?? epoch;
    if (recognitionEpoch !== epoch) {
      recognitionEpoch = epoch;
      lastConsumedResultIndex = -1;
      wakeArmed = false;
    }
    // SpeechRecognition repeats its accumulated result list. Work only on the
    // unconsumed suffix so replaying the same final event cannot execute twice.
    const freshStart = Math.max(0, lastConsumedResultIndex + 1);
    const freshResults = results.slice(freshStart);
    if (results.length && !freshResults.length) return;
    const stream = joinedResults(freshResults);
    const fullText = stream.text || String(text ?? "").trim();
    if (!fullText) return;

    let commandText = "";
    let commandStart = 0;
    const wakeMatch = fullText.match(/\bhey\s+aura\b[\s,:-]*/i);
    if (resultMode === "browser") {
      // A browser-mode microphone tap is the activation. Wake words are
      // optional because browser speech is one utterance per explicit tap.
      if (wakeMatch) {
        commandStart = wakeMatch.index + wakeMatch[0].length;
        commandText = fullText.slice(commandStart).trim();
      } else {
        commandText = fullText;
      }
      wakeArmed = false;
      if (!panelOpen) togglePanel(true);
    } else if (wakeMatch) {
      wakeArmed = true;
      commandStart = wakeMatch.index + wakeMatch[0].length;
      commandText = fullText.slice(commandStart).trim();
      renderStatus();
      if (!panelOpen) togglePanel(true);
    } else if (wakeArmed) {
      commandText = fullText;
      commandStart = 0;
    } else if (acceptsAuraFollowUp(conversation) || conversation.auraMode === "CHOOSING") {
      commandText = fullText;
      commandStart = 0;
    } else {
      return;
    }

    const numericChoice = conversation.auraMode === "CHOOSING" && /^[1-5]$/.test(commandText);
    if (!commandText || (commandText.length < 2 && !numericChoice)) return;
    const commandSpans = stream.spans.filter((span) => span.end > commandStart);
    if (!commandSpans.length || !commandSpans.every((span) => span.isFinal)) return;
    const recognizedIntent = parseAuraIntent(commandText, { auraMode: conversation.auraMode });
    if (busy && recognizedIntent.type !== "CANCEL_REQUEST") return;

    const finalIndexes = commandSpans.filter((span) => span.isFinal).map((span) => span.index + freshStart);
    if (finalIndexes.length) lastConsumedResultIndex = Math.max(...finalIndexes);
    wakeArmed = false;
    renderStatus();
    input.value = commandText;
    void submitCommand(commandText, { source: "voice" });
  }

  function showRows(rows, actionLabel, onChoose) {
    content.querySelectorAll(".aura-row,.aura-actions").forEach((node) => node.remove());
    rows.forEach((row, index) => {
      const card = make("div", "aura-row");
      const details = make("div");
      const name = row.commonname || pendingIntent?.commonName || "Inventory match";
      details.append(make("strong", "", name));
      details.append(make("small", "", `${row.contsize || pendingIntent?.contSize || "Size unavailable"} · ${row.locationcode || "Location unavailable"} · Lot ${row.lotcode || "—"}`));
      const quantities = make("div", "aura-num");
      quantities.append(make("span", "", `AVL ${formatQuantity(row.ptravailable)}`));
      quantities.append(make("span", "", `OH ${formatQuantity(row.ptronhand)}`));
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
    operationEpoch += 1;
    busy = true;
    session.setBusy(true);
    return commandController.signal;
  }

  function finishSignal(signal) {
    if (commandController?.signal !== signal) return;
    busy = false;
    session.setBusy(false);
    if (recognitionMode === "browser" && !session.enabled && voiceStatus.status !== "speaking") {
      voiceStatus = { status: "idle", message: "" };
      renderStatus();
    }
    renderCartControls();
  }

  async function loadAuraCatalog(signal) {
    if (catalogCache && Date.now() - catalogCacheAt < 30_000) return catalogCache;
    if (typeof requestV2 !== "function") throw new Error("The inventory intelligence service is not connected.");
    const rows = [];
    let cursor = null;
    const seenCursors = new Set();
    let complete = true;
    let season = null, salesYear = null;
    do {
      if (rows.length >= 10_000) { complete = false; break; }
      const page = await requestData({ operation: "catalog", cursor, limit: Math.min(500, 10_000 - rows.length) }, signal);
      if (!current() || signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (page?.ok === false) throw new Error(page?.error?.message || page?.message || "The inventory catalog could not be loaded.");
      const data = page?.data ?? page;
      if (!Array.isArray(data?.rows)) throw new Error("The inventory catalog response was incomplete.");
      if (data.rows.length > 500 || (data.hasMore === true && data.rows.length === 0)) complete = false;
      rows.push(...data.rows);
      complete = complete && data.complete === true;
      if (season != null && data.season != null && season !== data.season) complete = false;
      if (salesYear != null && data.salesYear != null && salesYear !== data.salesYear) complete = false;
      season = data.season ?? season;
      salesYear = data.salesYear ?? salesYear;
      if (!complete) break;
      if (!data.hasMore) break;
      if (rows.length >= 10_000) { complete = false; break; }
      cursor = data.nextCursor;
      if (!cursor) { complete = false; break; }
      const cursorKey = JSON.stringify(cursor);
      if (seenCursors.has(cursorKey)) { complete = false; break; }
      seenCursors.add(cursorKey);
    } while (rows.length < 10_000);
    if (!complete) throw new Error("The inventory catalog is incomplete. I’m not guessing at a match; narrow the item name or retry.");
    catalogCache = { rows, complete: true, season, salesYear };
    catalogCacheAt = Date.now();
    return catalogCache;
  }

  function renderChoiceButtons(items, onChoose) {
    content.querySelectorAll(".aura-choice").forEach((node) => node.remove());
    items.slice(0, 5).forEach((item, index) => {
      const label = item.label || item.customerName || `${item.commonname} · ${item.contsize} (${item.itemcode})`;
      const button = make("button", "aura-action aura-choice", `${index + 1}. ${label}`);
      button.type = "button";
      const revision = conversation.revision;
      button.addEventListener("click", () => {
        if (!current() || busy || conversation.auraMode !== "CHOOSING" || conversation.revision !== revision) {
          content.querySelectorAll(".aura-choice").forEach((node) => node.remove());
          return;
        }
        content.querySelectorAll(".aura-choice").forEach((node) => node.remove());
        onChoose(index);
      }, { once: true });
      content.append(button);
    });
  }

  function renderCartControls() {
    content.querySelectorAll(".aura-cart-controls").forEach((node) => node.remove());
    if (!conversation.party && conversation.auraMode !== "PAUSED" && conversation.auraMode !== "CHOOSING") return;
    const controls = make("div", "aura-cart-controls aura-actions");
    if (conversation.party) {
      controls.append(make("p", "aura-message", `${conversation.lines.length} request line${conversation.lines.length === 1 ? "" : "s"} for ${conversation.party.label || conversation.party.customerName}.`));
      const review = make("button", "aura-action primary", "Review request"); review.type = "button";
      review.disabled = conversation.auraMode !== "BUILDING_REQUEST" || busy;
      review.addEventListener("click", () => void reviewRequest());
      const undo = make("button", "aura-action", "Undo last item"); undo.type = "button";
      undo.disabled = conversation.auraMode !== "BUILDING_REQUEST" || busy || !conversation.history.length;
      undo.addEventListener("click", () => { conversation = reduceAuraConversation(conversation, { type: "UNDO" }); renderCartControls(); setMessage("Last item removed from the draft."); });
      controls.append(review, undo);
    }
    content.append(controls);
    if (conversation.auraMode === "PAUSED") {
      const resume = make("button", "aura-action", "Resume request"); resume.type = "button";
      resume.addEventListener("click", () => {
        if (!current() || busy) return;
        conversation = reduceAuraConversation(conversation, { type: "RESUME" });
        if (conversation.auraMode === "CHOOSING" && conversation.choice) renderChoiceButtons(conversation.choice.items, selectChoice);
        if (acceptsAuraFollowUp(conversation)) {
          void session.startIfAllowed();
          armInactivityPause();
        }
        renderCartControls();
        setMessage(conversation.auraMode === "CHOOSING" ? "Choose an option or say its number." : "Request resumed. Add another item or review it.");
      });
      controls.append(resume);
    }
    renderStatus();
  }

  async function matchProduct(intent, signal) {
    const catalog = await loadAuraCatalog(signal);
    const result = matchAuraProduct({ commonName: intent.commonName, contSize: intent.contSize }, catalog);
    if (result.kind === "choose") {
      pendingChoice = { intent };
      conversation = reduceAuraConversation(conversation, { type: "CHOICES", kind: "product", intent, items: result.candidates });
      setMessage("I found a few close plant names. Choose the exact item and size, or say a number:");
      renderChoiceButtons(result.candidates, (index) => selectChoice(index));
      renderCartControls();
      return null;
    }
    if (result.kind !== "match") throw new Error("I couldn’t match that plant name confidently. Try the exact common name.");
    return result.item;
  }

  function selectChoice(index) {
    const choice = conversation.choice;
    const selected = choice?.items?.[index];
    if (!selected || conversation.auraMode !== "CHOOSING" || busy || !current()) { setMessage("Choose one of the numbered options shown."); return; }
    const pending = pendingChoice;
    pendingChoice = null;
    if (choice.kind === "party") {
      conversation = reduceAuraConversation(conversation, { type: "STARTED", party: selected });
      setMessage(`Request started for ${selected.label || selected.customerName}. What items would you like?`);
      renderCartControls();
      session.speak("Request started. What items would you like?");
      return;
    }
    conversation = reduceAuraConversation(conversation, { type: "CHOICE_CANCELLED" });
    if (pending?.intent) void continueMatchedIntent(pending.intent, selected);
  }

  async function addVerifiedLine(intent, match, signal) {
    const existing = conversation.lines.find(line => line.itemcode === match.itemcode && canonicalAuraSize(line.contsize) === canonicalAuraSize(match.contsize));
    const cumulativeQuantity = (existing?.quantity || 0) + intent.quantity;
    const response = await requestData({ operation: "lots", itemcode: match.itemcode, contSize: match.contsize, quantity: cumulativeQuantity, metric: "ptravailable", openStockOnly: true, limit: 100 }, signal);
    const data = response?.data ?? response;
    if (response?.ok === false || data?.ok === false) throw new Error(response?.error?.message || "Eligible lots could not be checked.");
    if (data?.complete !== true) throw new Error("Lot availability is incomplete. No line was added.");
    const lots = Array.isArray(data.rows) ? data.rows.filter(row => row.ptravailable != null && String(row.ptravailable).trim() !== "" && Number.isFinite(Number(row.ptravailable)) && Number(row.ptravailable) >= cumulativeQuantity) : [];
    if (!lots.length) throw new Error(`No ${match.commonname} ${match.contsize} lot has ${cumulativeQuantity} available.`);
    const lot = lots[0];
    if (String(lot.itemcode) !== String(match.itemcode) || canonicalAuraSize(lot.contsize) !== canonicalAuraSize(match.contsize) || !lot.commonname) {
      throw new Error("The eligible lot did not match the catalog identity. No item was added.");
    }
    const line = { ...lot, quantity: cumulativeQuantity, ptravailable: Number(lot.ptravailable) };
    conversation = reduceAuraConversation(conversation, { type: "LINE_VERIFIED", line });
    renderCartControls();
    const reply = existing
      ? `Updated the request to ${cumulativeQuantity} ${match.contsize} ${match.commonname}.`
      : `Added ${intent.quantity} ${match.contsize} ${match.commonname} from ${lot.locationcode || "the selected location"}.`;
    setMessage(reply); session.speak(reply);
  }

  async function continueMatchedIntent(intent, match) {
    const signal = newSignal();
    try {
      if (intent.type === "ADD_REQUEST_ITEM") await addVerifiedLine(intent, match, signal);
      else {
        const response = await requestData({ operation: "count", itemcode: match.itemcode, contSize: match.contsize,
          locationCode: intent.locationCode || undefined, season: intent.season || undefined,
          metric: metricFor(intent), openStockOnly: intent.openStockOnly !== false, limit: 500 }, signal);
        const data = response?.data ?? response;
        if (response?.ok === false || data?.complete !== true || data.total == null || String(data.total).trim() === "" || !Number.isFinite(Number(data.total))) throw new Error(response?.error?.message || "The inventory count is incomplete, so I won’t guess.");
        const scope = `${intent.locationCode ? ` in ${intent.locationCode}` : ""} for ${intent.season || data.season || "the current season"}`;
        const kind = metricFor(intent) === "ptronhand" ? "on hand" : "available";
        const reply = `${formatQuantity(data.total)} ${match.contsize} ${match.commonname}${scope} ${kind}.`;
        setMessage(reply); session.speak(reply);
        if (Array.isArray(data.rows) && data.rows.length) { showRows(data.rows); renderCartControls(); }
      }
    } catch (error) { if (!signal.aborted) setMessage(error?.message || "AURA could not complete that request."); }
    finally { finishSignal(signal); }
  }

  async function reviewRequest() {
    if (busy || conversation.auraMode !== "BUILDING_REQUEST" || !conversation.party || !conversation.lines.length || typeof openDraft !== "function") { setMessage("Add an item before reviewing the request."); return; }
    const signal = newSignal();
    try {
      conversation = reduceAuraConversation(conversation, { type: "REVIEW" });
      renderCartControls();
      const staged = await openDraft({ party: conversation.party, lines: conversation.lines }, { signal });
      if (!current() || signal.aborted) return;
      if (staged?.ok === false) throw new Error(staged.message || "The request could not be staged for review.");
      const message = staged?.message || (typeof staged === "string" ? staged : "Draft opened in Bloom Picker. Review it there before submitting.");
      setMessage(message); session.speak("Draft is ready for your review. Nothing has been submitted.");
      conversation = reduceAuraConversation(conversation, { type: "HANDED_OFF" }); renderCartControls();
      togglePanel(false);
    } catch (error) {
      if (!signal.aborted && current()) conversation = reduceAuraConversation(conversation, { type: "REVIEW_FAILED" });
      if (!signal.aborted) setMessage(error?.message || "Draft review failed. Your request is still here.");
    } finally { finishSignal(signal); }
  }

  async function requestData(body, signal) {
    if (typeof requestV2 !== "function") throw new Error("The inventory intelligence service is not connected.");
    const ownerSignal = signal || commandController?.signal;
    try {
      const result = await requestV2(body, { signal: ownerSignal });
      if (ownerSignal?.aborted || !current() || commandController?.signal !== ownerSignal) throw new DOMException("AURA request is no longer current.", "AbortError");
      const status = Number(result?.status ?? result?.error?.status);
      const code = String(result?.code ?? result?.error?.code ?? "");
      if ([401, 403].includes(status) || code === "42501") catalogCache = null;
      return result;
    } catch (error) {
      const status = Number(error?.status ?? error?.statusCode ?? error?.context?.status);
      if ([401, 403].includes(status) || String(error?.code ?? "") === "42501") catalogCache = null;
      throw error;
    }
  }

  function metricFor(intent) { return intent.metric === "ptronhand" ? "ptronhand" : "ptravailable"; }

  async function submitCommand(rawText, { source = "typed" } = {}) {
    if (!current()) return;
    currentCommandText = String(rawText ?? "");
    const intent = parseAuraIntent(rawText, { auraMode: conversation.auraMode });
    if (busy && intent.type !== "CANCEL_REQUEST") return;
    if (intent.type === "RESUME_REQUEST") {
      conversation = reduceAuraConversation(conversation, { type: "RESUME" });
      if (conversation.auraMode === "CHOOSING" && conversation.choice) renderChoiceButtons(conversation.choice.items, selectChoice);
      renderCartControls();
      armInactivityPause();
      if (acceptsAuraFollowUp(conversation)) void session.startIfAllowed();
      setMessage(conversation.auraMode === "CHOOSING" ? "Choose an option or say its number." : conversation.auraMode === "BUILDING_REQUEST" ? "Request resumed. Add another item or say review request." : "There’s no paused request to resume.");
      return;
    }
    if (intent.type === "CHOOSE_MATCH" && conversation.auraMode === "CHOOSING") { selectChoice(intent.index); return; }
    if (intent.type !== "CHOOSE_MATCH" && pendingChoice) {
      pendingChoice = null;
      conversation = reduceAuraConversation(conversation, { type: "CHOICE_CANCELLED" });
      content.querySelectorAll(".aura-choice").forEach((node) => node.remove());
    }
    if (intent.type === "CANCEL_REQUEST") {
      commandController?.abort(); commandController = null; busy = false; operationEpoch += 1; session.setBusy(false); pendingChoice = null;
      conversation = reduceAuraConversation(conversation, { type: "CANCEL" }); renderCartControls();
      content.querySelectorAll(".aura-choice,.aura-row,.aura-actions").forEach((node) => node.remove());
      setMessage("Request cancelled. Nothing was submitted."); return;
    }
    if (busy) return;
    armInactivityPause();
    if (intent.type === "UNDO_REQUEST_ITEM") {
      conversation = reduceAuraConversation(conversation, { type: "UNDO" }); renderCartControls();
      setMessage(conversation.lines.length ? "Last item removed from the draft." : "There’s nothing left in the draft."); return;
    }
    if (intent.type === "REVIEW_REQUEST") { await reviewRequest(); return; }
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
    if (intent.type === "chat") {
      if (intent.recipientType === "department") {
        const unavailable = "Department recipients aren’t configured yet, so I didn’t send anything.";
        setMessage(unavailable);
        session.speak(unavailable);
        return;
      }
      if (typeof sendMessage !== "function") {
        setMessage("Messaging isn’t connected yet. I didn’t send anything.");
        return;
      }
      const signal = newSignal();
      const key = globalThis.crypto?.randomUUID?.() || `aura-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      setMessage(`Sending your message to ${intent.recipientName}…`);
      try {
        const response = await sendMessage(intent, { signal, idempotencyKey: key, source });
        if (!current() || signal.aborted) return;
        if (response?.ok === false) throw new Error(response.error?.message || response.message || "The message was not sent.");
        const recipient = response?.recipientName || intent.recipientName;
        const confirmation = `Message sent to ${recipient}.`;
        setMessage(confirmation);
        session.speak(confirmation);
      } catch (error) {
        if (!current() || signal.aborted) return;
        setMessage(error?.message || "The message was not sent. You can retry explicitly.");
      } finally { finishSignal(signal); }
      return;
    }
    if (intent.type === "START_REQUEST") {
      if (conversation.party) { setMessage("There’s already a request draft open. Review or cancel it before starting another."); return; }
      if (typeof resolveOrderParty !== "function") { setMessage("Bloom Picker customer lookup isn’t connected."); return; }
      const signal = newSignal();
      setMessage(`Finding ${intent.customerName}…`);
      try {
        const result = await resolveOrderParty(intent.customerName, { signal });
        if (!current() || signal.aborted) return;
        const parties = Array.isArray(result?.items) ? result.items : [];
        if (result?.hasMore || parties.length > 5) throw new Error("That customer search has more than five possible matches. Add more of the name.");
        if (!parties.length) throw new Error(`I couldn’t find an active Bloom Picker customer named ${intent.customerName}.`);
        if (parties.length === 1) {
          conversation = reduceAuraConversation(conversation, { type: "STARTED", party: parties[0] });
          const reply = `Request started for ${parties[0].label || parties[0].customerName}. What items would you like?`;
          setMessage(reply); session.speak(reply); return;
        }
        pendingChoice = { intent };
        conversation = reduceAuraConversation(conversation, { type: "CHOICES", kind: "party", intent, items: parties });
        setMessage("Choose the exact customer, or say a number:");
        renderChoiceButtons(parties, selectChoice);
      } catch (error) { if (!signal.aborted) setMessage(error?.message || "Customer lookup failed."); }
      finally { finishSignal(signal); }
      return;
    }
    if (intent.type === "ADD_REQUEST_ITEM" && acceptsAuraFollowUp(conversation)) {
      const signal = newSignal();
      setMessage("Matching the item and checking eligible lots…");
      try {
        const match = await matchProduct(intent, signal);
        if (match && current() && !signal.aborted) await continueMatchedIntent(intent, match);
      } catch (error) { if (!signal.aborted) setMessage(error?.message || "I couldn’t add that item."); }
      finally { finishSignal(signal); }
      return;
    }
    if (intent.type === "CHECK_INVENTORY_MAX") {
      const signal = newSignal();
      const metric = metricFor(intent);
      setMessage(`Checking the largest ${intent.season || "current season"} ${metric === "ptronhand" ? "on-hand" : "available"} value…`);
      try {
        const response = await requestData({ operation: "maximum", season: intent.season, locationCode: intent.locationCode || undefined, metric, openStockOnly: intent.openStockOnly, limit: 500 }, signal);
        const data = response?.data ?? response;
        if (response?.ok === false || data?.complete !== true) throw new Error(response?.error?.message || "The maximum result is incomplete.");
        const winner = data.winner;
        if (winner && (winner.total == null || String(winner.total).trim() === "" || !Number.isFinite(Number(winner.total)))) throw new Error("The maximum result did not include a verified quantity.");
        const metricLabel = metric === "ptronhand" ? "on-hand" : "available";
        const season = intent.season || data.season || "current season";
        const scope = intent.locationCode ? ` in ${intent.locationCode}` : "";
        const reply = winner ? `The largest ${season}${scope} ${metricLabel} value is ${winner.commonname}, ${winner.contsize}: ${formatQuantity(winner.total)}${Number(data.tieCount) > 1 ? `, tied with ${Number(data.tieCount) - 1} other item${Number(data.tieCount) === 2 ? "" : "s"}` : ""}.` : `No complete inventory result was available for ${season}${scope}.`;
        setMessage(reply); session.speak(reply);
      } catch (error) { if (!signal.aborted) setMessage(error?.message || "I couldn’t verify the maximum."); }
      finally { finishSignal(signal); }
      return;
    }
    if (intent.type === "CHECK_INVENTORY_COUNT" && requestV2) {
      const signal = newSignal();
      setMessage("Matching the item against the live catalog…");
      try {
        const match = await matchProduct(intent, signal);
        if (match && current() && !signal.aborted) await continueMatchedIntent(intent, match);
      } catch (error) { if (!signal.aborted) setMessage(error?.message || "The inventory check failed."); }
      finally { finishSignal(signal); }
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
    } finally { finishSignal(signal); }
  }

  function chooseRow(row) {
    if (!current() || busy) return;
    selectedRow = row;
    content.querySelectorAll(".aura-actions").forEach((node) => node.remove());
    const actions = make("div", "aura-actions");
    if (pendingIntent?.type === "order") {
      const review = make("button", "aura-action primary", "Open prefilled order for review");
      review.type = "button";
      review.addEventListener("click", async () => {
        if (!current() || busy || typeof openOrder !== "function") return;
        const signal = newSignal();
        review.disabled = true;
        try {
          const result = await openOrder(pendingIntent, row, { signal });
          if (!current() || signal.aborted) return;
          if (result?.ok === false) throw new Error(result.message || "Bloom Picker could not prepare that draft.");
          setMessage(typeof result === "string" && result ? result : result?.message || "Order details are ready in Bloom Picker. Review them there, then submit when they look right.");
          session.speak("Order draft is staged. Give it a quick review, then you’re clear to submit.");
          togglePanel(false);
        } catch (error) { if (!signal.aborted) setMessage(error?.message || "I couldn’t open the Bloom Picker draft."); }
        finally { finishSignal(signal); review.disabled = false; }
      });
      actions.append(review);
    } else if (pendingIntent?.type === "scout") {
      const confirmation = make("p", "aura-message", `Log “${pendingIntent.pestCode}” for ${row.commonname || pendingIntent.commonName}, ${row.contsize || pendingIntent.contSize}, ${row.locationcode || pendingIntent.locationCode}, lot ${row.lotcode || "—"}?`);
      const confirm = make("button", "aura-action primary", "Confirm scouting log");
      confirm.type = "button";
      confirm.addEventListener("click", async () => {
        if (!current() || busy || typeof saveScout !== "function") return;
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
        } finally { finishSignal(signal); }
      });
      actions.append(confirmation, confirm);
    }
    content.append(actions);
  }

  function togglePanel(force) {
    panelOpen = typeof force === "boolean" ? force : !panelOpen;
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
    if (!current() || busy) return;
    if (session.enabled) { session.stop(); if (inactivityTimer != null) clearTimeout(inactivityTimer); inactivityTimer = null; }
    else {
      if (conversation.auraMode === "PAUSED") conversation = reduceAuraConversation(conversation, { type: "RESUME" });
      if (conversation.auraMode === "CHOOSING" && conversation.choice) renderChoiceButtons(conversation.choice.items, selectChoice);
      renderCartControls();
      void session.start(); armInactivityPause();
    }
  }

  function onWidgetVisibilityChange() {
    if (document.visibilityState === "hidden") {
      session.stop();
      commandController?.abort();
      commandController = null;
      busy = false;
      operationEpoch += 1;
      session.setBusy(false);
      wakeArmed = false;
      if (conversation.auraMode !== "IDLE") conversation = reduceAuraConversation(conversation, { type: "PAUSE" });
      if (inactivityTimer != null) clearTimeout(inactivityTimer);
      inactivityTimer = null;
      renderCartControls();
    }
  }

  fab.addEventListener("click", () => togglePanel());
  closeButton.addEventListener("click", () => togglePanel(false));
  inputbar.addEventListener("submit", onSubmit);
  micButton.addEventListener("click", onMicClick);
  document.addEventListener("visibilitychange", onWidgetVisibilityChange);
  renderVoiceMode();
  renderStatus();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    commandController?.abort();
    commandController = null;
    operationEpoch += 1;
    busy = false;
    pendingChoice = null;
    pendingIntent = null;
    pendingRows = [];
    selectedRow = null;
    catalogCache = null;
    idempotencyKeys.clear();
    conversation = createAuraConversation();
    input.value = "";
    message.textContent = "";
    if (inactivityTimer != null) clearTimeout(inactivityTimer);
    document.removeEventListener("visibilitychange", onWidgetVisibilityChange);
    session.destroy();
    root.remove();
    if (ownsStyle) style?.remove();
  }

  return {
    destroy,
    // Starts listening only if microphone permission is already granted; it never prompts.
    startIfAllowed: () => session.startIfAllowed(),
  };
}

export default mountAuraWidget;
