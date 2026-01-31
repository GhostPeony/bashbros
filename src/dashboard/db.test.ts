import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DashboardDB } from './db.js'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = '.bashbros-test.db'

describe('DashboardDB', () => {
  let db: DashboardDB

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    db = new DashboardDB(TEST_DB)
  })

  afterEach(() => {
    db.close()
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
  })

  describe('events', () => {
    it('should insert and retrieve events', () => {
      const event = {
        source: 'ward' as const,
        level: 'warn' as const,
        category: 'exposure',
        message: 'Port 3000 exposed without auth',
        data: { port: 3000, agent: 'claude-code' }
      }

      const id = db.insertEvent(event)
      expect(id).toBeDefined()

      const retrieved = db.getEvents({ limit: 10 })
      expect(retrieved.length).toBe(1)
      expect(retrieved[0].message).toBe(event.message)
      expect(retrieved[0].data).toEqual(event.data)
    })

    it('should filter events by source', () => {
      db.insertEvent({ source: 'ward', level: 'info', category: 'test', message: 'ward event' })
      db.insertEvent({ source: 'policy', level: 'info', category: 'test', message: 'policy event' })

      const wardEvents = db.getEvents({ source: 'ward' })
      expect(wardEvents.length).toBe(1)
      expect(wardEvents[0].source).toBe('ward')
    })

    it('should filter events by level', () => {
      db.insertEvent({ source: 'ward', level: 'info', category: 'test', message: 'info' })
      db.insertEvent({ source: 'ward', level: 'error', category: 'test', message: 'error' })

      const errors = db.getEvents({ level: 'error' })
      expect(errors.length).toBe(1)
      expect(errors[0].level).toBe('error')
    })
  })

  describe('connectors', () => {
    it('should track connector activity', () => {
      db.insertConnectorEvent({
        connector: 'mcp-slack',
        method: 'sendMessage',
        direction: 'outbound',
        payload: { redacted: 'Hello [REDACTED:EMAIL]', redactions: [] },
        resourcesAccessed: ['channel:general']
      })

      const events = db.getConnectorEvents('mcp-slack', 10)
      expect(events.length).toBe(1)
      expect(events[0].method).toBe('sendMessage')
    })
  })

  describe('egress blocks', () => {
    it('should track pending blocks', () => {
      const id = db.insertEgressBlock({
        pattern: { name: 'api_key', regex: 'sk-.*', severity: 'critical', action: 'block', category: 'credentials' },
        matchedText: 'sk-abc123...',
        redactedText: '[REDACTED:API_KEY]',
        connector: 'mcp-github'
      })

      const pending = db.getPendingBlocks()
      expect(pending.length).toBe(1)
      expect(pending[0].id).toBe(id)
      expect(pending[0].status).toBe('pending')
    })

    it('should approve blocks', () => {
      const id = db.insertEgressBlock({
        pattern: { name: 'email', regex: '.*@.*', severity: 'medium', action: 'block', category: 'pii' },
        matchedText: 'test@example.com',
        redactedText: 't***@example.com'
      })

      db.approveBlock(id, 'user')

      const block = db.getBlock(id)
      expect(block?.status).toBe('approved')
      expect(block?.approvedBy).toBe('user')
    })
  })

  describe('stats', () => {
    it('should return dashboard stats', () => {
      db.insertEvent({ source: 'ward', level: 'warn', category: 'exposure', message: 'test' })
      db.insertEvent({ source: 'policy', level: 'error', category: 'command', message: 'blocked' })

      const stats = db.getStats()
      expect(stats.totalEvents).toBe(2)
      expect(stats.eventsBySource.ward).toBe(1)
      expect(stats.eventsBySource.policy).toBe(1)
    })
  })

  describe('searchCommands', () => {
    const insertTestCommand = (command: string) => {
      db.insertCommand({
        command,
        allowed: true,
        riskScore: 1,
        riskLevel: 'safe',
        riskFactors: [],
        durationMs: 100,
        violations: []
      })
    }

    it('should find commands matching a query substring', () => {
      insertTestCommand('git status')
      insertTestCommand('git commit -m "fix bug"')
      insertTestCommand('npm install express')

      const results = db.searchCommands('git')
      expect(results.length).toBe(2)
      expect(results.every(r => r.command.includes('git'))).toBe(true)
    })

    it('should respect limit parameter', () => {
      insertTestCommand('git status')
      insertTestCommand('git diff')
      insertTestCommand('git log')
      insertTestCommand('git push')
      insertTestCommand('git pull')

      const results = db.searchCommands('git', 3)
      expect(results.length).toBe(3)
    })

    it('should return empty array for no matches', () => {
      insertTestCommand('git status')
      insertTestCommand('npm install')

      const results = db.searchCommands('docker')
      expect(results).toEqual([])
    })

    it('should be case-insensitive for ASCII characters', () => {
      insertTestCommand('Git Status')
      insertTestCommand('GIT COMMIT')
      insertTestCommand('npm install')

      const results = db.searchCommands('git')
      expect(results.length).toBe(2)
    })

    it('should return CommandRecord objects with correct fields', () => {
      db.insertCommand({
        command: 'rm -rf /tmp/test',
        allowed: false,
        riskScore: 9,
        riskLevel: 'critical',
        riskFactors: ['recursive-delete', 'root-path'],
        durationMs: 50,
        violations: ['blocked-pattern']
      })

      const results = db.searchCommands('rm')
      expect(results.length).toBe(1)
      const cmd = results[0]
      expect(cmd.id).toBeDefined()
      expect(cmd.command).toBe('rm -rf /tmp/test')
      expect(cmd.allowed).toBe(false)
      expect(cmd.riskScore).toBe(9)
      expect(cmd.riskLevel).toBe('critical')
      expect(cmd.riskFactors).toEqual(['recursive-delete', 'root-path'])
      expect(cmd.durationMs).toBe(50)
      expect(cmd.violations).toEqual(['blocked-pattern'])
      expect(cmd.timestamp).toBeInstanceOf(Date)
    })

    it('should order results by timestamp descending', () => {
      insertTestCommand('git first')
      insertTestCommand('git second')
      insertTestCommand('git third')

      const results = db.searchCommands('git')
      // Most recent first
      expect(results[0].command).toBe('git third')
      expect(results[2].command).toBe('git first')
    })

    it('should use default limit of 50', () => {
      for (let i = 0; i < 60; i++) {
        insertTestCommand(`test command ${i}`)
      }

      const results = db.searchCommands('test')
      expect(results.length).toBe(50)
    })
  })
})
