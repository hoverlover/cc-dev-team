-- 003: Performance indexes

CREATE INDEX idx_tasks_project_status ON tasks(project_id, status);

CREATE INDEX idx_tasks_queued ON tasks(project_id, status, submitted_at)
  WHERE status = 'queued';

CREATE INDEX idx_outbox_unread ON pm_outbox(tenant_id, read_at)
  WHERE read_at IS NULL;

CREATE INDEX idx_machines_project ON machines(project_id, status);
