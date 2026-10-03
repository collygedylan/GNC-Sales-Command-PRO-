import { createAuraVoiceSession } from "../../services/auraVoiceService.js";
import { parseAuraIntent } from "../../utils/auraIntentParser.js";
import { canonicalAuraSize } from "../../utils/auraLingo.js";
import { createAuraConversation, acceptsAuraFollowUp, reduceAuraConversation } from "../../services/auraConversation.js";

const STYLE_ID = "aura-voice-widget-styles";

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
export function mountAuraWidget({ host = document.body, requestInventory, requestV2, requestLlm, bindParty, resolveOrderParty, openDraft, saveScout, openOrder, sendMessage, isAuthorized = () => false } = {}) {
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
  let partyRef = null;
  let selectedPrivacyParty = null;
  let routerSelection = null;
  const matchCache = new Map();
  const commandBudgets = new WeakMap();
  let explicitReadRetry = false;
  let completedBrowserRecognitionId = null;
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
    onTranscript: (text, metadata = {}) => {
      if (metadata.recognitionMode !== "browser" || !current()) return;
      if (completedBrowserRecognitionId === metadata.recognitionId) return;
      completedBrowserRecognitionId = metadata.recognitionId;
      const command = String(text || "").replace(/^.*?\bhey\s+aura\b[\s,:-]*/i, "").trim();
      input.value = command;
      if (command && !busy) void submitCommand(command, { source: "voice" });
    },
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

  function handleRecognition({ results = [], text = "", previewText = null, resultIndex = 0, epoch = null, recognitionId = null, recognitionMode: resultMode = null } = {}) {
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
    const fullText = resultMode === "browser" ? String(previewText ?? text).trim() : stream.text || String(text ?? "").trim();
    if (resultMode === "browser") input.value = fullText.replace(/^.*?\bhey\s+aura\b[\s,:-]*/i, "").trim();
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
    input.value = commandText;
    // Browser results are previews. The service completes the whole turn on
    // speech end, including an explicitly marked interim-only fallback.
    if (resultMode === "browser") return;
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

  function newSignal({ inventory = false, deadlineMs = inventory ? 5000 : null, operation = "inventory" } = {}) {
    commandController?.abort();
    commandController = new AbortController();
    const signal = commandController.signal;
    if (inventory || deadlineMs) {
      const controller = commandController;
      const budgetMs = Number.isFinite(deadlineMs) && deadlineMs > 0 ? deadlineMs : 5000;
      const budget = { explicitRetry: explicitReadRetry, deadlineAt: Date.now() + budgetMs, budgetMs, stage: "preparation", operation,
        requestId: globalThis.crypto?.randomUUID?.() || `aura-${Date.now().toString(36)}` };
      budget.timer = setTimeout(() => {
        controller.abort(Object.assign(new Error(operation === "llm" ? "AURA command exceeded fifteen seconds. Your command and draft are still here. Tap Retry." : "Inventory search exceeded five seconds. Your command and draft are still here. Tap Retry."),
          { name: "TimeoutError", code: "AURA_DEADLINE_EXCEEDED", stage: budget.stage }));
      }, budgetMs);
      signal.addEventListener("abort", () => clearTimeout(budget.timer), { once: true });
      commandBudgets.set(signal, budget);
      explicitReadRetry = false;
    }
    operationEpoch += 1;
    busy = true;
    session.setBusy(true);
    return signal;
  }

  // Settle even if a provider ignores cancellation; forward the signal as well.
  function awaitCommand(work, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || new DOMException("Cancelled", "AbortError"));
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve().then(() => {
        if (signal.aborted) throw signal.reason || new DOMException("Cancelled", "AbortError");
        return work();
      }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  function readOptions(signal) {
    const budget = commandBudgets.get(signal);
    return { signal, explicitRetry: budget?.explicitRetry === true, deadlineAt: budget?.deadlineAt, requestId: budget?.requestId,
      onStage: stage => { if (budget) budget.stage = stage; } };
  }

  function stripSelectedParty(text, party) {
    let safeText = String(text || "").slice(0, 2000);
    const names = [party?.customerName, party?.consigneeName, party?.label]
      .map(value => String(value || "").trim()).filter(value => value.length >= 2)
      .sort((a, b) => b.length - a.length);
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      safeText = safeText.replace(new RegExp(escaped, "ig"), "selected customer");
    }
    return safeText.trim();
  }

  function findCustomerReference(text) {
    const raw = String(text || "");
    const explicit = raw.match(/\b(?:customer|client|consignee)\s+(?:named\s+)?([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,3})/i);
    const possessive = raw.match(/\b([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,2})['’]s\b/);
    const relation = raw.match(/\b(?:for|to)\s+([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){1,3})\s*[?.!,]*$/);
    const marker = /\b(?:account|balance|credit|invoice|payment|owes?|owed|terms|order\s+(?:for|to)|request\s+(?:for|to))\b/i.test(raw);
    const candidate = String(explicit?.[1] || possessive?.[1] || relation?.[1] || "").trim();
    const generic = new Set(["open stock", "current season", "this season", "the largest", "on hand", "available stock"]);
    return { candidate: candidate && !generic.has(candidate.toLowerCase()) ? candidate : "", marker };
  }

  function privatePartySidecar(party) {
    if (!party) return null;
    return {
      customerIdentityId: String(party.customerIdentityId || ""),
      consigneeIdentityId: String(party.consigneeIdentityId || ""),
      customerName: String(party.customerName || ""),
      consigneeName: String(party.consigneeName || ""),
    };
  }

  function partyRefIsUsable(ref) {
    const expiry = String(ref || "").split(".", 1)[0];
    const expiresAt = /^\d{13}$/.test(expiry) ? Number(expiry) : 0;
    return Number.isSafeInteger(expiresAt) && expiresAt > Date.now() + 15_000;
  }

  function routerContext() {
    return {
      draftLines: conversation.lines.slice(0, 50).map(line => ({
        itemcode: String(line.itemcode || ""), commonname: String(line.commonname || ""),
        contsize: String(line.contsize || ""), locationcode: String(line.locationcode || ""), quantity: Number(line.quantity),
      })),
      selectedRows: routerSelection ? [{
        unique_id: String(routerSelection.unique_id || ""), itemcode: String(routerSelection.itemcode || ""),
        commonname: String(routerSelection.commonname || ""), contsize: String(routerSelection.contsize || ""),
        locationcode: String(routerSelection.locationcode || ""), lotcode: String(routerSelection.lotcode || ""), quantity: null,
      }] : [],
      ...(routerSelection ? {
        sku: String(routerSelection.itemcode || ""), size: String(routerSelection.contsize || ""),
        locationCode: String(routerSelection.locationcode || ""),
      } : {}),
    };
  }

  function validProductChoice(row) {
    return !!row && typeof row === "object" && !!String(row.itemcode || "").trim()
      && !!String(row.commonname || "").trim() && !!String(row.contsize || "").trim();
  }

  function validInventoryRow(row) {
    if (!validProductChoice(row)) return false;
    for (const field of ["ptravailable", "ptronhand"]) {
      if (row[field] != null && String(row[field]).trim() !== "" && !Number.isFinite(Number(row[field]))) return false;
    }
    return true;
  }

  function validLotRow(row) {
    return validInventoryRow(row) && !!String(row.unique_id || "").trim()
      && !!String(row.itemcode || "").trim();
  }

  function validVerifiedDraftLine(line) {
    return validProductChoice(line) && !!String(line.unique_id || "").trim()
      && Number.isSafeInteger(line.quantity) && line.quantity > 0
      && typeof line.ptravailable === "number" && Number.isFinite(line.ptravailable) && line.ptravailable >= line.quantity;
  }

  async function runRouterCommand(rawText, source, { legacy = false } = {}) {
    if (typeof requestLlm !== "function") throw Object.assign(new Error("AURA’s language service is not configured."), { status: 503, code: "AURA_LLM_UNAVAILABLE" });
    const activeParty = conversation.party || selectedPrivacyParty;
    if (activeParty && partyRef && !partyRefIsUsable(partyRef)) partyRef = null;
    if (activeParty && !partyRef && typeof bindParty === "function") {
      const bindingSignal = commandController?.signal;
      setMessage("Verifying the selected customer for this request…");
      const binding = await awaitCommand(() => bindParty(activeParty, readOptions(bindingSignal)), bindingSignal);
      if (!current() || bindingSignal?.aborted) return;
      if (!binding?.partyRef || !partyRefIsUsable(binding.partyRef)) throw new Error("The selected customer could not be verified. Reopen the request and choose the customer again.");
      partyRef = String(binding.partyRef);
    }
    if (activeParty && !partyRef) throw new Error("Choose a customer before adding request items.");
    const signal = commandController?.signal;
    const requestId = commandBudgets.get(signal)?.requestId;
    const textValue = activeParty ? stripSelectedParty(rawText, activeParty) : String(rawText || "").slice(0, 2000).trim();
    const body = {
      mode: "command", text: textValue, source: source === "voice" ? "voice" : "typed", turnId: requestId,
      context: routerContext(), ...(partyRef ? { partyRef, partySidecar: privatePartySidecar(activeParty) } : {}),
    };
    setMessage("AURA is checking that request…");
    const response = await awaitCommand(() => requestLlm(body, readOptions(signal)), signal);
    if (!current() || signal?.aborted) return;
    if (response?.ok !== true || response.requestId && response.requestId !== requestId) {
      throw new Error(response?.error?.message || "AURA returned an invalid command response.");
    }
    const actions = Array.isArray(response.actions) ? response.actions : [];
    if (actions.length > 5) throw new Error("AURA returned too many actions. Please narrow the request.");
    const prepared = actions.map(action => {
      if (action?.type === "choices") {
        if (!new Set(["inventory", "lot"]).has(action.kind) || !Array.isArray(action.items) || action.items.length > 100
            || action.items.length === 0 && action.complete === true
            || !action.items.every(action.kind === "inventory" ? validProductChoice : validLotRow)) {
          throw new Error("AURA returned invalid choices. No draft changed.");
        }
        return { type: "choices", kind: action.kind, items: action.items.slice(0, 5), complete: action.complete === true, hasMore: action.hasMore === true };
      }
      if (action?.type === "inventory_result") {
        const data = action.data;
        if (!new Set(["open_stock", "count", "maximum", "lot_lookup"]).has(action.operation) || !data || typeof data !== "object") {
          throw new Error("AURA returned an unsupported inventory result. No draft changed.");
        }
        if (data.rows != null && (!Array.isArray(data.rows) || data.rows.length > 100 || !data.rows.every(validInventoryRow))) {
          throw new Error("AURA returned invalid inventory rows. No draft changed.");
        }
        const total = action.operation === "maximum" ? data.winner?.total : data.total ?? data.totalAvailable;
        const trustedTotal = data.complete === true && (total != null && String(total).trim() !== "" && Number.isFinite(Number(total))
          || action.operation === "maximum" && data.winner == null);
        if (action.operation === "maximum" && data.winner != null && (!validProductChoice(data.winner)
            || data.complete === true && !Number.isFinite(Number(data.winner.total)))) {
          throw new Error("AURA returned an invalid maximum result. No draft changed.");
        }
        return { type: "inventory_result", operation: action.operation, data, trustedTotal };
      }
      if (action?.type === "draft_update" || action?.type === "draft_review") {
        const lines = action.type === "draft_update" ? action.lines : action.draft?.lines;
        if (!conversation.party || !partyRef || !Array.isArray(lines) || lines.length < 1 || lines.length > 50
            || !lines.every(validVerifiedDraftLine)) throw new Error("AURA could not verify the proposed draft lines. Your current draft is unchanged.");
        const uniqueLines = new Set(lines.map(line => `${line.itemcode}\u0000${canonicalAuraSize(line.contsize)}`));
        if (uniqueLines.size !== lines.length) throw new Error("AURA returned duplicate product lines. Your current draft is unchanged.");
        return { type: "draft_update", lines };
      }
      throw new Error("AURA returned an unsupported action. No draft changed.");
    });

    let nextConversation = conversation;
    for (const action of prepared) {
      if (action.type === "choices" && action.items.length) nextConversation = reduceAuraConversation(nextConversation, { type: "CHOICES", kind: "router", intent: { kind: action.kind }, items: action.items });
      if (action.type === "draft_update") {
        for (const line of action.lines) nextConversation = reduceAuraConversation(nextConversation, { type: "LINE_VERIFIED", line });
      }
    }
    conversation = nextConversation;
    routerSelection = null;
    const incompleteData = prepared.some(action => action.type === "choices" && !action.complete
      || action.type === "inventory_result" && action.operation !== "lot_lookup" && !action.trustedTotal);
    const reply = incompleteData
      ? "Some inventory details are incomplete, so I won’t report a total. Narrow the search or ask about an exact SKU and size."
      : String(response.reply || "I checked the current inventory.").slice(0, 1200);
    setMessage(reply);
    const numericActions = prepared.filter(action => action.type === "inventory_result" && action.operation !== "lot_lookup");
    if (!incompleteData && !numericActions.some(action => !action.trustedTotal) && response.speech) session.speak(String(response.speech).slice(0, 600));
    for (const action of prepared) {
      if (action.type === "inventory_result") {
        const data = action.data;
        pendingRows = Array.isArray(data.rows) ? data.rows.slice(0, 50) : [];
        if (pendingRows.length) showRows(pendingRows);
        if (action.operation === "maximum" && data.complete === true && data.winner && Number.isFinite(Number(data.winner.total))) {
          const winner = data.winner;
          content.append(make("p", "aura-message", `Maximum: ${winner.commonname}, ${winner.contsize}: ${formatQuantity(winner.total)}.`));
        }
        if (data.hasMore === true || data.rows?.length > 50) content.append(make("p", "aura-message", "Showing the first 50 verified rows. More matches are available in the inventory view."));
      } else if (action.type === "choices") {
        if (action.items.length) {
          pendingChoice = { kind: "router" };
          if (conversation.auraMode !== "CHOOSING") conversation = reduceAuraConversation(conversation, { type: "CHOICES", kind: "router", intent: { kind: action.kind }, items: action.items });
          renderChoiceButtons(action.items, selectChoice);
        } else setMessage("I couldn’t verify an eligible match. Your current draft is unchanged; try a more exact SKU, size, or lot code.");
        if (!action.complete) content.append(make("p", "aura-message", "These choices may be incomplete. Refine the product name or lot code before preparing a draft."));
        if (action.hasMore) content.append(make("p", "aura-message", "More matches exist. Narrow the request if your item is not shown."));
      } else if (action.type === "draft_update") {
        renderCartControls();
        setMessage(`Draft updated for ${conversation.party.label || conversation.party.customerName}. Review it when you’re ready. Nothing has been submitted.`);
      }
    }
  }

  function showCommandError(error, signal, retry = () => submitCommand(currentCommandText, { source: "retry" })) {
    if (!current() || commandController?.signal !== signal) return;
    const timeout = signal.reason?.code === "AURA_DEADLINE_EXCEEDED";
    if (signal.aborted && !timeout) return;
    const failure = timeout ? signal.reason : error;
    const budget = commandBudgets.get(signal);
    const diagnostic = { operation: budget?.operation || "inventory", requestId: failure?.requestId || budget?.requestId || "",
      durationMs: budget ? Math.max(0, Date.now() - (budget.deadlineAt - budget.budgetMs)) : 0,
      status: Number(failure?.status || 0), sqlState: /^[0-9A-Z]{5}$/.test(String(failure?.sqlState || failure?.code || "")) ? (failure.sqlState || failure.code) : null,
      timeoutStage: timeout || failure?.name === "TimeoutError" || failure?.code === "57014" || Number(failure?.status) === 504 ? budget?.stage : null };
    console.warn("AURA read failed", diagnostic);
    window.__gncOpsPilot?.captureFailure?.("aura_read", new Error(JSON.stringify(diagnostic)));
    input.value = currentCommandText;
    setMessage(failure?.message || "The inventory lookup failed. Your draft is still here. Retry when ready.");
    content.querySelectorAll(".aura-retry").forEach(node => node.remove());
    const button = make("button", "aura-action aura-retry", "Retry");
    button.type = "button";
    button.addEventListener("click", () => { if (!busy && current()) { button.remove(); explicitReadRetry = true; void retry(); } });
    content.append(button);
  }

  function finishSignal(signal) {
    clearTimeout(commandBudgets.get(signal)?.timer);
    if (commandController?.signal !== signal) return;
    busy = false;
    session.setBusy(false);
    if (recognitionMode === "browser" && !session.enabled && voiceStatus.status !== "speaking") {
      voiceStatus = { status: "idle", message: "" };
      renderStatus();
    }
    renderCartControls();
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
    const query = { operation: "match", commonName: intent.commonName, contSize: intent.contSize ? canonicalAuraSize(intent.contSize) : null,
      season: intent.season || undefined, locationCode: intent.locationCode || undefined,
      metric: metricFor(intent), openStockOnly: intent.type === "ADD_REQUEST_ITEM" || intent.openStockOnly === true };
    const key = JSON.stringify(query);
    const cached = matchCache.get(key);
    const response = cached && cached.expires > Date.now() ? cached.data : await requestData(query, signal);
    const data = response?.data ?? response;
    if (data?.complete !== true || !Array.isArray(data.rows) || data.rows.length > 5) {
      throw new Error("Matching data is incomplete. Narrow the plant name or retry; no quantity has been assumed.");
    }
    const candidates = data.rows;
    if (candidates.some(row => !row?.itemcode || !row.commonname || !row.contsize ||
        (query.contSize && canonicalAuraSize(row.contsize) !== query.contSize))) {
      throw new Error("Matching returned an invalid item identity. No item was selected.");
    }
    matchCache.set(key, { data: response, expires: Date.now() + 30_000 });
    if (matchCache.size > 50) matchCache.delete(matchCache.keys().next().value);
    const exact = data.exactMatch === true && candidates.length === 1 && candidates[0].matchKind === "exact" && !data.additionalMatches;
    const result = { kind: exact ? "match" : candidates.length ? "choose" : "none", item: candidates[0], candidates };
    if (result.kind === "choose") {
      pendingChoice = { intent };
      conversation = reduceAuraConversation(conversation, { type: "CHOICES", kind: "product", intent, items: result.candidates });
      setMessage(`${data.additionalMatches ? "More matches exist; narrow the name if yours is not shown. " : ""}Choose the exact item and size, or say a number:`);
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
      selectedPrivacyParty = null;
      partyRef = null;
      conversation = reduceAuraConversation(conversation, { type: "STARTED", party: selected });
      setMessage(`Request started for ${selected.label || selected.customerName}. What items would you like?`);
      renderCartControls();
      session.speak("Request started. What items would you like?");
      return;
    }
    if (choice.kind === "privacy-party") {
      conversation = reduceAuraConversation(conversation, { type: "CHOICE_CANCELLED" });
      selectedPrivacyParty = selected;
      partyRef = null;
      setMessage(`Selected ${selected.label || selected.customerName} locally. Repeat your inventory question; the selected name will be kept out of the AURA request.`);
      renderCartControls();
      return;
    }
    if (choice.kind === "router") {
      conversation = reduceAuraConversation(conversation, { type: "CHOICE_CANCELLED" });
      routerSelection = selected;
      const kind = choice.intent?.kind === "lot" ? `lot ${selected.lotcode || selected.unique_id}` : `${selected.commonname}, ${selected.contsize}`;
      setMessage(`Selected ${kind}. Tell AURA what you’d like to do next.`);
      renderCartControls();
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

  async function continueMatchedIntent(intent, match, parentSignal = null) {
    const signal = parentSignal || newSignal({ inventory: true });
    try {
      if (intent.type === "ADD_REQUEST_ITEM") await addVerifiedLine(intent, match, signal);
      else {
        const response = await requestData({ operation: "count", itemcode: match.itemcode, contSize: match.contsize,
          locationCode: intent.locationCode || undefined, season: intent.season || undefined,
          metric: metricFor(intent), openStockOnly: intent.openStockOnly === true, limit: 500 }, signal);
        const data = response?.data ?? response;
        if (response?.ok === false || data?.complete !== true || data.total == null || String(data.total).trim() === "" || !Number.isFinite(Number(data.total))) throw new Error(response?.error?.message || "The inventory count is incomplete, so I won’t guess.");
        const scope = `${intent.locationCode ? ` in ${intent.locationCode}` : ""} for ${intent.season || data.season || "the current season"}`;
        const kind = metricFor(intent) === "ptronhand" ? "on hand" : "available";
        const reply = `${formatQuantity(data.total)} ${match.contsize} ${match.commonname}${scope} ${kind}.`;
        setMessage(reply); session.speak(reply);
        if (Array.isArray(data.rows) && data.rows.length) { showRows(data.rows); renderCartControls(); }
      }
    } catch (error) { showCommandError(error, signal, () => continueMatchedIntent(intent, match)); }
    finally { if (!parentSignal) finishSignal(signal); }
  }

  async function reviewRequest() {
    if (busy || conversation.auraMode !== "BUILDING_REQUEST" || !conversation.party || !conversation.lines.length || typeof openDraft !== "function") { setMessage("Add an item before reviewing the request."); return; }
    const signal = newSignal({ inventory: true });
    try {
      conversation = reduceAuraConversation(conversation, { type: "REVIEW" });
      renderCartControls();
      const staged = await awaitCommand(() => openDraft({ party: conversation.party, lines: conversation.lines }, readOptions(signal)), signal);
      if (!current() || signal.aborted) return;
      if (staged?.ok === false) throw new Error(staged.message || "The request could not be staged for review.");
      const message = staged?.message || (typeof staged === "string" ? staged : "Draft opened in Bloom Picker. Review it there before submitting.");
      setMessage(message); session.speak("Draft is ready for your review. Nothing has been submitted.");
      conversation = reduceAuraConversation(conversation, { type: "HANDED_OFF" }); renderCartControls();
      partyRef = null;
      togglePanel(false);
    } catch (error) {
      if (current() && commandController?.signal === signal && (!signal.aborted || signal.reason?.code === "AURA_DEADLINE_EXCEEDED")) conversation = reduceAuraConversation(conversation, { type: "REVIEW_FAILED" });
      showCommandError(error, signal, reviewRequest);
    } finally { finishSignal(signal); }
  }

  async function requestData(body, signal) {
    if (typeof requestV2 !== "function") throw new Error("The inventory intelligence service is not connected.");
    const ownerSignal = signal || commandController?.signal;
    try {
      const budget = commandBudgets.get(ownerSignal);
      if (budget) { budget.operation = body.operation; budget.stage = "queue"; }
      const result = await awaitCommand(() => requestV2(body, readOptions(ownerSignal)), ownerSignal);
      if (ownerSignal?.aborted || !current() || commandController?.signal !== ownerSignal) throw new DOMException("AURA request is no longer current.", "AbortError");
      const status = Number(result?.status ?? result?.error?.status);
      const code = String(result?.code ?? result?.error?.code ?? "");
      if ([401, 403].includes(status) || code === "42501") matchCache.clear();
      return result;
    } catch (error) {
      const status = Number(error?.status ?? error?.statusCode ?? error?.context?.status);
      if ([401, 403].includes(status) || String(error?.code ?? "") === "42501") matchCache.clear();
      throw error;
    }
  }

  function metricFor(intent) { return intent.metric === "ptronhand" ? "ptronhand" : "ptravailable"; }

  async function submitCommand(rawText, { source = "typed" } = {}) {
    if (!current()) return;
    if (String(rawText || "").length > 2000) {
      setMessage("AURA commands can be up to 2,000 characters. Shorten the command and try again.");
      input.value = String(rawText || "").slice(0, 2000);
      return;
    }
    const intent = parseAuraIntent(rawText, { auraMode: conversation.auraMode });
    if (busy && intent.type !== "CANCEL_REQUEST") return;
    currentCommandText = String(rawText ?? "");
    content.querySelectorAll(".aura-retry").forEach(node => node.remove());
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
      partyRef = null;
      selectedPrivacyParty = null;
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
          selectedPrivacyParty = null;
          partyRef = null;
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
    const draftUtterance = intent.type === "ADD_REQUEST_ITEM" || /^(?:add|put|draft|request|order)\b/i.test(String(rawText || "").trim());
    if (source !== "fallback" && draftUtterance && !conversation.party) {
      setMessage("Start a Bloom Picker request and choose the customer before adding items.");
      return;
    }
    const customerReference = findCustomerReference(rawText);
    if (source !== "fallback" && customerReference.marker && (conversation.party || selectedPrivacyParty)) {
      setMessage("AURA can check inventory, but customer account, payment, invoice, and order-status details stay in the local customer workflows.");
      return;
    }
    if (source !== "fallback" && !conversation.party && !selectedPrivacyParty
        && (customerReference.marker || customerReference.candidate)) {
      if (!customerReference.candidate || typeof resolveOrderParty !== "function") {
        setMessage("Customer-related details stay local. Choose a customer with “start a request for…” before asking AURA about customer-specific inventory.");
        return;
      }
      const lookupSignal = newSignal();
      setMessage("Checking the customer picker locally. No customer details are being sent to AURA.");
      try {
        const result = await resolveOrderParty(customerReference.candidate, { signal: lookupSignal });
        if (!current() || lookupSignal.aborted) return;
        const parties = Array.isArray(result?.items) ? result.items : [];
        if (result?.hasMore || parties.length > 5) {
          setMessage("That customer name has several matches. Add more of the customer or consignee name.");
        } else if (parties.length) {
          pendingChoice = { kind: "privacy-party" };
          conversation = reduceAuraConversation(conversation, { type: "CHOICES", kind: "privacy-party", intent: {}, items: parties });
          setMessage("Choose the exact customer locally, then repeat the inventory question. No customer details have been sent to AURA.");
          renderChoiceButtons(parties, selectChoice);
        } else {
          setMessage("I couldn’t match that customer locally, so I didn’t send this customer-related request to AURA. Start a request and choose a customer first.");
        }
      } catch (error) { if (!lookupSignal.aborted) setMessage(error?.message || "The customer picker could not verify that name. No customer details were sent."); }
      finally { finishSignal(lookupSignal); }
      return;
    }
    const shouldRoute = source !== "fallback" && (intent.type === "unknown" || intent.type === "inventory"
      || intent.type === "CHECK_INVENTORY_COUNT" || intent.type === "ADD_REQUEST_ITEM" && !!conversation.party);
    if (shouldRoute) {
      const signal = newSignal({ deadlineMs: 15000, operation: "llm" });
      try {
        await runRouterCommand(rawText, source);
      } catch (error) {
        if (!signal.aborted && current() && commandController?.signal === signal) {
          if (Number(error?.status) === 503) {
            input.value = currentCommandText;
            setMessage(error?.message || "AURA’s language service is unavailable. You can use the standard inventory lookup instead.");
            const retry = make("button", "aura-action aura-retry", "Retry AURA");
            retry.type = "button";
            retry.addEventListener("click", () => {
              if (!busy && current()) { retry.remove(); void submitCommand(currentCommandText, { source: "retry" }); }
            }, { once: true });
            const fallback = make("button", "aura-action aura-retry", "Use standard lookup");
            fallback.type = "button";
            fallback.addEventListener("click", () => {
              if (busy || !current()) return;
              fallback.remove();
              void submitCommand(currentCommandText, { source: "fallback" });
            }, { once: true });
            content.append(retry, fallback);
          } else showCommandError(error, signal);
        }
      } finally { finishSignal(signal); }
      return;
    }
    if (intent.type === "ADD_REQUEST_ITEM" && acceptsAuraFollowUp(conversation)) {
      const signal = newSignal({ inventory: true });
      setMessage("Matching the item and checking eligible lots…");
      try {
        const match = await matchProduct(intent, signal);
        if (match && current() && !signal.aborted) await continueMatchedIntent(intent, match, signal);
      } catch (error) { showCommandError(error, signal); }
      finally { finishSignal(signal); }
      return;
    }
    if (intent.type === "CHECK_INVENTORY_MAX") {
      const signal = newSignal({ inventory: true });
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
      } catch (error) { showCommandError(error, signal); }
      finally { finishSignal(signal); }
      return;
    }
    if (intent.type === "CHECK_INVENTORY_COUNT" && requestV2) {
      const signal = newSignal({ inventory: true });
      setMessage("Matching the item in live inventory…");
      try {
        const match = await matchProduct(intent, signal);
        if (match && current() && !signal.aborted) await continueMatchedIntent(intent, match, signal);
      } catch (error) { showCommandError(error, signal); }
      finally { finishSignal(signal); }
      return;
    }
    if (typeof requestInventory !== "function") {
      setMessage("The inventory service is not connected yet. Your command is ready, but no data was requested.");
      return;
    }
    const signal = newSignal({ inventory: true });
    setMessage("Checking the live inventory…");
    try {
      const response = await awaitCommand(() => requestInventory(intent, readOptions(signal)), signal);
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
      showCommandError(error, signal);
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
    matchCache.clear();
    idempotencyKeys.clear();
    conversation = createAuraConversation();
    partyRef = null;
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
