import { describe, it, expect, vi } from 'vitest'
import {
  detectCapabilityTier,
  sessionSummary,
  traceSearch,
  historySuggest,
  secretScan,
  codeTask,
} from './tools.js'

describe('detectCapabilityTier', () => {
  it('returns basic for small models', () => {
    expect(detectCapabilityTier('7B')).toBe('basic')
    expect(detectCapabilityTier('3.8B')).toBe('basic')
    expect(detectCapabilityTier('13B')).toBe('basic')
  })

  it('returns moderate for mid-size models', () => {
    expect(detectCapabilityTier('14B')).toBe('moderate')
    expect(detectCapabilityTier('32B')).toBe('moderate')
    expect(detectCapabilityTier('27B')).toBe('moderate')
  })

  it('returns advanced for large models', () => {
    expect(detectCapabilityTier('33B')).toBe('advanced')
    expect(detectCapabilityTier('70B')).toBe('advanced')
    expect(detectCapabilityTier('120B')).toBe('advanced')
  })

  it('returns basic for unrecognized format', () => {
    expect(detectCapabilityTier('')).toBe('basic')
    expect(detectCapabilityTier('unknown')).toBe('basic')
  })

  it('handles M suffix (millions of params)', () => {
    expect(detectCapabilityTier('500M')).toBe('basic')
  })
})

describe('secretScan', () => {
  it('detects secrets via guard', () => {
    const guard = {
      scanText: vi.fn().mockReturnValue({
        clean: false,
        findings: [{ pattern: 'AWS Access Key', redacted: 'AKIA***LE', line: 1, severity: 'critical' }]
      })
    } as any

    const result = secretScan({ text: 'AKIAIOSFODNN7EXAMPLE' }, guard)
    expect(result.clean).toBe(false)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].pattern).toBe('AWS Access Key')
    expect(guard.scanText).toHaveBeenCalledWith('AKIAIOSFODNN7EXAMPLE')
  })

  it('returns clean for safe text', () => {
    const guard = { scanText: vi.fn().mockReturnValue({ clean: true, findings: [] }) } as any
    const result = secretScan({ text: 'const x = 42' }, guard)
    expect(result.clean).toBe(true)
    expect(result.findings).toHaveLength(0)
  })
})

describe('traceSearch', () => {
  it('delegates to db.searchCommands without session_id', async () => {
    const db = {
      searchCommands: vi.fn().mockReturnValue([{
        command: 'npm test', timestamp: new Date('2024-01-01'), sessionId: 's1',
        riskLevel: 'safe', allowed: true, violations: [],
        id: '1', riskScore: 0, riskFactors: [], durationMs: 100,
      }])
    } as any

    const result = await traceSearch({ query: 'npm', limit: 5 }, db)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].command).toBe('npm test')
    expect(result.matches[0].exitInfo).toBe('allowed')
    expect(db.searchCommands).toHaveBeenCalledWith('npm', 5)
  })

  it('filters session commands when session_id provided', async () => {
    const db = {
      getCommands: vi.fn().mockReturnValue([
        { command: 'npm test', timestamp: new Date(), sessionId: 's1', riskLevel: 'safe', allowed: true, violations: [], id: '1', riskScore: 0, riskFactors: [], durationMs: 100 },
        { command: 'git status', timestamp: new Date(), sessionId: 's1', riskLevel: 'safe', allowed: true, violations: [], id: '2', riskScore: 0, riskFactors: [], durationMs: 50 },
      ])
    } as any

    const result = await traceSearch({ query: 'npm', session_id: 's1' }, db)
    expect(result.matches).toHaveLength(1)
    expect(result.matches[0].command).toBe('npm test')
    expect(db.getCommands).toHaveBeenCalledWith({ sessionId: 's1', limit: 1000 })
  })

  it('uses default limit of 10', async () => {
    const db = { searchCommands: vi.fn().mockReturnValue([]) } as any
    await traceSearch({ query: 'test' }, db)
    expect(db.searchCommands).toHaveBeenCalledWith('test', 10)
  })

  it('returns totalMatches equal to matches length', async () => {
    const db = {
      searchCommands: vi.fn().mockReturnValue([
        { command: 'npm test', timestamp: new Date(), sessionId: 's1', riskLevel: 'safe', allowed: true, violations: [], id: '1', riskScore: 0, riskFactors: [], durationMs: 100 },
        { command: 'npm run build', timestamp: new Date(), sessionId: 's1', riskLevel: 'safe', allowed: true, violations: [], id: '2', riskScore: 0, riskFactors: [], durationMs: 200 },
      ])
    } as any

    const result = await traceSearch({ query: 'npm' }, db)
    expect(result.totalMatches).toBe(2)
  })

  it('shows blocked info with violations in exitInfo', async () => {
    const db = {
      searchCommands: vi.fn().mockReturnValue([{
        command: 'rm -rf /', timestamp: new Date(), sessionId: 's1',
        riskLevel: 'critical', allowed: false, violations: ['destructive command', 'root path'],
        id: '1', riskScore: 10, riskFactors: [], durationMs: 0,
      }])
    } as any

    const result = await traceSearch({ query: 'rm' }, db)
    expect(result.matches[0].allowed).toBe(false)
    expect(result.matches[0].exitInfo).toBe('blocked: destructive command, root path')
  })

  it('session_id filtering is case-insensitive on query', async () => {
    const db = {
      getCommands: vi.fn().mockReturnValue([
        { command: 'NPM TEST', timestamp: new Date(), sessionId: 's1', riskLevel: 'safe', allowed: true, violations: [], id: '1', riskScore: 0, riskFactors: [], durationMs: 100 },
      ])
    } as any

    const result = await traceSearch({ query: 'npm', session_id: 's1' }, db)
    expect(result.matches).toHaveLength(1)
  })
})

