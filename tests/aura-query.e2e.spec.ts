import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

test('Aura restores private conversations across pages and hands changes to review', async ({ browser }) => {
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
