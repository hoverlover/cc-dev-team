import { describe, it, expect } from 'vitest'
import { getTableColumns, getTableName } from 'drizzle-orm'
import { tenants } from '../../src/db/schema/tenants'
import { tenantApiKeys, cdtApiKeys } from '../../src/db/schema/api-keys'
import { githubConnections } from '../../src/db/schema/github'
import { projects } from '../../src/db/schema/projects'
import { tasks } from '../../src/db/schema/tasks'
import { pmOutbox } from '../../src/db/schema/pm-outbox'
import { machines } from '../../src/db/schema/machines'

describe('Drizzle schema', () => {
  describe('tenants', () => {
    it('has correct table name', () => {
      expect(getTableName(tenants)).toBe('tenants')
    })

    it('has all required columns', () => {
      const cols = getTableColumns(tenants)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('authId')
      expect(cols).toHaveProperty('name')
      expect(cols).toHaveProperty('email')
      expect(cols).toHaveProperty('githubId')
      expect(cols).toHaveProperty('avatarUrl')
      expect(cols).toHaveProperty('plan')
      expect(cols).toHaveProperty('createdAt')
      expect(cols).toHaveProperty('updatedAt')
    })
  })

  describe('tenant_api_keys', () => {
    it('has correct table name', () => {
      expect(getTableName(tenantApiKeys)).toBe('tenant_api_keys')
    })

    it('has all required columns', () => {
      const cols = getTableColumns(tenantApiKeys)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('tenantId')
      expect(cols).toHaveProperty('provider')
      expect(cols).toHaveProperty('vaultSecretId')
      expect(cols).toHaveProperty('label')
      expect(cols).toHaveProperty('isDefault')
      expect(cols).toHaveProperty('createdAt')
    })
  })

  describe('cdt_api_keys', () => {
    it('has correct table name', () => {
      expect(getTableName(cdtApiKeys)).toBe('cdt_api_keys')
    })

    it('has all required columns', () => {
      const cols = getTableColumns(cdtApiKeys)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('tenantId')
      expect(cols).toHaveProperty('keyHash')
      expect(cols).toHaveProperty('keyPrefix')
      expect(cols).toHaveProperty('label')
      expect(cols).toHaveProperty('lastUsed')
      expect(cols).toHaveProperty('createdAt')
    })
  })

  describe('github_connections', () => {
    it('has correct table name', () => {
      expect(getTableName(githubConnections)).toBe('github_connections')
    })

    it('has all required columns', () => {
      const cols = getTableColumns(githubConnections)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('tenantId')
      expect(cols).toHaveProperty('githubUserId')
      expect(cols).toHaveProperty('githubUsername')
      expect(cols).toHaveProperty('tokenVaultId')
      expect(cols).toHaveProperty('tokenType')
      expect(cols).toHaveProperty('scopes')
      expect(cols).toHaveProperty('installationId')
      expect(cols).toHaveProperty('createdAt')
    })
  })

  describe('projects', () => {
    it('has correct table name', () => {
      expect(getTableName(projects)).toBe('projects')
    })

    it('has all required columns', () => {
      const cols = getTableColumns(projects)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('tenantId')
      expect(cols).toHaveProperty('name')
      expect(cols).toHaveProperty('repoUrl')
      expect(cols).toHaveProperty('repoFullName')
      expect(cols).toHaveProperty('description')
      expect(cols).toHaveProperty('status')
      expect(cols).toHaveProperty('flyVolumeId')
      expect(cols).toHaveProperty('providerConfig')
      expect(cols).toHaveProperty('createdAt')
      expect(cols).toHaveProperty('updatedAt')
    })
  })

  describe('tasks', () => {
    it('has correct table name', () => {
      expect(getTableName(tasks)).toBe('tasks')
    })

    it('has all required columns', () => {
      const cols = getTableColumns(tasks)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('projectId')
      expect(cols).toHaveProperty('tenantId')
      expect(cols).toHaveProperty('title')
      expect(cols).toHaveProperty('description')
      expect(cols).toHaveProperty('status')
      expect(cols).toHaveProperty('priority')
      expect(cols).toHaveProperty('submittedAt')
      expect(cols).toHaveProperty('startedAt')
      expect(cols).toHaveProperty('completedAt')
      expect(cols).toHaveProperty('resultSummary')
      expect(cols).toHaveProperty('githubPrUrl')
      expect(cols).toHaveProperty('githubIssueUrl')
      expect(cols).toHaveProperty('error')
      expect(cols).toHaveProperty('costTokens')
      expect(cols).toHaveProperty('costUsd')
      expect(cols).toHaveProperty('metadata')
    })
  })

  describe('pm_outbox', () => {
    it('has correct table name', () => {
      expect(getTableName(pmOutbox)).toBe('pm_outbox')
    })

    it('has all required columns', () => {
      const cols = getTableColumns(pmOutbox)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('taskId')
      expect(cols).toHaveProperty('tenantId')
      expect(cols).toHaveProperty('type')
      expect(cols).toHaveProperty('content')
      expect(cols).toHaveProperty('requiresResponse')
      expect(cols).toHaveProperty('response')
      expect(cols).toHaveProperty('respondedAt')
      expect(cols).toHaveProperty('createdAt')
      expect(cols).toHaveProperty('readAt')
    })
  })

  describe('machines', () => {
    it('has correct table name', () => {
      expect(getTableName(machines)).toBe('machines')
    })

    it('has all required columns', () => {
      const cols = getTableColumns(machines)
      expect(cols).toHaveProperty('id')
      expect(cols).toHaveProperty('projectId')
      expect(cols).toHaveProperty('tenantId')
      expect(cols).toHaveProperty('taskId')
      expect(cols).toHaveProperty('flyMachineId')
      expect(cols).toHaveProperty('flyAppName')
      expect(cols).toHaveProperty('status')
      expect(cols).toHaveProperty('createdAt')
      expect(cols).toHaveProperty('updatedAt')
      expect(cols).toHaveProperty('agents')
      expect(cols).toHaveProperty('costSummary')
    })
  })

  describe('schema index re-exports', () => {
    it('exports all tables from index', async () => {
      const schema = await import('../../src/db/schema/index')
      expect(schema).toHaveProperty('tenants')
      expect(schema).toHaveProperty('tenantApiKeys')
      expect(schema).toHaveProperty('cdtApiKeys')
      expect(schema).toHaveProperty('githubConnections')
      expect(schema).toHaveProperty('projects')
      expect(schema).toHaveProperty('tasks')
      expect(schema).toHaveProperty('pmOutbox')
      expect(schema).toHaveProperty('machines')
    })
  })
})
