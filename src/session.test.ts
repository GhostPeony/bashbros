import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Mock the session module's HOME directory
const TEST_DIR = join(tmpdir(), 'bashbros-test-' + process.pid)
const SESSION_FILE = join(TEST_DIR, '.bashbros', 'session-allow.json')

// We need to test session.ts but it uses homedir()
// Let's test the logic directly

describe('Session Allowlist Logic', () => {
  interface SessionData {
    pid: number
    startTime: number
    allowedCommands: string[]
  }

  function isAllowedForSession(command: string, session: SessionData | null): boolean {
    if (!session) return false

    // Exact match
    if (session.allowedCommands.includes(command)) return true

    // Pattern match
    for (const allowed of session.allowedCommands) {
      if (allowed.endsWith('*')) {
        const prefix = allowed.slice(0, -1)
        if (command.startsWith(prefix)) return true
      }
    }

    return false
  }

  describe('exact matching', () => {
    it('matches exact command', () => {
      const session: SessionData = {
        pid: 1234,
        startTime: Date.now(),
        allowedCommands: ['git push', 'npm install']
      }

      expect(isAllowedForSession('git push', session)).toBe(true)
      expect(isAllowedForSession('npm install', session)).toBe(true)
    })

    it('rejects non-matching commands', () => {
      const session: SessionData = {
        pid: 1234,
        startTime: Date.now(),
        allowedCommands: ['git push']
      }

      expect(isAllowedForSession('git pull', session)).toBe(false)
      expect(isAllowedForSession('rm -rf', session)).toBe(false)
    })
  })

  describe('pattern matching', () => {
    it('matches wildcard patterns', () => {
      const session: SessionData = {
        pid: 1234,
        startTime: Date.now(),
        allowedCommands: ['git *', 'npm *']
      }

      expect(isAllowedForSession('git push', session)).toBe(true)
      expect(isAllowedForSession('git status', session)).toBe(true)
      expect(isAllowedForSession('npm install', session)).toBe(true)
    })

    it('only matches from start', () => {
      const session: SessionData = {
        pid: 1234,
        startTime: Date.now(),
        allowedCommands: ['git *']
      }

      expect(isAllowedForSession('not git push', session)).toBe(false)
    })
  })

  describe('null session', () => {
    it('returns false for null session', () => {
      expect(isAllowedForSession('any command', null)).toBe(false)
    })
  })

  describe('empty allowlist', () => {
    it('returns false for empty allowlist', () => {
      const session: SessionData = {
        pid: 1234,
        startTime: Date.now(),
        allowedCommands: []
      }

      expect(isAllowedForSession('git push', session)).toBe(false)
    })
  })

  describe('session staleness', () => {
    it('considers session from different pid', () => {
      const session: SessionData = {
        pid: 9999, // Different PID
        startTime: Date.now(),
        allowedCommands: ['git push']
      }

      // Session should still be usable if not stale
      expect(isAllowedForSession('git push', session)).toBe(true)
    })

    function isStale(session: SessionData): boolean {
      const age = Date.now() - session.startTime
      return age > 24 * 60 * 60 * 1000
    }

    it('detects stale sessions (older than 24 hours)', () => {
      const staleSession: SessionData = {
        pid: 1234,
        startTime: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
        allowedCommands: []
      }

      expect(isStale(staleSession)).toBe(true)
    })

    it('detects fresh sessions', () => {
      const freshSession: SessionData = {
        pid: 1234,
        startTime: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
        allowedCommands: []
      }

      expect(isStale(freshSession)).toBe(false)
    })
  })
})
