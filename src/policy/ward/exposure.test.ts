import { describe, it, expect } from 'vitest'
import {
  DEFAULT_AGENT_SIGNATURES,
  DEFAULT_SEVERITY_ACTIONS,
  ExposureScanner,
} from './exposure.js'
import type { ExposureSeverity, ExposureAction } from './types.js'

describe('DEFAULT_AGENT_SIGNATURES', () => {
  it('has claude-code signature', () => {
    const claudeCode = DEFAULT_AGENT_SIGNATURES.find(a => a.name === 'claude-code')
    expect(claudeCode).toBeDefined()
    expect(claudeCode!.processNames).toContain('claude')
    expect(claudeCode!.defaultPorts).toContain(3000)
  })

  it('has aider signature', () => {
    const aider = DEFAULT_AGENT_SIGNATURES.find(a => a.name === 'aider')
    expect(aider).toBeDefined()
    expect(aider!.processNames).toContain('aider')
    expect(aider!.defaultPorts).toContain(8501)
  })

  it('has continue signature', () => {
    const continueAgent = DEFAULT_AGENT_SIGNATURES.find(a => a.name === 'continue')
    expect(continueAgent).toBeDefined()
  })

  it('has cursor signature', () => {
    const cursor = DEFAULT_AGENT_SIGNATURES.find(a => a.name === 'cursor')
    expect(cursor).toBeDefined()
  })
})

describe('ExposureScanner', () => {
  describe('assessSeverity', () => {
    const scanner = new ExposureScanner()

    it('returns low for localhost binding with auth', () => {
      const severity = scanner.assessSeverity({
        bindAddress: '127.0.0.1',
        hasAuth: true,
        externallyReachable: false,
        hasActiveSessions: false,
      })
      expect(severity).toBe('low')
    })

    it('returns medium for localhost binding without auth', () => {
      const severity = scanner.assessSeverity({
        bindAddress: '127.0.0.1',
        hasAuth: false,
        externallyReachable: false,
        hasActiveSessions: false,
      })
      expect(severity).toBe('medium')
    })

    it('returns high for 0.0.0.0 binding without auth', () => {
      const severity = scanner.assessSeverity({
        bindAddress: '0.0.0.0',
        hasAuth: false,
        externallyReachable: false,
        hasActiveSessions: false,
      })
      expect(severity).toBe('high')
    })

    it('returns critical for externally reachable without auth', () => {
      const severity = scanner.assessSeverity({
        bindAddress: '0.0.0.0',
        hasAuth: false,
        externallyReachable: true,
        hasActiveSessions: false,
      })
      expect(severity).toBe('critical')
    })

    it('returns critical for externally reachable with active sessions', () => {
      const severity = scanner.assessSeverity({
        bindAddress: '0.0.0.0',
        hasAuth: false,
        externallyReachable: true,
        hasActiveSessions: true,
      })
      expect(severity).toBe('critical')
    })

    it('downgrades severity when auth is present', () => {
      const withoutAuth = scanner.assessSeverity({
        bindAddress: '0.0.0.0',
        hasAuth: false,
        externallyReachable: false,
        hasActiveSessions: false,
      })
      const withAuth = scanner.assessSeverity({
        bindAddress: '0.0.0.0',
        hasAuth: true,
        externallyReachable: false,
        hasActiveSessions: false,
      })
      expect(withAuth).not.toBe('critical')
      expect(withoutAuth).toBe('high')
    })
  })

  describe('getActionForSeverity', () => {
    const scanner = new ExposureScanner()

    it('returns alert for low severity', () => {
      expect(scanner.getActionForSeverity('low')).toBe('alert')
    })

    it('returns alert for medium severity', () => {
      expect(scanner.getActionForSeverity('medium')).toBe('alert')
    })

    it('returns block for high severity', () => {
      expect(scanner.getActionForSeverity('high')).toBe('block')
    })

    it('returns block_and_kill for critical severity', () => {
      expect(scanner.getActionForSeverity('critical')).toBe('block_and_kill')
    })
  })

  describe('parseNetstatLine', () => {
    const scanner = new ExposureScanner()

    it('parses standard Windows netstat output', () => {
      const line = '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345'
      const result = scanner.parseNetstatLine(line)
      expect(result).toEqual({
        protocol: 'TCP',
        localAddress: '0.0.0.0',
        localPort: 3000,
        state: 'LISTENING',
        pid: 12345,
      })
    })

    it('parses localhost binding', () => {
      const line = '  TCP    127.0.0.1:8080         0.0.0.0:0              LISTENING       5678'
      const result = scanner.parseNetstatLine(line)
      expect(result).toEqual({
        protocol: 'TCP',
        localAddress: '127.0.0.1',
        localPort: 8080,
        state: 'LISTENING',
        pid: 5678,
      })
    })

    it('parses IPv6 localhost', () => {
      const line = '  TCP    [::1]:3000             [::]:0                 LISTENING       9999'
      const result = scanner.parseNetstatLine(line)
      expect(result).toEqual({
        protocol: 'TCP',
        localAddress: '::1',
        localPort: 3000,
        state: 'LISTENING',
        pid: 9999,
      })
    })

    it('parses IPv6 any binding', () => {
      const line = '  TCP    [::]:8000              [::]:0                 LISTENING       1111'
      const result = scanner.parseNetstatLine(line)
      expect(result).toEqual({
        protocol: 'TCP',
        localAddress: '::',
        localPort: 8000,
        state: 'LISTENING',
        pid: 1111,
      })
    })

    it('returns null for non-listening lines', () => {
      const line = '  TCP    192.168.1.100:52341    142.250.80.46:443      ESTABLISHED     2222'
      const result = scanner.parseNetstatLine(line)
      expect(result).toBeNull()
    })

    it('returns null for header lines', () => {
      const line = '  Proto  Local Address          Foreign Address        State           PID'
      const result = scanner.parseNetstatLine(line)
      expect(result).toBeNull()
    })

    it('returns null for empty lines', () => {
      expect(scanner.parseNetstatLine('')).toBeNull()
      expect(scanner.parseNetstatLine('   ')).toBeNull()
    })
  })

  describe('addAgent and getAgents', () => {
    it('adds custom agent signature', () => {
      const scanner = new ExposureScanner()
      const initialCount = scanner.getAgents().length

      scanner.addAgent({
        name: 'custom-agent',
        processNames: ['custom'],
        defaultPorts: [9000],
        configPaths: [],
        authIndicators: [],
      })

      expect(scanner.getAgents().length).toBe(initialCount + 1)
      const custom = scanner.getAgents().find(a => a.name === 'custom-agent')
      expect(custom).toBeDefined()
    })
  })

  describe('DEFAULT_SEVERITY_ACTIONS', () => {
    it('maps severity to correct actions', () => {
      expect(DEFAULT_SEVERITY_ACTIONS.low).toBe('alert')
      expect(DEFAULT_SEVERITY_ACTIONS.medium).toBe('alert')
      expect(DEFAULT_SEVERITY_ACTIONS.high).toBe('block')
      expect(DEFAULT_SEVERITY_ACTIONS.critical).toBe('block_and_kill')
    })
  })
})