describe('historySuggest', () => {
  it('delegates to suggester.suggestAsync', async () => {
    const suggester = {
      suggestAsync: vi.fn().mockResolvedValue([
        { command: 'npm run build', confidence: 0.9, source: 'pattern', description: 'Common after install' }
      ])
    } as any

    const result = await historySuggest({ last_command: 'npm install' }, suggester)
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].command).toBe('npm run build')
    expect(result.suggestions[0].source).toBe('pattern')
    expect(result.suggestions[0].reason).toBe('Common after install')
  })

  it('maps input fields to SuggestionContext', async () => {
    const suggester = { suggestAsync: vi.fn().mockResolvedValue([]) } as any

    await historySuggest({
      last_command: 'git push',
      last_output: 'Everything up-to-date',
      cwd: '/home/user/project'
    }, suggester)

    expect(suggester.suggestAsync).toHaveBeenCalledWith({
      lastCommand: 'git push',
      lastOutput: 'Everything up-to-date',
      cwd: '/home/user/project',
    })
  })

  it('truncates last_output to 500 chars', async () => {
    const suggester = { suggestAsync: vi.fn().mockResolvedValue([]) } as any
    const longOutput = 'x'.repeat(1000)

    await historySuggest({ last_command: 'test', last_output: longOutput }, suggester)

    const call = suggester.suggestAsync.mock.calls[0][0]
    expect(call.lastOutput.length).toBe(500)
  })

  it('defaults source to pattern when missing', async () => {
    const suggester = {
      suggestAsync: vi.fn().mockResolvedValue([
        { command: 'ls', confidence: 0.5 }
      ])
    } as any

    const result = await historySuggest({ last_command: 'cd /tmp' }, suggester)
    expect(result.suggestions[0].source).toBe('pattern')
  })

  it('defaults reason to empty string when description missing', async () => {
    const suggester = {
      suggestAsync: vi.fn().mockResolvedValue([
        { command: 'ls', confidence: 0.5, source: 'history' }
      ])
    } as any

    const result = await historySuggest({ last_command: 'cd /tmp' }, suggester)
    expect(result.suggestions[0].reason).toBe('')
  })
})

