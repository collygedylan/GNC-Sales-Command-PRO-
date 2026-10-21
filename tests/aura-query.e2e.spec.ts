// @test-group: @local-e2e,@release-functional,aura
import { test, expect } from '@playwright/test';

import fs from 'node:fs/promises';
import path from 'node:path';
import { readComposedAppSource } from '../scripts/composed-app-source.mjs';

test('global standby hands off to the verified voice panel and preferences stay account-owned', { tag: ['@local-e2e', '@release-functional'] }, async ({ browser }) => {
  for (const width of [320, 390, 820, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const calls: any[] = [];
    try {
      await context.addInitScript(() => {
        const state = (window as any).__auraEnterprise = { engines: [] as any[], played: 0, stopped: 0, authorized: true };
        class Recognition {
          static async available() { return 'unavailable'; }
          onstart?: () => void; onresult?: (value: any) => void; onend?: () => void;
          constructor() { state.engines.push(this); }
          start() { this.onstart?.(); } abort() {} stop() {}
        }
        (window as any).SpeechRecognition = Recognition;
        Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } });
        class AudioContext {
          state = 'running'; currentTime = 0; destination = {};
          resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
          decodeAudioData() { return Promise.resolve({ duration: .01 }); }
          createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
          createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
          createBufferSource() { return { buffer: null, onended: null, connect() {}, disconnect() {}, start() { state.played++; }, stop() { state.stopped++; } }; }
        }
        (window as any).AudioContext = AudioContext;
      });
      await context.exposeFunction('auraEnterpriseRequest', async (body: any) => {
        calls.push(body);
        if (body.mode === 'voice_preferences') return { ok: true, voiceName: body.voiceName };
        if (body.mode === 'create') return { ok: true, conversationId: 'f7120000-0000-4000-8000-000000000001', revision: 0 };
        if (body.mode === 'command') return { ok: true, conversationId: body.conversationId, revision: 2, reply: 'We currently have 420 3DP Baby Gem Boxwood in Open Stock.' };
        if (body.mode === 'speech') return { ok: true, audio: { voiceName: 'Fenrir', mimeType: 'audio/L16;codec=pcm;rate=24000', base64: 'AAAAAA==' } };
        return { ok: true, conversations: [], revision: 0 };
      });
      const page = await context.newPage();
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://aura-enterprise.test') return route.abort();
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><header><div id="aura-standby-control"></div></header><div id="aura-react-root"></div></body></html>' });
        if (url.pathname !== '/assets/aura-voice.js') return route.abort();
        return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(process.cwd(), 'assets/aura-voice.js'), 'utf8') });
      });
      await page.goto('https://aura-enterprise.test');
      await page.evaluate(async () => {
        const module = await import('/assets/aura-voice.js');
        (window as any).__auraHandle = module.mountAuraWidgetReact(document.getElementById('aura-react-root'), {
          userId: 'f7120000-0000-4000-8000-000000000001', initialVoiceName: 'Kore', voiceEngine: 'gemini-tts-v1',
          isAuthorized: () => (window as any).__auraEnterprise.authorized,
          requestAssistant: (body: any) => (window as any).auraEnterpriseRequest(body),
        });
      });
      const standby = page.getByRole('button', { name: 'Standby Mode: Off', exact: true });
      await expect(standby).toBeVisible();
      expect(await page.evaluate(() => (window as any).__auraEnterprise.engines.length)).toBe(0);
      await standby.click();
      await expect.poll(() => page.evaluate(() => (window as any).__auraEnterprise.engines.length)).toBe(1);
      await page.evaluate(() => {
        const engine = (window as any).__auraEnterprise.engines[0];
        if (!engine.continuous || !engine.interimResults) throw new Error('Global standby must use continuous interim recognition');
        const result = [{ transcript: 'hey, aura' }]; (result as any).isFinal = false;
        engine.onresult({ resultIndex: 0, results: [result] });
      });
      await expect(page.locator('.aura-panel')).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as any).__auraEnterprise.engines.length)).toBe(2);
      await page.getByRole('combobox', { name: 'AURA Voice', exact: true }).selectOption('Fenrir');
      await expect.poll(() => page.evaluate(() => (window as any).__auraHandle.getVoicePreference())).toBe('Fenrir');
      await page.evaluate(() => {
        const engine = (window as any).__auraEnterprise.engines[1];
        const result = [{ transcript: 'How many 3DP Baby Gem Boxwoods?' }]; (result as any).isFinal = true;
        engine.onresult({ resultIndex: 0, results: [result] }); engine.onend?.();
      });
      await expect(page.getByRole('log')).toContainText('420 3DP Baby Gem');
      await expect.poll(() => page.evaluate(() => (window as any).__auraEnterprise.played)).toBe(1);
      const speech = calls.find(call => call.mode === 'speech');
      expect(speech.conversationId).toBe('f7120000-0000-4000-8000-000000000001');
      expect(speech.turnId).toMatch(/^[a-f0-9-]{36}$/);
      expect(speech.text).toBeUndefined();
      const bounds = await page.locator('.aura-panel').boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      await page.evaluate(() => { (window as any).__auraEnterprise.authorized = false; (window as any).__auraHandle.destroy(); });
      await expect(page.locator('[data-aura-root]')).toHaveCount(0); await expect(page.locator('#aura-standby-control button')).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).__auraEnterprise.stopped)).toBe(1);
    } finally { await context.close(); }
  }
});


