# Supabase diagnostic CA

Public CA only; not a private key or application credential. Used solely by the read-only database diagnostic with certificate and hostname verification enabled.

Source: `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`

Verified against the `ssl:certificate_url` in [Supabase's dashboard source](https://github.com/supabase/supabase/blob/master/apps/studio/hooks/custom-content/custom-content.json).

SHA-256 certificate fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

Expiry: 2031-04-26. If Supabase rotates the CA, obtain its replacement from the official dashboard and review the change; never disable verification to suppress a failure. `GNC_SUPABASE_CA_FILE` can select a reviewed replacement without changing global trust.
