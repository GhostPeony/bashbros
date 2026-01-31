import { describe, it, expect } from 'vitest'
import type { PolicyViolation, SessionStartConfig } from './types.js'

describe('PolicyViolation type', () => {
  it('accepts remediation and severity fields', () => {
    const v: PolicyViolation = {
      type: 'command',
      rule: 'test',
      message: 'blocked',
      remediation: ['bashbros allow "curl *" --once'],
      severity: 'medium'
    }
    expect(v.remediation).toHaveLength(1)
    expect(v.severity).toBe('medium')
  })

  it('works without optional fields (backward compat)', () => {
    const v: PolicyViolation = {
      type: 'command',
      rule: 'test',
      message: 'blocked'
    }
    expect(v.remediation).toBeUndefined()
    expect(v.severity).toBeUndefined()
  })
})

describe('SessionStartConfig type', () => {
  it('has all required fields', () => {
    const config: SessionStartConfig = {
      enabled: true,
      collectMetadata: true,
      ollamaStatus: false,
      preloadContext: true
    }
    expect(config.enabled).toBe(true)
  })
})
