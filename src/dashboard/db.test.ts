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
})
