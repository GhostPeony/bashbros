import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DashboardDB } from './db.js'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = join(import.meta.dirname, '..', '..', 'test-metadata.db')

describe('session metadata', () => {
  let db: DashboardDB

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    db = new DashboardDB(TEST_DB)
  })

  afterEach(() => {
    db.close()
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
  })

  it('stores and retrieves session metadata', () => {
    const id = db.insertSessionWithId('test-session', {
      agent: 'claude-code',
      pid: 1234,
      workingDir: '/tmp',
      repoName: null,
      mode: 'hook'
    })

    db.updateSessionMetadata(id, {
      git_branch: 'main',
      git_dirty: false,
      config_profile: 'permissive'
    })

    const session = db.getSession(id)
    expect(session).not.toBeNull()
    expect(session!.metadata).toEqual({
      git_branch: 'main',
      git_dirty: false,
      config_profile: 'permissive'
    })
  })

  it('returns empty metadata by default', () => {
    const id = db.insertSessionWithId('test-session-2', {
      agent: 'claude-code',
      pid: 1234,
      workingDir: '/tmp',
      repoName: null,
      mode: 'hook'
    })

    const session = db.getSession(id)
    expect(session).not.toBeNull()
    expect(session!.metadata).toEqual({})
  })
})
