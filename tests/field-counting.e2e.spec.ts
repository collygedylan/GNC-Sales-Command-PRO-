import { test, expect } from '@playwright/test';

// @test-group: @release-functional
test.describe('field counting production island', { tag: '@release-functional' },()=>{
 for(const theme of ['light','dark']) test(`bounded count and queued report on mobile in ${theme}`,async({page},testInfo)=>{
  const runtimeErrors:string[]=[];
  page.on('pageerror',error=>runtimeErrors.push(error.stack||error.message));
  page.on('console',message=>{if(message.type()==='error')runtimeErrors.push(message.text());});
  await page.setViewportSize({width:theme==='light'?390:820,height:844});
  await page.emulateMedia({colorScheme:theme==='light'?'dark':'light'});
  const chunks:string[]=[];page.on('request',r=>{if(/field-counting.*\.js/.test(r.url()))chunks.push(r.url());});
  await page.goto('/tests/fixtures/field-counting.html');
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  expect(chunks).toEqual([]);
  await page.getByRole('button',{name:'Open field counting'}).click();
  await expect(page.getByRole('heading',{name:'Counting',exact:true}),runtimeErrors.join('\n')).toBeVisible();
  expect(chunks.some(x=>x.includes('field-counting-chunks/'))).toBeTruthy();
  await page.getByRole('combobox',{name:'Block',exact:true}).selectOption('D');
  await page.getByRole('combobox',{name:'Location',exact:true}).selectOption('D.01.000');
  await expect(page.locator('[data-count-input]')).toHaveCount(2);
  await expect(page.locator('.field-counting__row').first()).toHaveCSS('background-color',theme==='dark'?'rgb(17, 28, 24)':'rgb(255, 255, 255)');
  await expect(page.getByRole('heading',{name:'Counting',exact:true})).toHaveCSS('color',theme==='dark'?'rgb(242, 251, 246)':'rgb(23, 37, 29)');
  await page.locator('[data-count-input]').nth(0).fill('0');
  await page.locator('[data-count-input]').nth(0).press('Enter');
  await expect(page.locator('[data-count-input]').nth(1)).toBeFocused();
  await page.locator('[data-count-input]').nth(1).fill('492');
  await page.getByLabel('Location note (optional)',{exact:true}).fill('Verified ® both lots');
  await page.getByRole('combobox',{name:'Row direction'}).selectOption('south_north');
  await page.getByRole('button',{name:'Save this page',exact:true}).click();
  await expect(page.getByText('Counts saved.',{exact:true})).toBeVisible();
  const saved=await page.evaluate(()=>((window as unknown as {countRequests:Array<{operation:string,payload:{direction:string,entries:Array<{countedQty:number,note:string}>}}>}).countRequests).filter(r=>r.operation==='save'));
  expect(saved).toHaveLength(1);expect(saved[0].payload.entries.map(x=>x.countedQty)).toEqual([0,492]);
  expect(saved[0].payload.direction).toBe('south_north');
  expect(saved[0].payload.entries.every(x=>x.note==='Verified ® both lots')).toBeTruthy();
  await page.getByRole('button',{name:/Complete.*email report/}).click();
  await expect(page.getByText(/Count report queued/)).toBeVisible();
  const completed=await page.evaluate(()=>((window as unknown as {countRequests:Array<{operation:string}>}).countRequests).filter(r=>r.operation==='complete'));
  expect(completed).toHaveLength(1);
  const overflow=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:window.innerWidth,offenders:Array.from(document.querySelectorAll<HTMLElement>('*')).map(el=>({selector:el.tagName.toLowerCase()+(el.id?`#${el.id}`:'')+(typeof el.className==='string'&&el.className?'.'+el.className.trim().replace(/\s+/g,'.'):''),right:Math.round(el.getBoundingClientRect().right),width:Math.round(el.getBoundingClientRect().width)})).filter(x=>x.right>window.innerWidth+1).slice(0,8)}));
  expect(overflow.width,JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport);
  await page.screenshot({path:testInfo.outputPath(`field-counting-${theme}.png`),fullPage:true});
  await page.getByRole('button',{name:'Back to Inventory',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Counting',exact:true})).toHaveCount(0);
 });
});

test('field counting retries a failed lazy view chunk', { tag: '@release-functional' }, async ({ page }) => {
  let viewChunkRequests = 0;
  const runtimeErrors:string[]=[];
  page.on('pageerror',error=>runtimeErrors.push(error.stack||error.message));
  page.on('console',message=>{if(message.type()==='error')runtimeErrors.push(message.text());});
  await page.route(url => url.pathname.includes('/assets/field-counting-chunks/FieldCountingView-'), async route => {
    viewChunkRequests += 1;
    if (viewChunkRequests === 1) {
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'temporary chunk failure' });
      return;
    }
    await route.continue();
  });

  await page.goto('/tests/fixtures/field-counting.html');
  await page.getByRole('button', { name: 'Open field counting' }).click();
  await expect(page.getByRole('alert')).toContainText('Counting could not load. Your saved counts are unchanged.');
  await page.getByRole('button', { name: 'Retry loading counts' }).click();
  await expect(page.getByRole('heading', { name: 'Counting', exact: true }),runtimeErrors.join('\n')).toBeVisible();
  expect(viewChunkRequests).toBeGreaterThanOrEqual(2);
});
