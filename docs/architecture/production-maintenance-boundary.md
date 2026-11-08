# Production maintenance publication boundary

The customer-directory index and archive autovacuum reloptions are maintained
through the two adjacent operational SQL files. They are deliberately outside
`supabase/migrations` and the atomic migration publisher. PostgreSQL forbids
`CREATE INDEX CONCURRENTLY` inside a transaction block; the index file must run
as separate statements on one verified persistent session. The autovacuum and
reviewed transient-pruning file owns its bounded transaction independently.

`scripts/maintain-production-database.mjs` follows the existing persistent-client
maintenance convention. It validates the exact linked project and pooler host,
uses verified TLS, verifies the same backend PID and session limits, and stops
on contention or a failed command. Official CLI credentials remain in process
memory. Storage index remnants are retained when the session lacks owner access.
No ownership, role membership or host access control is changed.

`src/services/production-maintenance-contract.mjs` provides the standalone
installed-state query for the exact index keys, predicate, validity and archive
reloptions. Its focused tests include partial/absent contracts and transaction
ownership. The existing large migration dispatcher is unchanged; these files
must not be represented as registered atomic migrations.

Installed receipts, plans, source backups and limitations are retained under
`G:\My Drive\GNC\AgData\Release Evidence\`, dated 2026-11-08. Concurrent index
maintenance and ordinary vacuum preserve operational reads and writes; neither
is a claim that PostgreSQL takes no locks or that application latency is proven.
