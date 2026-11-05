BEGIN;
CREATE TABLE IF NOT EXISTS test_private.bootstrap_receipts(key text PRIMARY KEY,completed_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE test_private.bootstrap_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON test_private.bootstrap_receipts FROM PUBLIC,anon,authenticated;
DO $$ BEGIN INSERT INTO test_private.bootstrap_receipts(key) VALUES('donor_runtime_retired') ON CONFLICT DO NOTHING;
IF FOUND THEN UPDATE test_private.erp_sync_jobs SET active=false,worker_id=NULL,request_lease_until=NULL,status=status||jsonb_build_object('active',false,'status','HISTORICAL_CLONE','testHistoricalClone',true) WHERE active OR coalesce((status->>'active')::boolean,false);END IF;END $$;
COMMIT;
