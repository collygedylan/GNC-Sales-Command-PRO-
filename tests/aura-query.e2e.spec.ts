import { test, expect } from '@playwright/test';

import fs from 'node:fs/promises';
import path from 'node:path';
// @test-group: @local-e2e,@release-functional,aura


test('Aura restores private conversations across pages and hands changes to review', {"tag":["@local-e2e","@release-functional"]}, async ({ browser }) => {
  const files = new Set(['components/common/auraVoiceWidget.js', 'components/common/auraQueryPanel.js',
    'services/auraVoiceService.js', 'services/auraConversation.js', 'utils/auraIntentParser.js', 'utils/auraLingo.js']);
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
    'services/auraVoiceService.js', 'services/auraConversation.js', 'utils/auraIntentParser.js', 'utils/auraLingo.js']);
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
