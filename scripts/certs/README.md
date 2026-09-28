# Supabase database trust root

`supabase-prod-ca-2021.crt` is a public certificate authority certificate, not a credential or private key. The low-stock migration, its read-only connection probe, and the existing recovery diagnostic use it only for their Postgres connection. Certificate and hostname verification remain enabled.

Source: the [Supabase dashboard's certificate download configuration](https://github.com/supabase/supabase/blob/7f1df457f8d0db792996f332b402202a71ab0280/apps/studio/hooks/custom-content/custom-content.json), using its production environment URL:

https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

Retrieved over verified HTTPS on September 28, 2026. The certificate's subject and issuer are `Supabase Root 2021 CA`, with CA capability and a valid self-signature. It expires April 26, 2031.

SHA-256 certificate fingerprint (DER):

```text
80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA
```

For rotation, obtain the replacement from Supabase's official dashboard/configuration, verify its provenance and validity, update the certificate and its unit-test fingerprint, then run the read-only cloud probe before the normal guarded migration. Never trust a certificate merely because an unverified database peer presented it.

The existing recovery diagnostic also supports `GNC_SUPABASE_CA_FILE` for a reviewed replacement. The low-stock migration and its probe use the checked-in certificate so both cloud paths have the same trust configuration.

See [Supabase SSL verification guidance](https://supabase.com/docs/guides/platform/ssl-enforcement).