test('Aura restores private conversations across pages and hands changes to review', {"tag":["@local-e2e","@release-functional"]}, async ({ browser }) => {
  const files = new Set(['components/common/auraVoiceWidget.js', 'components/common/auraQueryPanel.js',
    'services/auraVoiceService.js', 'services/auraConversation.js', 'services/auraGeminiSpeech.js', 'utils/auraIntentParser.js', 'utils/auraLingo.js']);
  const turns: any[] = [];
  const calls: any[] = [];
  let revision = 0, deleted = false;
  const backend = async (body: any) => {
    calls.push(body);
    const base = { ok: true, conversationId: 'private-thread', revision };
    if (body.mode === 'create') return base;
    if (body.mode === 'list') return { ...base, conversations: deleted ? [] : [{ id: 'private-thread', title: 'Perennial inventory' }] };
    if (body.mode === 'read') return { ...base, turns };
    if (body.mode === 'delete') { deleted = true; turns.length = 0; return base; }
    if (body.mode === 'command') {
      expect(body.expectedRevision).toBe(revision);
      expect(body.history).toEqual(turns.slice(-6).flatMap(turn => [{ role: 'user', content: turn.text }, { role: 'assistant', content: turn.response.reply }]));
      const response = { ...base, revision: ++revision, reply: 'There are 25 available in C.06.', actions: [
        { type: 'review', view: 'tasks', proposal: { text: 'Assign item 00123 to Zoe. Nothing has been saved.' } },
      ] };
      turns.push({ text: body.text, response });
      return response;
    }
    return base;
  };
  const contexts = [];
  async function launch(width: number) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    contexts.push(context);
    const page = await context.newPage();
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://aura.test') return route.abort();
      const file = url.pathname.slice(1);
      if (!file) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
      if (!files.has(file)) return route.abort();
      return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(process.cwd(), file), 'utf8') });
    });
    await page.exposeFunction('auraTestRequest', backend);
    await page.goto('https://aura.test');
    await page.evaluate(async () => {
      const { mountAuraWidget } = await import('/components/common/auraVoiceWidget.js');
      (window as any).reviewed = [];
      mountAuraWidget({ isAuthorized: () => true, requestAssistant: (body: any) => (window as any).auraTestRequest(body),
        openAssistantAction: (action: any) => (window as any).reviewed.push(action) });
    });
    await page.getByRole('button', { name: 'Open AURA voice assistant', exact: true }).click();
    return page;
  }
  try {
    const first = await launch(390);
    await first.getByRole('textbox', { name: 'Type a command for AURA' }).fill('How many plants in the perennial area?');
    await first.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(first.getByRole('log')).toContainText('25 available');
    expect(await first.evaluate(() => (window as any).reviewed.length)).toBe(0);
    await first.getByRole('button', { name: 'Review in app' }).click();
    expect(await first.evaluate(() => (window as any).reviewed[0].view)).toBe('tasks');
    const second = await launch(1100);
    await second.getByRole('button', { name: 'Conversations', exact: true }).click();
    await second.getByRole('button', { name: 'Perennial inventory' }).click();
    await expect(second.getByRole('log')).toContainText('25 available');
    await second.getByRole('textbox', { name: 'Type a command for AURA' }).fill('only Zoe’s');
    await second.getByRole('button', { name: 'Go', exact: true }).click();
    await expect(second.getByRole('log')).toContainText('only Zoe’s');
    await second.getByRole('button', { name: 'Delete chat', exact: true }).click();
    expect(deleted).toBe(false);
    await second.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(second.locator('.aura-content')).toContainText('Conversation deleted');
    expect(deleted).toBe(true);
    expect(calls.every(body => ['create', 'list', 'read', 'delete', 'command', 'cancel'].includes(body.mode))).toBe(true);
  } finally { for (const context of contexts) await context.close(); }
});

