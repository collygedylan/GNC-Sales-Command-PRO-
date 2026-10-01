import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright';

const bundle = fs.readFileSync(new URL('../assets/alpha-command-center.js', import.meta.url));
const stylesheet = fs.readFileSync(new URL('../assets/alpha-command-center.css', import.meta.url));
let server;
let origin;

test.before(async () => {
  server = http.createServer((request, response) => {
    if (request.url === '/assets/alpha-command-center.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(bundle);
      return;
    }
    if (request.url === '/assets/alpha-command-center.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      response.end(stylesheet);
      return;
    }
    if (request.url === '/assets/alpha-command-center.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' });
      response.end(stylesheet);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body><div id="app"></div></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server?.close(resolve));
});

async function openCommandCenter(page) {
  await page.goto(origin);
  await page.addStyleTag({ url: `${origin}/assets/alpha-command-center.css` });
  await page.evaluate(async (bundleUrl) => {
    // Mirror the shell's identity gate before exposing the mount API.
    window.identity = { username: 'dylan_collyge', active: true, verified: true };
    const module = await import(bundleUrl);
    window.mountForVerifiedDylan = (mode, deps) => {
      const id = window.identity;
      if (!id?.active || !id.verified || id.username !== 'dylan_collyge') return null;
      return module.mountCommandCenter(document.querySelector('#app'), mode, deps);
    };
  }, `${origin}/assets/alpha-command-center.js`);
}

test('mounted chat keeps a failed optimistic message and retries it to success', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await openCommandCenter(page);
  await page.evaluate(() => {
    window.sendAttempts = [];
    window.sendNumber = 0;
    window.handle = window.mountForVerifiedDylan('communications', {
      isAuthorized: () => window.identity?.active && window.identity?.verified && window.identity?.username === 'dylan_collyge',
      callApi: async payload => {
        if (payload.action === 'alpha_chat_list') return { ok: true, rows: [] };
        if (payload.action === 'aura_chat_send') {
          window.sendAttempts.push(payload.clientId);
          window.sendNumber += 1;
          if (window.sendNumber === 1) return { ok: false, error: 'temporary failure' };
          return { ok: true, messageId: 'msg-1', conversationId: 'conversation-1' };
        }
        if (payload.action === 'alpha_chat_page') return {
          ok: true,
          rows: window.sendNumber > 1 ? [{ id: 'msg-1', senderUsername: 'dylan_collyge', senderDisplayName: 'Dylan', body: 'Keep this message', createdAt: '2026-09-30T12:00:00Z' }] : [],
          hasMore: false,
        };
        return { ok: true };
      },
      client: null,
    });
  });

  await page.getByLabel('Recipient name').fill('Megan Kelly');
  await page.getByLabel('Message').fill('Keep this message');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('alert').getByText('temporary failure').waitFor();
  const bubble = page.locator('.alpha-bubble').filter({ hasText: 'Keep this message' });
  await bubble.getByText('Failed').waitFor();
  assert.equal(await bubble.count(), 1);

  await bubble.getByRole('button', { name: 'Retry message' }).click();
  await page.locator('.alpha-bubble').filter({ hasText: 'Keep this message' }).getByText('Dylan').waitFor();
  await page.getByRole('alert').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.alpha-bubble').filter({ hasText: 'Keep this message' }).count(), 1);
  assert.equal(await page.evaluate(() => new Set(window.sendAttempts).size), 1, 'retry must keep the same idempotency key');
  await page.evaluate(() => window.handle.destroy());
});

