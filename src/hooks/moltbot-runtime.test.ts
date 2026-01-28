import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  detectMoltbotSession,
  isInMoltbotSession,
  getMoltbotSessionId,
  getMoltbotAgentName,
  isSandboxEnabled,
  getCustomConfigPath,
  getStateDir
} from './moltbot-runtime.js'

describe('moltbot-runtime', () => {
  // Save original env
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear moltbot-related env vars
    delete process.env.MOLTBOT_SESSION_ID
    delete process.env.MOLTBOT_AGENT
    delete process.env.MOLTBOT_SANDBOX
    delete process.env.CLAWDBOT_SESSION_ID
    delete process.env.CLAWDBOT_AGENT
    delete process.env.CLAWDBOT_CONFIG_PATH
    delete process.env.CLAWDBOT_STATE_DIR
  })

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv }
  })

  describe('detectMoltbotSession', () => {
    it('returns not in session when no env vars set', () => {
      const context = detectMoltbotSession()
      expect(context.inMoltbotSession).toBe(false)
      expect(context.sessionId).toBeUndefined()
      expect(context.agentName).toBeUndefined()
    })

    it('detects moltbot session from MOLTBOT_SESSION_ID', () => {
      process.env.MOLTBOT_SESSION_ID = 'test-session-123'
      process.env.MOLTBOT_AGENT = 'claude-3-opus'

      const context = detectMoltbotSession()
      expect(context.inMoltbotSession).toBe(true)
      expect(context.sessionId).toBe('test-session-123')
      expect(context.agentName).toBe('claude-3-opus')
    })

    it('detects clawdbot session from legacy env vars', () => {
      process.env.CLAWDBOT_SESSION_ID = 'legacy-session-456'
      process.env.CLAWDBOT_AGENT = 'gpt-4'

      const context = detectMoltbotSession()
      expect(context.inMoltbotSession).toBe(true)
      expect(context.sessionId).toBe('legacy-session-456')
      expect(context.agentName).toBe('gpt-4')
    })

    it('prefers moltbot env vars over clawdbot', () => {
      process.env.MOLTBOT_SESSION_ID = 'moltbot-session'
      process.env.CLAWDBOT_SESSION_ID = 'clawdbot-session'

      const context = detectMoltbotSession()
      expect(context.sessionId).toBe('moltbot-session')
    })

    it('detects sandbox mode', () => {
      process.env.MOLTBOT_SESSION_ID = 'test'
      process.env.MOLTBOT_SANDBOX = 'strict'

      const context = detectMoltbotSession()
      expect(context.sandboxMode).toBe(true)
    })

    it('detects sandbox off', () => {
      process.env.MOLTBOT_SESSION_ID = 'test'
      process.env.MOLTBOT_SANDBOX = 'off'

      const context = detectMoltbotSession()
      expect(context.sandboxMode).toBe(false)
    })

    it('includes custom config path', () => {
      process.env.CLAWDBOT_CONFIG_PATH = '/custom/path/config.json'

      const context = detectMoltbotSession()
      expect(context.customConfigPath).toBe('/custom/path/config.json')
    })
  })

  describe('isInMoltbotSession', () => {
    it('returns false when no session', () => {
      expect(isInMoltbotSession()).toBe(false)
    })

    it('returns true with MOLTBOT_SESSION_ID', () => {
      process.env.MOLTBOT_SESSION_ID = 'test'
      expect(isInMoltbotSession()).toBe(true)
    })

    it('returns true with MOLTBOT_AGENT', () => {
      process.env.MOLTBOT_AGENT = 'test-agent'
      expect(isInMoltbotSession()).toBe(true)
    })

    it('returns true with legacy CLAWDBOT vars', () => {
      process.env.CLAWDBOT_SESSION_ID = 'test'
      expect(isInMoltbotSession()).toBe(true)
    })
  })

  describe('getMoltbotSessionId', () => {
    it('returns undefined when not set', () => {
      expect(getMoltbotSessionId()).toBeUndefined()
    })

    it('returns MOLTBOT_SESSION_ID when set', () => {
      process.env.MOLTBOT_SESSION_ID = 'session-abc'
      expect(getMoltbotSessionId()).toBe('session-abc')
    })

    it('falls back to CLAWDBOT_SESSION_ID', () => {
      process.env.CLAWDBOT_SESSION_ID = 'legacy-session'
      expect(getMoltbotSessionId()).toBe('legacy-session')
    })
  })

  describe('getMoltbotAgentName', () => {
    it('returns undefined when not set', () => {
      expect(getMoltbotAgentName()).toBeUndefined()
    })

    it('returns MOLTBOT_AGENT when set', () => {
      process.env.MOLTBOT_AGENT = 'claude-opus'
      expect(getMoltbotAgentName()).toBe('claude-opus')
    })

    it('falls back to CLAWDBOT_AGENT', () => {
      process.env.CLAWDBOT_AGENT = 'gpt-4-turbo'
      expect(getMoltbotAgentName()).toBe('gpt-4-turbo')
    })
  })

  describe('isSandboxEnabled', () => {
    it('returns true by default (no MOLTBOT_SANDBOX)', () => {
      expect(isSandboxEnabled()).toBe(true)
    })

    it('returns false when MOLTBOT_SANDBOX is off', () => {
      process.env.MOLTBOT_SANDBOX = 'off'
      expect(isSandboxEnabled()).toBe(false)
    })

    it('returns true for any other MOLTBOT_SANDBOX value', () => {
      process.env.MOLTBOT_SANDBOX = 'strict'
      expect(isSandboxEnabled()).toBe(true)

      process.env.MOLTBOT_SANDBOX = 'permissive'
      expect(isSandboxEnabled()).toBe(true)
    })
  })

  describe('getCustomConfigPath', () => {
    it('returns undefined when not set', () => {
      expect(getCustomConfigPath()).toBeUndefined()
    })

    it('returns CLAWDBOT_CONFIG_PATH when set', () => {
      process.env.CLAWDBOT_CONFIG_PATH = '/path/to/config.json'
      expect(getCustomConfigPath()).toBe('/path/to/config.json')
    })
  })

  describe('getStateDir', () => {
    it('returns undefined when not set', () => {
      expect(getStateDir()).toBeUndefined()
    })

    it('returns CLAWDBOT_STATE_DIR when set', () => {
      process.env.CLAWDBOT_STATE_DIR = '/path/to/state'
      expect(getStateDir()).toBe('/path/to/state')
    })
  })
})
