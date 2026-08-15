import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let parsed = 0;

while ((match = scriptPattern.exec(html))) {
  const attributes = match[1] || '';
  const source = match[2] || '';
  if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;
  try {
    // Syntax-only compilation; browser globals are intentionally not executed.
    new Function(source);
    parsed += 1;
  } catch (error) {
    const before = html.slice(0, match.index);
    const line = before.split(/\r?\n/).length;
    throw new Error(`Inline script beginning near index.html:${line} did not parse: ${error.message}`);
  }
}

for (const relativePath of [
  'assets/ops-precision-pilot.js',
  'sw.js'
]) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  try {
    new Function(source);
  } catch (error) {
    throw new Error(`${relativePath} did not parse: ${error.message}`);
  }
}

if (parsed < 3) throw new Error(`Expected at least 3 inline scripts, parsed ${parsed}.`);
console.log(`Parsed ${parsed} inline scripts and 2 shell assets.`);
