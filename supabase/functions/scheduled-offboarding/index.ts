import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import type { Database } from "../_shared/database.types.ts";
import { withObservedRequest } from "../_shared/observability.ts";
import { createScheduledOffboardingHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const requestTimeoutMs = 12_000;
const boundedFetch: typeof fetch = (input, init = {}) => {
  const timeout = AbortSignal.timeout(requestTimeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};
const supabase = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: boundedFetch },
});
const handler = createScheduledOffboardingHandler({ supabase, supabaseUrl: SUPABASE_URL, serviceRoleKey: SERVICE_ROLE_KEY });

serve((req) => withObservedRequest("scheduled-offboarding", req, () => handler(req)));