describe('sessionSummary', () => {
  const makeSession = (overrides: Record<string, any> = {}) => ({
    id: 's1',
    agent: 'claude-code',
    repoName: 'myrepo',
    workingDir: '/home/user/myrepo',
    startTime: new Date('2024-01-01T10:00:00Z'),
    endTime: new Date('2024-01-01T11:00:00Z'),
    commandCount: 50,
    blockedCount: 2,
    avgRiskScore: 1.5,
    pid: 123,
    status: 'completed',
    metadata: {},
    ...overrides,
  })

  const makeMetrics = (overrides: Record<string, any> = {}) => ({
    totalCommands: 50,
    allowedCommands: 48,
    blockedCommands: 2,
    avgRiskScore: 1.5,
    riskDistribution: {},
    topCommands: [{ command: 'git status', count: 10 }],
    ...overrides,
  })

  it('returns session data with default summary when no ollama', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([makeSession()]),
      getSessionMetrics: vi.fn().mockReturnValue(makeMetrics()),
    } as any

    const result = await sessionSummary({ count: 1 }, db, null)
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].agent).toBe('claude-code')
    expect(result.sessions[0].summary).toContain('50 commands')
    expect(result.sessions[0].summary).toContain('2 blocked')
    expect(result.sessions[0].duration).toBe('60m')
  })

  it('passes agent and limit to getSessions', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([]),
      getSessionMetrics: vi.fn(),
    } as any

    await sessionSummary({ count: 5, agent: 'copilot' }, db, null)
    expect(db.getSessions).toHaveBeenCalledWith({ agent: 'copilot', limit: 5 })
  })

  it('defaults count to 3', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([]),
      getSessionMetrics: vi.fn(),
    } as any

    await sessionSummary({}, db, null)
    expect(db.getSessions).toHaveBeenCalledWith({ agent: undefined, limit: 3 })
  })

  it('uses AI summary when ollama available', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([makeSession({ commandCount: 10, blockedCount: 0, avgRiskScore: 0.5 })]),
      getSessionMetrics: vi.fn().mockReturnValue(makeMetrics({ totalCommands: 10, blockedCommands: 0 })),
    } as any

    const ollama = {
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn().mockResolvedValue('The user ran 10 git commands in the myrepo project with no issues.')
    } as any

    const result = await sessionSummary({ count: 1 }, db, ollama)
    expect(result.sessions[0].summary).toBe('The user ran 10 git commands in the myrepo project with no issues.')
    expect(ollama.generate).toHaveBeenCalled()
  })

  it('falls back to default summary when ollama fails', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([makeSession({ commandCount: 5, blockedCount: 1, avgRiskScore: 3.0 })]),
      getSessionMetrics: vi.fn().mockReturnValue(makeMetrics({ totalCommands: 5, blockedCommands: 1 })),
    } as any

    const ollama = {
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn().mockRejectedValue(new Error('timeout'))
    } as any

    const result = await sessionSummary({}, db, ollama)
    expect(result.sessions[0].summary).toContain('5 commands')
  })

  it('falls back to default when ollama returns short response', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([makeSession()]),
      getSessionMetrics: vi.fn().mockReturnValue(makeMetrics()),
    } as any

    const ollama = {
      isAvailable: vi.fn().mockResolvedValue(true),
      generate: vi.fn().mockResolvedValue('short')
    } as any

    const result = await sessionSummary({ count: 1 }, db, ollama)
    // 'short' is <= 10 chars, so default summary is used
    expect(result.sessions[0].summary).toContain('50 commands')
  })

  it('skips ollama when isAvailable returns false', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([makeSession()]),
      getSessionMetrics: vi.fn().mockReturnValue(makeMetrics()),
    } as any

    const ollama = {
      isAvailable: vi.fn().mockResolvedValue(false),
      generate: vi.fn(),
    } as any

    const result = await sessionSummary({ count: 1 }, db, ollama)
    expect(result.sessions[0].summary).toContain('50 commands')
    expect(ollama.generate).not.toHaveBeenCalled()
  })

  it('formats startTime and endTime as ISO strings', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([makeSession()]),
      getSessionMetrics: vi.fn().mockReturnValue(makeMetrics()),
    } as any

    const result = await sessionSummary({ count: 1 }, db, null)
    expect(result.sessions[0].startTime).toBe('2024-01-01T10:00:00.000Z')
    expect(result.sessions[0].endTime).toBe('2024-01-01T11:00:00.000Z')
  })

  it('returns null endTime for ongoing sessions', async () => {
    const db = {
      getSessions: vi.fn().mockReturnValue([makeSession({ endTime: null })]),
      getSessionMetrics: vi.fn().mockReturnValue(makeMetrics()),
    } as any

    const result = await sessionSummary({ count: 1 }, db, null)
    expect(result.sessions[0].endTime).toBeNull()
  })

  it('limits topCommands to 5', async () => {
    const topCommands = Array.from({ length: 10 }, (_, i) => ({ command: `cmd${i}`, count: 10 - i }))
    const db = {
      getSessions: vi.fn().mockReturnValue([makeSession()]),
      getSessionMetrics: vi.fn().mockReturnValue(makeMetrics({ topCommands })),
    } as any

    const result = await sessionSummary({ count: 1 }, db, null)
    expect(result.sessions[0].topCommands).toHaveLength(5)
  })
})

