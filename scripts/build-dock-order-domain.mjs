import { readFile, writeFile } from 'node:fs/promises';

const modules = [['core','login-continuity'], ['views','request-folder-choice'], ['views','inventory-share-text'], ['views','inventory-card-context'], ['views','av-inventory-card'], ['views','request-inventory-card'], ['views','workflow-inventory-card'], ['engine','row-publication-branches'], ['engine','canonical-inventory-evidence'], ['core','dock-order-domain'], ['core','dock-issue-domain'], ['core','inventory-photo-domain'], ['core','inventory-hydration-recovery'], ['core','cold-operational-display'], ['core','po-management-live'], ['core','app-update-restore'], ['core','logout-work-state'], ['core','request-live-rows'], ['core','suspend-planstart-domain'], ['core','suspend-receipt-domain'], ['core','suspend-exact-owner'], ['core','suspend-detail-save-domain'], ['services','rpc-recovery-domain'], ['services','app-api-transport'], ['services','erp-manual-continuation'], ['services','reclass-move-outbox'], ['views','reclass-move-command'], ['views','reclass-submission'], ['services','service-worker-url'], ['ui','body-prepaint-theme'], ['ui','preboot-recovery'], ['views','manager-table-workspace'], ['views','drive-common-name-preparation'], ['views','suspend-tag-page'], ['ui','manager-table-layout'], ['ui','header-excel-export'], ['ui','av-filter-rail'], ['ui','av-filter-markup'], ['ui','chunk-render-pacing'], ['views','eval-report2-controls']];
for (const [directory,name] of modules) {
  const source = new URL(`../src/${directory}/${name}.js`, import.meta.url);
  const target = new URL(`../assets/${name}.js`, import.meta.url);
  const body = (await readFile(source, 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  await writeFile(target, body, 'utf8');
}
