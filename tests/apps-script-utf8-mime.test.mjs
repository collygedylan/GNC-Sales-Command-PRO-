import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../Code.gs', import.meta.url), 'utf8');
function functionSource(name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, `missing ${name}`);
  const end = code.indexOf('\nfunction ', start + 1);
  return code.slice(start, end < 0 ? undefined : end);
}

function harness() {
  const utilities = {
    Charset: { UTF_8: 'UTF-8' },
    getUuid: () => '01234567-89ab-cdef-0123-456789abcdef',
    newBlob(value) {
      const bytes = Array.isArray(value) ? Buffer.from(value) : Buffer.from(String(value == null ? '' : value), 'utf8');
      return {
        getBytes: () => Array.from(bytes),
        getDataAsString: charset => bytes.toString(charset || 'utf8'),
      };
    },
    base64Encode(value) { return Buffer.from(value).toString('base64'); },
    base64EncodeWebSafe(value) { return Buffer.from(value).toString('base64url'); },
  };
  const ctx = vm.createContext({ Utilities: utilities, String, Object, Array, RegExp, Error });
  const names = ['repairDisplayUtf8Mojibake_', 'encodeMimeHeaderWord_', 'encodeMimeBody_', 'formatMimeMailbox_', 'buildMimeEmail_'];
  vm.runInContext(names.map(functionSource).join('\n'), ctx);
  return ctx;
}

test('display repair fixes mixed and layered UTF-8 mojibake without changing valid names', () => {
  const ctx = harness();
  assert.equal(ctx.repairDisplayUtf8Mojibake_('CafÃ© 東京'), 'Café 東京');
  assert.equal(ctx.repairDisplayUtf8Mojibake_('CafÃ©植物 ®'), 'Café植物 ®');
  assert.equal(ctx.repairDisplayUtf8Mojibake_('Â®🌿'), '®🌿');
  assert.equal(ctx.repairDisplayUtf8Mojibake_('FranÃƒÂ§ais'), 'Français');
  assert.equal(ctx.repairDisplayUtf8Mojibake_('José — 東京 🌿'), 'José — 東京 🌿');
  assert.equal(ctx.repairDisplayUtf8Mojibake_('plain ASCII'), 'plain ASCII');
});

test('MIME encodes Unicode headers and UTF-8 bodies while retaining thread headers', () => {
  const ctx = harness();
  const mime = ctx.buildMimeEmail_({
    toList: 'user@example.test',
    fromName: 'GNC Café 東京',
    fromAddress: 'app@example.test',
    subject: 'Reclass — Café 🌿',
    textBody: 'François — 東京',
    htmlBody: '<p>François — 東京</p>',
    inReplyTo: '<original@example.test>',
    references: '<original@example.test>',
  });
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(mime, /From: =\?UTF-8\?B\?.* <app@example\.test>/);
  assert.match(mime, /In-Reply-To: <original@example\.test>/);
  assert.match(mime, /References: <original@example\.test>/);
  assert.equal((mime.match(/Content-Transfer-Encoding: base64/g) || []).length, 2);
  const encodedBodies = mime.split(/Content-Transfer-Encoding: base64\r?\n\r?\n/).slice(1);
  assert.equal(Buffer.from(encodedBodies[0].split(/\r?\n--/)[0].replace(/\s/g, ''), 'base64').toString('utf8'), 'François — 東京');
  assert.equal(Buffer.from(encodedBodies[1].split(/\r?\n--/)[0].replace(/\s/g, ''), 'base64').toString('utf8'), '<p>François — 東京</p>');
});

test('MIME leaves ASCII headers readable and rejects header injection', () => {
  const ctx = harness();
  const mime = ctx.buildMimeEmail_({ toList: 'user@example.test', fromName: 'GNC Apps', fromAddress: 'app@example.test', subject: 'Request update', textBody: 'ok', htmlBody: '<p>ok</p>' });
  assert.match(mime, /From: "GNC Apps" <app@example\.test>/);
  assert.match(mime, /Subject: Request update/);
  assert.throws(() => ctx.buildMimeEmail_({ subject: 'hello\r\nBcc: bad@example.test' }), /EMAIL_HEADER_INVALID/);
  assert.throws(() => ctx.formatMimeMailbox_('Name\nBcc: bad@example.test', 'app@example.test'), /EMAIL_HEADER_INVALID/);
});