test('Aura hands-free wakes globally, waits for final speech, and resumes after audio ownership', {"tag":["@local-e2e","@release-functional"]}, async ({ browser }) => {
  const files = new Set(['components/common/auraVoiceWidget.js', 'components/common/auraQueryPanel.js',
    'services/auraVoiceService.js', 'services/auraConversation.js', 'services/auraGeminiSpeech.js', 'utils/auraIntentParser.js', 'utils/auraLingo.js']);
  const sent: any[] = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.addInitScript(() => {
    (window as any).__auraEngines = [];
    class FakeRecognition {
      static async available() { return 'unavailable'; }
      processLocally = false;
      continuous = false;
      aborted = false;
      onstart?: () => void;
      onresult?: (event: any) => void;
      onerror?: (event: any) => void;
      onend?: () => void;
      start() { this.onstart?.(); }
      abort() { this.aborted = true; }
      stop() {}
      constructor() { (window as any).__auraEngines.push(this); }
    }
    (window as any).SpeechRecognition = FakeRecognition;
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } });
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://aura.test') return route.abort();
    const file = url.pathname.slice(1);
    if (!file) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    if (!files.has(file)) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(process.cwd(), file), 'utf8') });
  });
  await page.exposeFunction('auraVoiceSend', (intent: any) => { sent.push(intent); return { ok: true, recipientName: intent.recipientName }; });
  try {
    await page.goto('https://aura.test');
    await page.evaluate(async () => {
      const { mountAuraWidget } = await import('/components/common/auraVoiceWidget.js');
      const widget = mountAuraWidget({ userId: 'voice-user', isAuthorized: () => true,
        sendMessage: (intent: any) => (window as any).auraVoiceSend(intent) });
      (window as any).auraWidget = widget;
      const button = document.createElement('button'); button.textContent = 'Enable hands free'; button.id = 'enable-hands-free';
      button.addEventListener('click', () => widget.setHandsFreeAutoStart(true)); document.body.append(button);
    });
    await page.getByRole('button', { name: 'Enable hands free' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__auraEngines.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).__auraEngines[0].continuous)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('aura.handsFree.autostart:voice-user'))).toBe('true');
    await page.evaluate(() => {
      const result = (transcript: string, isFinal: boolean) => Object.assign([[{ transcript, confidence: .99 }]], { 0: Object.assign([{ transcript, confidence: .99 }], { isFinal }), resultIndex: 0 });
      const engine = (window as any).__auraEngines[0];
      engine.onresult({ results: result('Hey Aura, send a message to Megan saying The bay is ready', false), resultIndex: 0 });
    });
    await page.waitForTimeout(850);
    expect(sent).toHaveLength(0);
    await page.evaluate(() => {
      const entry = [{ transcript: 'Hey Aura, send a message to Megan saying The bay is ready', confidence: .99 }];
      (entry as any).isFinal = true;
      (window as any).__auraEngines[0].onresult({ results: [entry], resultIndex: 0 });
    });
    await expect.poll(() => sent.length, { timeout: 5000 }).toBe(1);
    expect(sent[0].recipientName).toBe('Megan');
    const enginesBeforeClaim = await page.evaluate(() => (window as any).__auraEngines.length);
    await page.evaluate(() => (window as any).GncAuraAudio.claim('leaf'));
    await expect.poll(() => page.evaluate(() => (window as any).__auraEngines.at(-1).aborted)).toBe(true);
    expect(await page.evaluate(() => (window as any).__auraEngines.length)).toBe(enginesBeforeClaim);
    await page.evaluate(() => (window as any).GncAuraAudio.release('leaf'));
    await expect.poll(() => page.evaluate(() => (window as any).__auraEngines.length)).toBe(enginesBeforeClaim + 1);
    expect(await page.evaluate(() => (window as any).__auraEngines.at(-1).continuous)).toBe(true);
  } finally { await context.close(); }
});

