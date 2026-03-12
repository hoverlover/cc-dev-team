-- Add machine_jwt column for Vercel <-> Machine authentication
ALTER TABLE machines ADD COLUMN machine_jwt TEXT;

-- Add RLS policy for machine_jwt (tenant isolation)
CREATE POLICY machines_jwt_tenant_isolation ON machines
  USING (tenant_id = (current_setting('app.tenant_id', true))::uuid);
