import { describe, expect, it } from 'vitest';
import { validateRuntimeConfig } from './runtime';

const sandboxConfig = {
  environment: 'sandbox' as const,
  projectRef: 'gnc-sandbox-006',
  productionProjectRef: 'kzrnyjsosryejjejliii',
  supabaseUrl: 'https://gnc-sandbox-006.supabase.co',
  publishableKey: 'sb_publishable_test',
  testData: true as const
};

describe('v2 runtime database isolation', () => {
  it('accepts the explicitly sandbox-scoped inventory project', () => {
    expect(validateRuntimeConfig(sandboxConfig).projectRef).toBe('gnc-sandbox-006');
  });

  it('rejects the production Supabase project before a client can be created', () => {
    expect(() => validateRuntimeConfig({ ...sandboxConfig,
      projectRef: 'kzrnyjsosryejjejliii', supabaseUrl: 'https://kzrnyjsosryejjejliii.supabase.co'
    })).toThrow(/production Supabase project/i);
  });
});
