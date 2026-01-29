import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ContextStore } from './store.js'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ContextStore', () => {
  let store: ContextStore
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `context-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    store = new ContextStore(testDir)
  })

  afterEach(() => {
    try {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true })
    } catch { /* ignore cleanup errors */ }
  })

  describe('initialize', () => {
    it('should create directory structure', () => {
      store.initialize()

      const contextDir = join(testDir, '.bashbros', 'context')
      expect(existsSync(join(contextDir, 'memory'))).toBe(true)
      expect(existsSync(join(contextDir, 'memory', 'custom'))).toBe(true)
      expect(existsSync(join(contextDir, 'artifacts', 'sessions'))).toBe(true)
      expect(existsSync(join(contextDir, 'artifacts', 'commands'))).toBe(true)
      expect(existsSync(join(contextDir, 'artifacts', 'errors'))).toBe(true)
    })

    it('should create starter memory files', () => {
      store.initialize()

      const memoryDir = join(testDir, '.bashbros', 'context', 'memory')
      expect(existsSync(join(memoryDir, 'decisions.md'))).toBe(true)
      expect(existsSync(join(memoryDir, 'conventions.md'))).toBe(true)
      expect(existsSync(join(memoryDir, 'issues.md'))).toBe(true)

      const decisions = readFileSync(join(memoryDir, 'decisions.md'), 'utf-8')
      expect(decisions).toContain('# Decisions')
    })

    it('should create index.json', () => {
      store.initialize()

      const indexPath = join(testDir, '.bashbros', 'context', 'index.json')
      expect(existsSync(indexPath)).toBe(true)

      const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
      expect(index.agents).toEqual([])
      expect(index.sessionCount).toBe(0)
      expect(index.lastUpdated).toBeTruthy()
    })

    it('should not overwrite existing files on re-initialize', () => {
      store.initialize()

      const memoryDir = join(testDir, '.bashbros', 'context', 'memory')
      writeFileSync(join(memoryDir, 'decisions.md'), '# Custom Decisions\n\nModified.')

      store.initialize()

      const content = readFileSync(join(memoryDir, 'decisions.md'), 'utf-8')
      expect(content).toBe('# Custom Decisions\n\nModified.')
    })
  })

  describe('appendCommand', () => {
    it('should append command entry to JSONL file', () => {
      store.initialize()

      store.appendCommand({
        command: 'ls -la',
        output: 'total 0\ndrwxr-xr-x  2 user user',
        agent: 'claude-code',
        exitCode: 0,
        cwd: '/home/user/project'
      })

      const commandsDir = join(testDir, '.bashbros', 'context', 'artifacts', 'commands')
      const files = readdirSync(commandsDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}\.jsonl$/)

      const content = readFileSync(join(commandsDir, files[0]), 'utf-8').trim()
      const entry = JSON.parse(content)
      expect(entry.command).toBe('ls -la')
      expect(entry.agent).toBe('claude-code')
      expect(entry.exitCode).toBe(0)
      expect(entry.timestamp).toBeTruthy()
    })

    it('should append multiple commands to the same file', () => {
      store.initialize()

      store.appendCommand({
        command: 'echo hello',
        output: 'hello',
        agent: 'claude-code',
        exitCode: 0,
        cwd: '/tmp'
      })

      store.appendCommand({
        command: 'echo world',
        output: 'world',
        agent: 'gemini-cli',
        exitCode: 0,
        cwd: '/tmp'
      })

      const commandsDir = join(testDir, '.bashbros', 'context', 'artifacts', 'commands')
      const files = readdirSync(commandsDir)
      const lines = readFileSync(join(commandsDir, files[0]), 'utf-8').trim().split('\n')
      expect(lines.length).toBe(2)
      expect(JSON.parse(lines[0]).command).toBe('echo hello')
      expect(JSON.parse(lines[1]).command).toBe('echo world')
    })
  })

  describe('appendError', () => {
    it('should append error entry to JSONL file', () => {
      store.initialize()

      store.appendError({
        command: 'rm -rf /',
        error: 'Permission denied',
        agent: 'copilot-cli',
        resolved: false
      })

      const errorsDir = join(testDir, '.bashbros', 'context', 'artifacts', 'errors')
      const files = readdirSync(errorsDir)
      expect(files.length).toBe(1)

      const content = readFileSync(join(errorsDir, files[0]), 'utf-8').trim()
      const entry = JSON.parse(content)
      expect(entry.command).toBe('rm -rf /')
      expect(entry.error).toBe('Permission denied')
      expect(entry.agent).toBe('copilot-cli')
      expect(entry.resolved).toBe(false)
      expect(entry.timestamp).toBeTruthy()
    })
  })

  describe('writeSession', () => {
    it('should write session summary as JSON file', () => {
      store.initialize()

      store.writeSession({
        id: 'session-abc12345',
        agent: 'claude-code',
        startTime: '2026-01-28T10:00:00Z',
        endTime: '2026-01-28T10:30:00Z',
        commandCount: 15,
        summary: 'Refactored the auth module'
      })

      const sessionsDir = join(testDir, '.bashbros', 'context', 'artifacts', 'sessions')
      const files = readdirSync(sessionsDir)
      expect(files.length).toBe(1)
      expect(files[0]).toContain('claude-code')
      expect(files[0]).toContain('abc12345')
      expect(files[0]).toMatch(/\.json$/)

      const session = JSON.parse(readFileSync(join(sessionsDir, files[0]), 'utf-8'))
      expect(session.id).toBe('session-abc12345')
      expect(session.agent).toBe('claude-code')
      expect(session.commandCount).toBe(15)
      expect(session.summary).toBe('Refactored the auth module')
    })
  })

  describe('readMemory', () => {
    it('should read existing memory file', () => {
      store.initialize()

      const content = store.readMemory('decisions')
      expect(content).not.toBeNull()
      expect(content).toContain('# Decisions')
    })

    it('should return null for non-existent memory file', () => {
      store.initialize()

      const content = store.readMemory('nonexistent')
      expect(content).toBeNull()
    })
  })

  describe('writeMemory', () => {
    it('should write new memory file', () => {
      store.initialize()

      store.writeMemory('patterns', '# Patterns\n\nCommon patterns in this codebase.\n')

      const content = store.readMemory('patterns')
      expect(content).toBe('# Patterns\n\nCommon patterns in this codebase.\n')
    })

    it('should overwrite existing memory file', () => {
      store.initialize()

      store.writeMemory('decisions', '# Decisions\n\n- Use TypeScript everywhere\n')

      const content = store.readMemory('decisions')
      expect(content).toBe('# Decisions\n\n- Use TypeScript everywhere\n')
    })
  })

  describe('listMemoryFiles', () => {
    it('should list memory files without extensions', () => {
      store.initialize()

      const files = store.listMemoryFiles()
      expect(files).toContain('decisions')
      expect(files).toContain('conventions')
      expect(files).toContain('issues')
    })

    it('should return empty array if memory dir does not exist', () => {
      // Do not initialize - memory dir does not exist
      const files = store.listMemoryFiles()
      expect(files).toEqual([])
    })

    it('should include custom memory files', () => {
      store.initialize()
      store.writeMemory('custom-notes', '# Notes\n')

      const files = store.listMemoryFiles()
      expect(files).toContain('custom-notes')
    })
  })

  describe('updateIndex and getIndex', () => {
    it('should update index with agent and file counts', () => {
      store.initialize()

      store.appendCommand({
        command: 'ls',
        output: '',
        agent: 'claude-code',
        exitCode: 0,
        cwd: '/tmp'
      })

      store.appendCommand({
        command: 'pwd',
        output: '/tmp',
        agent: 'gemini-cli',
        exitCode: 0,
        cwd: '/tmp'
      })

      store.appendError({
        command: 'bad-cmd',
        error: 'not found',
        agent: 'gemini-cli',
        resolved: false
      })

      store.writeSession({
        id: 'sess-00000001',
        agent: 'claude-code',
        startTime: '2026-01-28T10:00:00Z',
        endTime: '2026-01-28T10:30:00Z',
        commandCount: 5,
        summary: 'Test session'
      })

      store.updateIndex()
      const index = store.getIndex()

      expect(index.agents).toContain('claude-code')
      expect(index.agents).toContain('gemini-cli')
      expect(index.sessionCount).toBe(1)
      expect(index.commandFileCount).toBe(1)
      expect(index.errorFileCount).toBe(1)
      expect(index.lastUpdated).toBeTruthy()
    })

    it('should return default index if not initialized', () => {
      const index = store.getIndex()
      expect(index.lastUpdated).toBe('')
      expect(index.agents).toEqual([])
      expect(index.sessionCount).toBe(0)
    })
  })

  describe('prune', () => {
    it('should remove files older than retention period', () => {
      store.initialize()

      // Write a file with an old date name directly
      const commandsDir = join(testDir, '.bashbros', 'context', 'artifacts', 'commands')
      const errorsDir = join(testDir, '.bashbros', 'context', 'artifacts', 'errors')
      writeFileSync(join(commandsDir, '2020-01-01.jsonl'), '{"command":"old","agent":"x"}\n')
      writeFileSync(join(errorsDir, '2020-01-01.jsonl'), '{"error":"old","agent":"x"}\n')

      // Write a recent file
      store.appendCommand({
        command: 'recent',
        output: '',
        agent: 'claude-code',
        exitCode: 0,
        cwd: '/tmp'
      })

      // Prune with 30-day retention
      store.prune(30)

      const remainingCommands = readdirSync(commandsDir)
      const remainingErrors = readdirSync(errorsDir)

      // Old files should be removed
      expect(remainingCommands).not.toContain('2020-01-01.jsonl')
      expect(remainingErrors).not.toContain('2020-01-01.jsonl')

      // Recent file should remain
      expect(remainingCommands.length).toBe(1)
    })

    it('should keep files within retention period', () => {
      store.initialize()

      store.appendCommand({
        command: 'recent',
        output: '',
        agent: 'claude-code',
        exitCode: 0,
        cwd: '/tmp'
      })

      const commandsDir = join(testDir, '.bashbros', 'context', 'artifacts', 'commands')
      const before = readdirSync(commandsDir).length

      store.prune(30)

      const after = readdirSync(commandsDir).length
      expect(after).toBe(before)
    })
  })

  describe('getContextDir', () => {
    it('should return the context directory path', () => {
      const dir = store.getContextDir()
      expect(dir).toBe(join(testDir, '.bashbros', 'context'))
    })
  })
})
