import assert from 'node:assert/strict';
import {read, runFunctions} from './golden-test-environment.mjs';
import {assertSharedSquareMedia} from './release-gems-ui.mjs';

export async function invariant240() {
  const {JSDOM}=await import('jsdom');
  const dom=new JSDOM('<div class="app-inline-thumb-column"><div class="app-inline-thumb-box app-av-photo-carousel"><img src="https://photo.test/a.jpg"><span class="app-av-photo-count">1/3</span></div></div>');
  const context=runFunctions('assets/app-runtime.js',['ensurePhotoTakenDateBadges'],{document:dom.window.document,resolveAndFormatPhotoDate:()=> '10/30/26',esc:value=>value});
  context.ensurePhotoTakenDateBadges();
  const box=dom.window.document.querySelector('.app-inline-thumb-box'),date=dom.window.document.querySelector('.photo-thumb-date');
  assert.equal(box.contains(date),false);assert.equal(date.parentElement,box.parentElement);
  const css=read('assets/app-shell-style-05.css');
  assert.match(css,/app-inline-thumb-box[^}]*display:block!important/);
  assert.match(css,/app-inline-thumb-box[^}]*width:84px!important/);
  assertSharedSquareMedia(read,(names,values)=>runFunctions('assets/app-runtime.js',names,values));
  dom.window.close();
}