test('the React-owned Aura bundle keeps one voice session and reports processing and response states', {"tag":["@local-e2e","@release-functional"]}, async ({ browser }) => {
  const routes = new Set(['assets/aura-voice.js']);
  const contexts = [];
  const pendingCommands: Array<() => void> = [];
  const sent: any[] = [];
  async function launch(width: number) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    contexts.push(context);
    await context.addInitScript(() => {
      (window as any).__auraEngines = [];
      (window as any).__auraUtterances = [];
      class FakeRecognition {
        static async available() { return 'unavailable'; }
        processLocally = false;
        continuous = false;
        onstart?: () => void;
        onresult?: (event: any) => void;
        onerror?: (event: any) => void;
        onend?: () => void;
        start() { this.onstart?.(); }
        abort() {}
        stop() {}
        constructor() { (window as any).__auraEngines.push(this); }
      }
      (window as any).SpeechRecognition = FakeRecognition;
      class FakeUtterance { text: string; constructor(text: string) { this.text = text; } }
      (window as any).SpeechSynthesisUtterance = FakeUtterance;
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [{ name: 'Local English', lang: 'en-US', localService: true }],
        cancel() {}, speak: (utterance: any) => (window as any).__auraUtterances.push(utterance),
      } });
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ state: 'granted' }) } });
    });
    await context.exposeFunction('auraReactRequest', async (body: any) => {
      sent.push({ width, body });
      if (body.mode === 'create') return { ok: true, conversationId: `react-${width}`, revision: 0 };
      if (body.mode === 'command' && body.source === 'typed') {
        await new Promise<void>(resolve => pendingCommands.push(resolve));
        return { ok: true, conversationId: `react-${width}`, revision: 2, reply: 'Typed answer.', speech: 'Typed speech must stay silent.' };
      }
      return { ok: true, conversationId: `react-${width}`, revision: 1, reply: 'Voice answer.', speech: 'Voice answer spoken.' };
    });
    const page = await context.newPage();
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://aura-react.test') return route.abort();
      const file = url.pathname.slice(1);
      if (!file) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><span id="shell-sentinel">Shell stays mounted</span></body></html>' });
      if (!routes.has(file)) return route.abort();
      return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: await fs.readFile(path.join(process.cwd(), file), 'utf8') });
    });
    await page.goto('https://aura-react.test');
    await page.evaluate(async () => {
      const module = await import('/assets/aura-voice.js');
      let reactHost = document.getElementById('aura-react-root');
      if (!reactHost) {
        reactHost = document.createElement('div');
        reactHost.id = 'aura-react-root';
        document.body.append(reactHost);
      }
      (window as any).auraReactHandle = module.mountAuraWidgetReact(reactHost, {
        userId: `authorized-${location.host}`, isAuthorized: () => true,
        requestAssistant: (body: any) => (window as any).auraReactRequest(body),
      });
    });
    await page.getByRole('button', { name: 'Open AURA voice assistant' }).waitFor();
    return page;
  }
  try {
    for (const width of [390, 1100]) {
      const page = await launch(width);
      await page.getByRole('button', { name: 'Open AURA voice assistant' }).click();
      const status = page.locator('.aura-status');
      await page.getByRole('button', { name: 'Start voice input' }).click();
      await expect.poll(() => page.evaluate(() => (window as any).__auraEngines.length)).toBe(1);
      await expect(status).toHaveText(/Listening/);
      await page.evaluate(() => {
        const row = [{ transcript: 'Check current inventory', confidence: .99 }];
        (row as any).isFinal = true;
        const engine = (window as any).__auraEngines[0];
        engine.onresult({ results: [row], resultIndex: 0 });
        engine.onend();
      });
      await expect(status).toHaveText('Responding…');
      await expect(page.getByRole('log')).toContainText('Voice answer.');
      await expect.poll(() => page.evaluate(() => (window as any).__auraUtterances.length)).toBe(1);
      expect(sent.some(item => item.width === width && item.body.source === 'voice')).toBe(true);
      await page.evaluate(() => (window as any).__auraUtterances[0].onend?.());

      await page.getByRole('textbox', { name: 'Type a command for AURA' }).fill('Check one more thing');
      await page.getByRole('button', { name: 'Go', exact: true }).click();
      await expect(status).toHaveText('Processing…');
      const release = pendingCommands.shift();
      expect(release).toBeTruthy();
      release!();
      await expect(page.getByRole('log')).toContainText('Typed answer.');
      expect(await page.evaluate(() => (window as any).__auraUtterances.length)).toBe(1);
      expect(await page.evaluate(() => (window as any).__auraEngines.length)).toBe(1, 'React wrapper must not create another capture session');
      await page.evaluate(() => (window as any).auraReactHandle.destroy());
      await expect(page.locator('#shell-sentinel')).toHaveText('Shell stays mounted');
    }
  } finally { for (const context of contexts) await context.close(); }
});