describe('codeTask', () => {
  it('sends code to ollama with tier-appropriate prompt', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue('const x: number = 42'),
      getModel: vi.fn().mockReturnValue('qwen2.5-coder:7b'),
    } as any

    const result = await codeTask(
      { task: 'Add type annotation', code: 'const x = 42', language: 'ts' },
      ollama,
      'basic'
    )

    expect(result.result).toBe('const x: number = 42')
    expect(result.model_used).toBe('qwen2.5-coder:7b')
    expect(result.capability_tier).toBe('basic')
    expect(result.confidence).toBe('low')
    expect(ollama.generate).toHaveBeenCalled()
  })

  it('returns correct confidence per tier', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue('result'),
      getModel: vi.fn().mockReturnValue('model'),
    } as any

    const basic = await codeTask({ task: 't', code: 'c' }, ollama, 'basic')
    expect(basic.confidence).toBe('low')

    const moderate = await codeTask({ task: 't', code: 'c' }, ollama, 'moderate')
    expect(moderate.confidence).toBe('medium')

    const advanced = await codeTask({ task: 't', code: 'c' }, ollama, 'advanced')
    expect(advanced.confidence).toBe('high')
  })

  it('includes language in prompt when provided', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue('result'),
      getModel: vi.fn().mockReturnValue('model'),
    } as any

    await codeTask({ task: 'format', code: 'x=1', language: 'python' }, ollama, 'basic')

    const prompt = ollama.generate.mock.calls[0][0]
    expect(prompt).toContain('Language: python')
  })

  it('includes context in prompt when provided', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue('result'),
      getModel: vi.fn().mockReturnValue('model'),
    } as any

    await codeTask({ task: 'fix', code: 'x=1', context: 'This is a config file' }, ollama, 'moderate')

    const prompt = ollama.generate.mock.calls[0][0]
    expect(prompt).toContain('Context:\nThis is a config file')
  })

  it('omits language and context from prompt when not provided', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue('result'),
      getModel: vi.fn().mockReturnValue('model'),
    } as any

    await codeTask({ task: 'fix', code: 'x=1' }, ollama, 'basic')

    const prompt = ollama.generate.mock.calls[0][0]
    expect(prompt).not.toContain('Language:')
    expect(prompt).not.toContain('Context:')
  })

  it('trims whitespace from ollama result', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue('  result with spaces  \n'),
      getModel: vi.fn().mockReturnValue('model'),
    } as any

    const result = await codeTask({ task: 't', code: 'c' }, ollama, 'basic')
    expect(result.result).toBe('result with spaces')
  })

  it('passes tier-specific system prompt to ollama', async () => {
    const ollama = {
      generate: vi.fn().mockResolvedValue('result'),
      getModel: vi.fn().mockReturnValue('model'),
    } as any

    await codeTask({ task: 'fix', code: 'x' }, ollama, 'advanced')

    const systemPrompt = ollama.generate.mock.calls[0][1]
    expect(systemPrompt).toContain('complex tasks')
    expect(systemPrompt).toContain('multi-function refactors')
  })
})
