import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PATTERNS,
  EgressPatternMatcher,
} from './patterns.js'

describe('DEFAULT_PATTERNS', () => {
  describe('credential patterns', () => {
    it('has api_key pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'api_key')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('credentials')
    })

    it('has aws_secret pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'aws_secret')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('credentials')
    })

    it('has private_key pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'private_key')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('credentials')
    })

    it('has github_token pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'github_token')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('credentials')
    })

    it('has openai_key pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'openai_key')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('credentials')
    })

    it('has jwt_token pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'jwt_token')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('credentials')
    })
  })

  describe('PII patterns', () => {
    it('has ssn pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'ssn')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('pii')
    })

    it('has credit_card pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'credit_card')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('pii')
    })

    it('has email pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'email')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('pii')
    })

    it('has phone_us pattern', () => {
      const pattern = DEFAULT_PATTERNS.find(p => p.name === 'phone_us')
      expect(pattern).toBeDefined()
      expect(pattern!.category).toBe('pii')
    })
  })
})

describe('EgressPatternMatcher', () => {
  describe('match()', () => {
    const matcher = new EgressPatternMatcher()

    it('detects API keys', () => {
      const text = 'api_key=sk_live_abc123xyz456789012345'
      const matches = matcher.match(text)
      expect(matches.length).toBeGreaterThan(0)
      expect(matches.some(m => m.pattern.name === 'api_key')).toBe(true)
    })

    it('detects AWS secrets', () => {
      const text = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      const matches = matcher.match(text)
      expect(matches.length).toBeGreaterThan(0)
      expect(matches.some(m => m.pattern.name === 'aws_secret')).toBe(true)
    })

    it('detects private keys', () => {
      const text = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpQIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
      const matches = matcher.match(text)
      expect(matches.length).toBeGreaterThan(0)
      expect(matches.some(m => m.pattern.name === 'private_key')).toBe(true)
    })

    it('detects SSNs', () => {
      const text = 'SSN: 123-45-6789'
      const matches = matcher.match(text)
      expect(matches.length).toBeGreaterThan(0)
      expect(matches.some(m => m.pattern.name === 'ssn')).toBe(true)
    })

    it('detects credit cards', () => {
      const text = 'Card: 4111-1111-1111-1111'
      const matches = matcher.match(text)
      expect(matches.length).toBeGreaterThan(0)
      expect(matches.some(m => m.pattern.name === 'credit_card')).toBe(true)
    })

    it('does not match safe text', () => {
      const text = 'Hello, this is a normal message with no sensitive data.'
      const matches = matcher.match(text)
      expect(matches.length).toBe(0)
    })
  })

  describe('redact()', () => {
    const matcher = new EgressPatternMatcher()

    it('replaces sensitive data with [REDACTED:TYPE] placeholders', () => {
      const text = 'My SSN is 123-45-6789'
      const result = matcher.redact(text)
      expect(result.redacted).toBe('My SSN is [REDACTED:ssn]')
      expect(result.redactions.length).toBe(1)
      expect(result.redactions[0].type).toBe('ssn')
      expect(result.redactions[0].replacement).toBe('[REDACTED:ssn]')
    })

    it('handles multiple patterns in same text', () => {
      const text = 'SSN: 123-45-6789, Email: test@example.com'
      const result = matcher.redact(text)
      expect(result.redacted).toContain('[REDACTED:ssn]')
      expect(result.redacted).toContain('[REDACTED:email]')
      expect(result.redactions.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('addPattern()', () => {
    it('allows adding custom patterns', () => {
      const matcher = new EgressPatternMatcher()
      const initialCount = matcher.getPatterns().length

      matcher.addPattern({
        name: 'custom_secret',
        regex: 'SECRET_[A-Z0-9]+',
        severity: 'high',
        action: 'block',
        category: 'custom',
        description: 'Custom secret pattern',
      })

      expect(matcher.getPatterns().length).toBe(initialCount + 1)

      const text = 'SECRET_ABC123'
      const matches = matcher.match(text)
      expect(matches.some(m => m.pattern.name === 'custom_secret')).toBe(true)
    })
  })

  describe('shouldBlock()', () => {
    const matcher = new EgressPatternMatcher()

    it('returns true when blocking pattern matches', () => {
      // AWS secrets should trigger block
      const text = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      expect(matcher.shouldBlock(text)).toBe(true)
    })

    it('returns false for safe text', () => {
      const text = 'Hello, this is safe text'
      expect(matcher.shouldBlock(text)).toBe(false)
    })
  })

  describe('getHighestSeverity()', () => {
    const matcher = new EgressPatternMatcher()

    it('returns highest severity from matches', () => {
      // AWS secrets are critical, email is low
      const text = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY and email@test.com'
      const severity = matcher.getHighestSeverity(text)
      expect(severity).toBe('critical')
    })

    it('returns null for safe text', () => {
      const text = 'Hello, this is safe text'
      expect(matcher.getHighestSeverity(text)).toBeNull()
    })
  })

  describe('test()', () => {
    const matcher = new EgressPatternMatcher()

    it('returns matches, shouldBlock, and redacted', () => {
      const text = 'SSN: 123-45-6789'
      const result = matcher.test(text)
      expect(result.matches).toBeDefined()
      expect(result.matches.length).toBeGreaterThan(0)
      expect(typeof result.shouldBlock).toBe('boolean')
      expect(result.redacted).toBeDefined()
      expect(result.redacted.redacted).toContain('[REDACTED:ssn]')
    })
  })

  describe('getPatterns()', () => {
    it('returns all patterns', () => {
      const matcher = new EgressPatternMatcher()
      const patterns = matcher.getPatterns()
      expect(patterns.length).toBe(DEFAULT_PATTERNS.length)
    })
  })
})
