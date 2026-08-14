import type { AppRuntimeConfig } from './types';

const DEFAULT_PRODUCTION_REF = 'kzrnyjsosryejjejliii';
let runtimePromise: Promise<AppRuntimeConfig> | null = null;

function projectRefFromUrl(url: string) {
  try {
    return new URL(url).hostname.split('.')[0] || '';
  } catch {
    return '';
  }
}

export function validateRuntimeConfig(value: unknown): AppRuntimeConfig {
  if (!value || typeof value !== 'object') throw new Error('Sandbox runtime configuration is missing.');
  const config = value as Partial<AppRuntimeConfig>;
  const projectRef = String(config.projectRef || projectRefFromUrl(String(config.supabaseUrl || ''))).trim();
  const productionRef = String(config.productionProjectRef || DEFAULT_PRODUCTION_REF).trim();
  if (config.environment !== 'sandbox' || config.testData !== true) {
    throw new Error('v2 is locked to TEST DATA and will not start outside sandbox mode.');
  }
  if (!projectRef || !config.supabaseUrl || !config.publishableKey) {
    throw new Error('Sandbox project URL, project reference, and publishable key are required.');
  }
  if (projectRef === productionRef || String(config.supabaseUrl).includes(productionRef)) {
    throw new Error('Blocked: v2 cannot connect to the production Supabase project.');
  }
  if (!String(config.supabaseUrl).startsWith('https://') || !String(config.publishableKey).startsWith('sb_publishable_')) {
    throw new Error('Sandbox runtime credentials are invalid.');
  }
  return {
    environment: 'sandbox',
    testData: true,
    projectRef,
    productionProjectRef: productionRef,
    supabaseUrl: String(config.supabaseUrl),
    publishableKey: String(config.publishableKey)
  };
}

export function loadRuntimeConfig(): Promise<AppRuntimeConfig> {
  if (!runtimePromise) {
    runtimePromise = fetch('./runtime-config.json', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`Sandbox runtime config failed (${response.status}).`);
        return validateRuntimeConfig(await response.json());
      });
  }
  return runtimePromise;
}
