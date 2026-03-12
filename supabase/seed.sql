-- Dogfooding seed data
-- auth_id is NULL until first GitHub OAuth login links it

INSERT INTO tenants (id, auth_id, name, email, plan)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'cc-dev-team-ops',
  'operator@example.com',
  'pro'
);

INSERT INTO projects (id, tenant_id, name, repo_url, description)
VALUES (
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000001',
  'cc-dev-team',
  'https://github.com/hoverlover/cc-dev-team',
  'The orchestrator itself — dogfooding'
);

INSERT INTO cdt_api_keys (tenant_id, key_hash, key_prefix, label)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '$2b$10$placeholder',
  'cdt_test',
  'Dogfooding key'
);
