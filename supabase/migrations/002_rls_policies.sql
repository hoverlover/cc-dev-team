-- 002: Enable RLS and create tenant isolation policies

-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pm_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE cdt_api_keys ENABLE ROW LEVEL SECURITY;

-- tenants: direct auth_id match
CREATE POLICY tenant_isolation_select ON tenants
  FOR SELECT USING (auth_id = auth.uid());

CREATE POLICY tenant_isolation_insert ON tenants
  FOR INSERT WITH CHECK (auth_id = auth.uid());

CREATE POLICY tenant_isolation_update ON tenants
  FOR UPDATE USING (auth_id = auth.uid());

CREATE POLICY tenant_isolation_delete ON tenants
  FOR DELETE USING (auth_id = auth.uid());

-- tenant_api_keys: subquery through tenants
CREATE POLICY api_key_isolation_select ON tenant_api_keys
  FOR SELECT USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY api_key_isolation_insert ON tenant_api_keys
  FOR INSERT WITH CHECK (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY api_key_isolation_update ON tenant_api_keys
  FOR UPDATE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY api_key_isolation_delete ON tenant_api_keys
  FOR DELETE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

-- github_connections: subquery through tenants
CREATE POLICY github_conn_isolation_select ON github_connections
  FOR SELECT USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY github_conn_isolation_insert ON github_connections
  FOR INSERT WITH CHECK (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY github_conn_isolation_update ON github_connections
  FOR UPDATE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY github_conn_isolation_delete ON github_connections
  FOR DELETE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

-- projects: subquery through tenants
CREATE POLICY project_isolation_select ON projects
  FOR SELECT USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY project_isolation_insert ON projects
  FOR INSERT WITH CHECK (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY project_isolation_update ON projects
  FOR UPDATE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY project_isolation_delete ON projects
  FOR DELETE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

-- tasks: subquery through tenants
CREATE POLICY task_isolation_select ON tasks
  FOR SELECT USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY task_isolation_insert ON tasks
  FOR INSERT WITH CHECK (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY task_isolation_update ON tasks
  FOR UPDATE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY task_isolation_delete ON tasks
  FOR DELETE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

-- pm_outbox: subquery through tenants
CREATE POLICY outbox_isolation_select ON pm_outbox
  FOR SELECT USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY outbox_isolation_insert ON pm_outbox
  FOR INSERT WITH CHECK (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY outbox_isolation_update ON pm_outbox
  FOR UPDATE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY outbox_isolation_delete ON pm_outbox
  FOR DELETE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

-- machines: subquery through tenants (NO user INSERT - only service role creates machines)
CREATE POLICY machine_isolation_select ON machines
  FOR SELECT USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY machine_isolation_update ON machines
  FOR UPDATE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY machine_isolation_delete ON machines
  FOR DELETE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

-- cdt_api_keys: subquery through tenants
CREATE POLICY cdt_key_isolation_select ON cdt_api_keys
  FOR SELECT USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY cdt_key_isolation_insert ON cdt_api_keys
  FOR INSERT WITH CHECK (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY cdt_key_isolation_update ON cdt_api_keys
  FOR UPDATE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));

CREATE POLICY cdt_key_isolation_delete ON cdt_api_keys
  FOR DELETE USING (tenant_id = (SELECT id FROM tenants WHERE auth_id = auth.uid()));
