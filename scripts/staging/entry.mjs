import { createStagingAdapter } from './staging-adapter.mjs';

const config = JSON.parse(document.getElementById('gnc-staging-config')?.textContent || '{}');
const adapter = createStagingAdapter({ config });
adapter.install();
