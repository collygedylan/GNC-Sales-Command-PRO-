// Synthetic, intercepted report preview. Never contacts Apps Script, storage, or email.
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { buildSeasonPriorityReportFixture } from '../tests/fixtures/season-priority-report.mjs';
const output = '.gnc-local/season-priority-report';
await mkdir(output, { recursive: true });
const { pdfHtml, emailHtml } = buildSeasonPriorityReportFixture(4, 24);
await writeFile(`${output}/report.html`, pdfHtml);
await writeFile(`${output}/email.html`, emailHtml);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  await page.setContent(pdfHtml);
  await page.pdf({ path: `${output}/report.pdf`, preferCSSPageSize: true, printBackground: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(emailHtml);
  await page.screenshot({ path: `${output}/email.png`, fullPage: true });
  console.log('Synthetic Season Priority PDF and mobile email rendered; zero deliveries.');
} finally { await browser.close(); }