test('mounted message feed renders a bounded window for a 10,000-row history', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await openCommandCenter(page);
  await page.evaluate(() => {
    window.handle = window.mountForVerifiedDylan('communications', {
      isAuthorized: () => window.identity?.active && window.identity?.verified && window.identity?.username === 'dylan_collyge',
      callApi: async payload => {
        if (payload.action === 'alpha_chat_list') return { ok: true, rows: [{ id: 'conversation-1', title: 'Team' }] };
        if (payload.action === 'alpha_chat_page') return {
          ok: true,
          rows: Array.from({ length: 10_000 }, (_, index) => ({ id: `message-${index}`, senderUsername: 'megan_kelly', body: `message body ${index}`, createdAt: '2026-09-30T12:00:00Z' })),
          hasMore: false,
        };
        return { ok: true };
      },
      client: null,
    });
  });
  await page.getByRole('button', { name: 'Team' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.alpha-bubble').length > 0);
  await page.waitForTimeout(100);
  const rendered = await page.locator('.alpha-bubble').count();
  assert.ok(rendered > 0, 'some messages should render');
  assert.ok(rendered < 80, `expected a bounded virtual window, got ${rendered} bubbles`);
  await page.evaluate(() => window.handle.destroy());
});

test('non-Dylan is denied before asset import or private channel join; sign-out unmount removes Dylan channel', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const assetRequests = [];
  page.on('request', request => {
    if (/alpha-command-center\.(?:js|css)/.test(request.url())) assetRequests.push(request.url());
  });
  await page.goto(origin);
  await page.addStyleTag({ content: '.alpha-feed{height:400px;overflow:auto}' });
  await page.evaluate(() => {
    window.identity = { username: 'megan_kelly', active: true, verified: true };
    window.channelJoins = [];
    window.removedChannels = [];
    window.shellMount = async () => {
      const id = window.identity;
      if (!id?.active || !id?.verified || id.username !== 'dylan_collyge') return null;
      const module = await import('/assets/alpha-command-center.js');
      if (!document.querySelector('#alpha-command-center-style')) {
        const link = document.createElement('link');
        link.id = 'alpha-command-center-style';
        link.rel = 'stylesheet';
        link.href = '/assets/alpha-command-center.css';
        document.head.append(link);
      }
      const client = {
        auth: { getSession: async () => ({ data: { session: { access_token: 'dylan-token' } } }) },
        realtime: { setAuth: async token => { window.realtimeToken = token; } },
        channel: (name, options) => {
          const record = { name, options, handlers: [] };
          window.channelJoins.push(record);
          return {
            on(...args) { record.handlers.push(args); return this; },
            subscribe(callback) { callback('SUBSCRIBED'); return this; },
            track: async () => {},
          };
        },
        removeChannel: async channel => { window.removedChannels.push(channel); },
      };
      window.handle = module.mountCommandCenter(document.querySelector('#app'), 'communications', {
        client,
        isAuthorized: () => window.identity?.active && window.identity?.verified && window.identity?.username === 'dylan_collyge',
        callApi: async payload => payload.action === 'alpha_chat_list'
          ? { ok: true, rows: [{ id: 'private-conversation', title: 'Team' }] }
          : { ok: true, rows: [], hasMore: false },
      });
      return window.handle;
    };
  });

  assert.equal(await page.evaluate(() => window.shellMount()), null);
  await page.waitForTimeout(100);
  assert.deepEqual(assetRequests, [], 'non-Dylan must not request command center JavaScript or CSS');
  assert.equal(await page.evaluate(() => window.channelJoins.length), 0, 'non-Dylan must not join a private channel');

  await page.evaluate(() => { window.identity = { username: 'dylan_collyge', active: true, verified: true }; });
  await page.evaluate(() => window.shellMount());
  await page.getByRole('button', { name: 'Team' }).click();
  await page.waitForFunction(() => window.channelJoins.length === 1 && window.realtimeToken === 'dylan-token');
  const joined = await page.evaluate(() => ({ name: window.channelJoins[0].name, options: window.channelJoins[0].options }));
  assert.equal(joined.name, 'alpha-chat:dylan_collyge:private-conversation');
  assert.equal(joined.options.config.private, true);
  assert.equal(joined.options.config.presence.key, 'dylan_collyge');

  await page.evaluate(() => {
    window.identity.active = false; // sign-out invalidates the gate before unmount cleanup
    window.handle.destroy();
  });
  await page.waitForFunction(() => window.removedChannels.length === 1);
  assert.ok(assetRequests.some(url => url.endsWith('/assets/alpha-command-center.js')));
  assert.ok(assetRequests.some(url => url.endsWith('/assets/alpha-command-center.css')));
});