test('the shell Aura bridge retries stale app context once without changing the voice turn ID', {"tag":["@local-e2e","@release-functional"]}, async ({ page }) => {
  const html = readComposedAppSource();
  const start = html.indexOf('async function requestAuraQuery(body, options = {}) {');
  const end = html.indexOf('\n        async function openAuraQueryAction', start);
  expect(start, 'the production shell command bridge exists').toBeGreaterThanOrEqual(0);
  expect(end, 'the production shell command bridge has a stable end').toBeGreaterThan(start);
  const bridgeSource = html.slice(start, end);
  await page.goto('about:blank');
  const result = await page.evaluate(async (source) => {
    const calls: Array<{ body: any; requestId: string }> = [];
    let settings = { seasonCode: 'S1', salesYear: 27, revision: 4 };
    const invoke = new Function('crypto', 'isAuraRouterWidgetAuthorized', 'getSupabaseReadIdentityScope',
      'auraRouterCapabilities', 'APP_CURRENT_SEASON_OPTIONS', 'getCurrentAppSeasonSettings',
      'normalizeAppSeasonSettingsPayload', 'writeLocalAppSeasonSettings', 'callAuraLlmRouter',
      `${source}; return requestAuraQuery;`);
    const requestAuraQuery = invoke({ randomUUID: () => 'unused-id' }, () => true,
      () => 'admin:session-current', { configured: true }, ['S1', 'F1'],
      () => settings,
      (value: any) => ({ seasonCode: value.seasonCode || value.season, salesYear: Number(value.salesYear ?? value.salesyear), revision: Number(value.revision ?? value.settingRevision) }),
      (value: any) => { settings = { seasonCode: value.seasonCode, salesYear: value.salesYear, revision: value.revision }; return settings; },
      async (body: any, options: any) => {
        calls.push({ body, requestId: options.requestId });
        if (calls.length === 1) throw Object.assign(new Error('stale app settings'), {
          code: 'AURA_APP_CONTEXT_STALE', status: 409,
          payload: { appContext: { season: 'F1', salesyear: 28, settingRevision: 5 } },
        });
        return { ok: true, requestId: body.turnId, reply: 'Updated answer', source: 'voice' };
      });
    const response = await requestAuraQuery({ mode: 'command', text: 'Check open stock', source: 'voice', turnId: 'voice-turn-7' },
      { requestId: 'voice-turn-7' });
    await requestAuraQuery({ mode: 'command', text: 'Check another item', source: 'typed', turnId: 'voice-turn-8' },
      { requestId: 'voice-turn-8' });
    return { calls, response, settings };
  }, bridgeSource);
  expect(result.calls).toHaveLength(3);
  expect(result.calls[0].body.appContext).toEqual({ season: 'S1', salesyear: 27, settingRevision: 4 });
  expect(result.calls[1].body.appContext).toEqual({ season: 'F1', salesyear: 28, settingRevision: 5 });
  expect(result.calls.map(call => call.requestId)).toEqual(['voice-turn-7', 'voice-turn-7', 'voice-turn-8']);
  expect(result.calls.map(call => call.body.turnId)).toEqual(['voice-turn-7', 'voice-turn-7', 'voice-turn-8']);
  expect(result.calls.map(call => call.body.source)).toEqual(['voice', 'voice', 'typed']);
  expect(result.response).toMatchObject({ requestId: 'voice-turn-7', reply: 'Updated answer', source: 'voice' });
  expect(result.settings).toEqual({ seasonCode: 'F1', salesYear: 28, revision: 5 });
  expect(result.calls[2].body.appContext).toEqual({ season: 'F1', salesyear: 28, settingRevision: 5 });
});
