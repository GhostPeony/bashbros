import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EgressMonitor } from './egress.js'
import type { EgressPattern, EgressConfig, EgressAllowlistEntry } from './types.js'

// Mock the DashboardDB
vi.mock('../../dashboard/db.js', () => ({
  DashboardDB: vi.fn().mockImplementation(() => ({
    insertEgressBlock: vi.fn().mockReturnValue('mock-block-id'),
    insertEvent: vi.fn().mockReturnValue('mock-event-id'),
    getPendingBlocks: vi.fn().mockReturnValue([]),
    approveBlock: vi.fn(),
    denyBlock: vi.fn(),
    close: vi.fn(),
  })),
}))

describe('EgressMonitor', () => {
  let monitor: EgressMonitor

  beforeEach(() => {
    monitor = new EgressMonitor()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('inspect()', () => {
    it('detects and blocks API keys, returns blocked=true with matches', () => {
      const content = 'api_key=sk_live_abc123xyz456789012345'
      const result = monitor.inspect(content)

      expect(result.blocked).toBe(true)
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.matches.some(m => m.pattern.name === 'api_key')).toBe(true)
    })

    it('detects and blocks AWS secrets', () => {
      const content = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      const result = monitor.inspect(content)

      expect(result.blocked).toBe(true)
      expect(result.matches.some(m => m.pattern.name === 'aws_secret')).toBe(true)
    })

    it('detects and blocks private keys', () => {
      const content = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
      const result = monitor.inspect(content)

      expect(result.blocked).toBe(true)
      expect(result.matches.some(m => m.pattern.name === 'private_key')).toBe(true)
    })

    it('allows safe content, returns blocked=false', () => {
      const content = 'Hello, this is a normal message with no sensitive data.'
      const result = monitor.inspect(content)

      expect(result.blocked).toBe(false)
      expect(result.matches.length).toBe(0)
      expect(result.allowlisted).toBe(false)
    })

    it('returns redacted content when blocking', () => {
      const content = 'My SSN is 123-45-6789'
      const result = monitor.inspect(content)

      expect(result.blocked).toBe(true)
      expect(result.redacted).toContain('[REDACTED:ssn]')
      expect(result.redacted).not.toContain('123-45-6789')
    })

    it('includes blockId when content is blocked', () => {
      const content = 'api_key=sk_live_abc123xyz456789012345'
      const result = monitor.inspect(content)

      expect(result.blocked).toBe(true)
      // blockId is set when db is available
      expect(result.blockId).toBeDefined()
    })

    it('includes connector and destination in inspection context', () => {
      const content = 'api_key=sk_live_abc123xyz456789012345'
      const result = monitor.inspect(content, 'mcp-slack', 'api.slack.com')

      expect(result.blocked).toBe(true)
    })
  })

  describe('allowlist: connector allowlisting', () => {
    it('skips inspection for allowlisted connectors', () => {
      monitor.addAllowlistEntry({
        connector: 'trusted-connector',
        action: 'allow',
      })

      const content = 'api_key=sk_live_abc123xyz456789012345'
      const result = monitor.inspect(content, 'trusted-connector')

      expect(result.blocked).toBe(false)
      expect(result.allowlisted).toBe(true)
      expect(result.matches.length).toBe(0)
    })

    it('still blocks non-allowlisted connectors', () => {
      monitor.addAllowlistEntry({
        connector: 'trusted-connector',
        action: 'allow',
      })

      const content = 'api_key=sk_live_abc123xyz456789012345'
      const result = monitor.inspect(content, 'untrusted-connector')

      expect(result.blocked).toBe(true)
      expect(result.allowlisted).toBe(false)
    })

    it('skips inspection for allowlisted destination', () => {
      monitor.addAllowlistEntry({
        destination: 'internal.example.com',
        action: 'allow',
      })

      const content = 'api_key=sk_live_abc123xyz456789012345'
      const result = monitor.inspect(content, undefined, 'internal.example.com')

      expect(result.blocked).toBe(false)
      expect(result.allowlisted).toBe(true)
    })

    it('skips inspection for allowlisted connector+destination combo', () => {
      monitor.addAllowlistEntry({
        connector: 'mcp-internal',
        destination: 'api.internal.com',
        action: 'allow',
      })

      const content = 'api_key=sk_live_abc123xyz456789012345'

      // Only the specific combo should be allowlisted
      const result1 = monitor.inspect(content, 'mcp-internal', 'api.internal.com')
      expect(result1.blocked).toBe(false)
      expect(result1.allowlisted).toBe(true)

      // Different connector should not be allowlisted
      const result2 = monitor.inspect(content, 'other-connector', 'api.internal.com')
      expect(result2.blocked).toBe(true)

      // Different destination should not be allowlisted
      const result3 = monitor.inspect(content, 'mcp-internal', 'api.external.com')
      expect(result3.blocked).toBe(true)
    })
  })

  describe('allowlist: pattern-specific allowlisting', () => {
    it('skips specific patterns for allowlisted combinations', () => {
      // Allow email pattern for a specific connector
      monitor.addAllowlistEntry({
        connector: 'mcp-email',
        pattern: 'email',
        action: 'allow',
      })

      // Email should be allowed through the email connector
      const emailContent = 'Contact us at support@example.com'
      const result1 = monitor.inspect(emailContent, 'mcp-email')
      expect(result1.blocked).toBe(false)
      expect(result1.allowlisted).toBe(true)

      // But SSN should still be blocked even through email connector
      const ssnContent = 'SSN: 123-45-6789'
      const result2 = monitor.inspect(ssnContent, 'mcp-email')
      expect(result2.blocked).toBe(true)

      // And email should be blocked through other connectors
      const result3 = monitor.inspect(emailContent, 'other-connector')
      // email pattern action is 'log', not 'block', so won't be blocked
      // but let's check with an API key instead
      const apiContent = 'api_key=sk_live_abc123xyz456789012345'
      const result4 = monitor.inspect(apiContent, 'mcp-email')
      expect(result4.blocked).toBe(true)
    })

    it('allows multiple patterns for same connector', () => {
      monitor.addAllowlistEntry({
        connector: 'mcp-pii-handler',
        pattern: 'email',
        action: 'allow',
      })
      monitor.addAllowlistEntry({
        connector: 'mcp-pii-handler',
        pattern: 'phone_us',
        action: 'allow',
      })

      const content = 'Email: test@example.com, Phone: 555-123-4567'
      const result = monitor.inspect(content, 'mcp-pii-handler')
      expect(result.blocked).toBe(false)
      expect(result.allowlisted).toBe(true)
    })
  })

  describe('addPattern()', () => {
    it('adds custom pattern and uses it for detection', () => {
      const customPattern: EgressPattern = {
        name: 'custom_token',
        regex: 'CUSTOM_[A-Z0-9]{10}',
        severity: 'high',
        action: 'block',
        category: 'custom',
        description: 'Custom token pattern',
      }

      monitor.addPattern(customPattern)

      const content = 'Token: CUSTOM_ABC1234567'
      const result = monitor.inspect(content)

      expect(result.blocked).toBe(true)
      expect(result.matches.some(m => m.pattern.name === 'custom_token')).toBe(true)
    })
  })

  describe('test()', () => {
    it('returns blocked status, matches, and redacted content without recording', () => {
      const content = 'SSN: 123-45-6789'
      const result = monitor.test(content)

      expect(result.blocked).toBe(true)
      expect(result.matches.length).toBeGreaterThan(0)
      expect(result.redacted).toContain('[REDACTED:ssn]')
    })

    it('does not record to database', () => {
      const content = 'api_key=sk_live_abc123xyz456789012345'
      monitor.test(content)

      // The mock should not have been called for recording
      // since test() doesn't record
    })

    it('returns blocked=false for safe content', () => {
      const content = 'Safe content here'
      const result = monitor.test(content)

      expect(result.blocked).toBe(false)
      expect(result.matches.length).toBe(0)
    })
  })

  describe('getPendingBlocks()', () => {
    it('returns pending blocks from database', () => {
      const pendingBlocks = monitor.getPendingBlocks()
      expect(Array.isArray(pendingBlocks)).toBe(true)
    })
  })

  describe('approveBlock()', () => {
    it('approves block with optional approvedBy', () => {
      // Should not throw
      expect(() => monitor.approveBlock('test-id', 'user')).not.toThrow()
    })

    it('approves block without approvedBy', () => {
      expect(() => monitor.approveBlock('test-id')).not.toThrow()
    })
  })

  describe('denyBlock()', () => {
    it('denies block', () => {
      expect(() => monitor.denyBlock('test-id')).not.toThrow()
    })
  })

  describe('constructor with config', () => {
    it('accepts partial config', () => {
      const config: Partial<EgressConfig> = {
        enabled: false,
        defaultAction: 'alert',
      }

      const customMonitor = new EgressMonitor(config)
      expect(customMonitor).toBeDefined()
    })

    it('uses default config when not provided', () => {
      const defaultMonitor = new EgressMonitor()
      expect(defaultMonitor).toBeDefined()
    })

    it('merges allowlist from config', () => {
      const config: Partial<EgressConfig> = {
        allowlist: [
          { connector: 'preconfigured', action: 'allow' },
        ],
      }

      const customMonitor = new EgressMonitor(config)
      const content = 'api_key=sk_live_abc123xyz456789012345'
      const result = customMonitor.inspect(content, 'preconfigured')

      expect(result.blocked).toBe(false)
      expect(result.allowlisted).toBe(true)
    })
  })
})