test('phone-width Communications and HR shells fit without page overflow', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  for (const width of [320, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await openCommandCenter(page);
    for (const mode of ['communications', 'hr']) {
      await page.evaluate(mode => {
        window.handle?.destroy();
        window.handle = window.mountForVerifiedDylan(mode, {
          isAuthorized: () => window.identity?.active && window.identity?.verified && window.identity?.username === 'dylan_collyge',
          callApi: async payload => ({ ok: true, rows: [], hasMore: false }),
          client: {
            from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }), gte: () => ({ lte: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
          },
        });
      }, mode);
      await page.locator('.alpha-command-center').waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      assert.equal(overflow, false, `${mode} overflowed ${width}px viewport`);
    }
    await page.close();
  }
});

test('weekly labor autosaves two job codes for the same employee and date', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await openCommandCenter(page);
  await page.evaluate(() => {
    window.savedLabor = [];
    window.handle = window.mountForVerifiedDylan('hr', {
      isAuthorized: () => window.identity?.active && window.identity?.verified && window.identity?.username === 'dylan_collyge',
      profileId: 'profile-dylan',
      callApi: async () => ({ ok: true, rows: [] }),
      client: {
        from(table) {
          if (table === 'labor_timesheets') return {
            select() { return { gte() { return { lte() { return { limit: async () => ({ data: [], error: null }) }; } }; } }; },
            upsert(entry, options) {
              window.savedLabor.push({ entry, options });
              return { select() { return { single: async () => ({ data: { id: `saved-${window.savedLabor.length}`, ...entry }, error: null }) }; } };
            },
          };
          const data = table === 'core_employees'
            ? [{ id: 'employee-1', name: 'Alex Grower', emp_number: 'E123', department: 'Plant Evaluators' }]
            : [{ job_code: 'CUT', description: 'Cuttings' }, { job_code: 'PACK', description: 'Packing' }];
          return { select() { return { eq() { return { order() { return { limit: async () => ({ data, error: null }) }; } }; } }; } };
        },
      },
    });
  });
  await page.getByText('Alex Grower').waitFor();
  await page.getByRole('button', { name: 'Add job code' }).click();
  await page.getByRole('button', { name: 'Add job code' }).click();
  const codes = page.getByLabel('Job code');
  await codes.nth(0).selectOption('CUT');
  await codes.nth(1).selectOption('PACK');
  const monday = await page.locator('.alpha-date').first().textContent();
  assert.match(monday, /^\d{4}-\d{2}-\d{2}/);
  await page.locator('.alpha-entry').nth(0).locator('.alpha-day input').first().fill('4');
  await page.locator('.alpha-entry').nth(1).locator('.alpha-day input').first().fill('3.5');
  await page.waitForFunction(() => window.savedLabor.length === 2);
  const saved = await page.evaluate(() => window.savedLabor);
  assert.deepEqual(saved.map(row => row.entry.job_code).sort(), ['CUT', 'PACK']);
  assert.ok(saved.every(row => row.entry.employee_id === 'employee-1' && row.entry.created_by_profile_id === 'profile-dylan'));
  assert.equal(new Set(saved.map(row => row.entry.work_date)).size, 1);
  await page.evaluate(() => window.handle.destroy());
});

test('optional HR and Comm permission denials stay inside an empty alpha view without retries', async t => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openCommandCenter(page);
  await page.evaluate(() => {
    window.reads = [];
    window.deps = {
      isAuthorized: () => window.identity.active,
      callApi: async payload => { window.reads.push(payload.action); throw { status: 403, message: 'Forbidden' }; },
      client: { from(table) {
        window.reads.push(table);
        const query = {};
        for (const method of ['select', 'eq', 'order', 'gte', 'lte', 'limit']) query[method] = () => query;
        query.then = resolve => Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } }).then(resolve);
        return query;
      } },
    };
    window.handle = window.mountForVerifiedDylan('hr', window.deps);
  });
  await page.getByText('No employees found in this department.').waitFor();
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.reads), ['core_employees', 'hr_job_codes', 'labor_timesheets']);
  await page.evaluate(() => { window.handle.destroy(); window.handle = window.mountForVerifiedDylan('communications', window.deps); });
  await page.getByLabel('Recipient name').waitFor();
  await page.waitForFunction(() => window.reads.includes('alpha_chat_list'));
  await page.waitForTimeout(250);
  assert.equal(await page.locator('[role="alert"]').count(), 0);
  assert.equal(await page.evaluate(() => window.reads.filter(value => value === 'alpha_chat_list').length), 1);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.handle.destroy());
});
