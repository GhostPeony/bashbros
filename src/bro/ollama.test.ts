import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OllamaClient } from './ollama.js'

describe('OllamaClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('constructor', () => {
    it('uses default config', () => {
      const client = new OllamaClient()
      expect(client.getModel()).toBe('qwen2.5-coder:7b')
    })

    it('accepts custom config', () => {
      const client = new OllamaClient({
        host: 'http://custom:1234',
        model: 'llama2'
      })
      expect(client.getModel()).toBe('llama2')
    })
  })

  describe('isAvailable', () => {
    it('returns true when Ollama is running', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true
      } as Response)

      const client = new OllamaClient()
      const result = await client.isAvailable()

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/tags',
        expect.any(Object)
      )
    })

    it('returns false when Ollama is not running', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const client = new OllamaClient()
      const result = await client.isAvailable()

      expect(result).toBe(false)
    })

    it('returns false on non-ok response', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: false
      } as Response)

      const client = new OllamaClient()
      const result = await client.isAvailable()

      expect(result).toBe(false)
    })
  })

  describe('listModels', () => {
    it('returns model names', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [
            { name: 'qwen2.5-coder:7b' },
            { name: 'llama2' }
          ]
        })
      } as Response)

      const client = new OllamaClient()
      const models = await client.listModels()

      expect(models).toEqual(['qwen2.5-coder:7b', 'llama2'])
    })

    it('returns empty array on error', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'))

      const client = new OllamaClient()
      const models = await client.listModels()

      expect(models).toEqual([])
    })
  })

  describe('generate', () => {
    it('sends correct request', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'Generated text',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.generate('Hello', 'Be helpful')

      expect(result).toBe('Generated text')
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"prompt":"Hello"')
        })
      )
    })

    it('throws on error response', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      } as Response)

      const client = new OllamaClient()
      await expect(client.generate('Hello')).rejects.toThrow('Ollama error: 500')
    })

    it('throws on timeout', async () => {
      const mockFetch = vi.mocked(fetch)
      const abortError = new Error('Aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValueOnce(abortError)

      const client = new OllamaClient({ timeout: 100 })
      await expect(client.generate('Hello')).rejects.toThrow('timed out')
    })
  })

  describe('chat', () => {
    it('sends chat messages', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          message: { content: 'Response' }
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.chat([
        { role: 'user', content: 'Hello' }
      ])

      expect(result).toBe('Response')
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/chat',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"messages"')
        })
      )
    })
  })

  describe('suggestCommand', () => {
    it('returns suggested command', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'git status',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.suggestCommand('I just made changes')

      expect(result).toBe('git status')
    })

    it('returns null for "none" response', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'none',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.suggestCommand('unclear context')

      expect(result).toBeNull()
    })

    it('returns null for very long responses', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'a'.repeat(250),
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.suggestCommand('context')

      expect(result).toBeNull()
    })

    it('returns null on error', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new OllamaClient()
      const result = await client.suggestCommand('context')

      expect(result).toBeNull()
    })
  })

  describe('explainCommand', () => {
    it('returns explanation', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'This command lists files',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.explainCommand('ls -la')

      expect(result).toBe('This command lists files')
    })

    it('returns fallback on error', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new OllamaClient()
      const result = await client.explainCommand('ls')

      expect(result).toBe('Could not explain command.')
    })
  })

  describe('fixCommand', () => {
    it('returns fixed command', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'pip install requests',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.fixCommand(
        'pip instal requests',
        'Unknown command'
      )

      expect(result).toBe('pip install requests')
    })

    it('returns null for "none" response', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'none',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.fixCommand('broken', 'error')

      expect(result).toBeNull()
    })

    it('returns null for very long responses', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'a'.repeat(600),
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.fixCommand('broken', 'error')

      expect(result).toBeNull()
    })
  })

  describe('setModel', () => {
    it('changes the model', () => {
      const client = new OllamaClient()
      client.setModel('codellama')
      expect(client.getModel()).toBe('codellama')
    })
  })

  describe('generateScript', () => {
    it('generates a shell script', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: '#!/bin/bash\necho "Hello"',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.generateScript('print hello')

      expect(result).toBe('#!/bin/bash\necho "Hello"')
    })

    it('returns null on error', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new OllamaClient()
      const result = await client.generateScript('print hello')

      expect(result).toBeNull()
    })
  })

  describe('analyzeCommandSafety', () => {
    it('returns safety analysis', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: '{"safe": false, "risk": "high", "explanation": "Dangerous", "suggestions": ["Use carefully"]}',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.analyzeCommandSafety('rm -rf /')

      expect(result.safe).toBe(false)
      expect(result.risk).toBe('high')
      expect(result.explanation).toBe('Dangerous')
      expect(result.suggestions).toContain('Use carefully')
    })

    it('returns fallback on parse error', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'Not JSON response',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.analyzeCommandSafety('ls')

      expect(result.safe).toBe(true)
      expect(result.risk).toBe('low')
    })
  })

  describe('summarizeSession', () => {
    it('summarizes commands', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'User ran git commands.',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.summarizeSession([
        { command: 'git status' },
        { command: 'git add .' }
      ])

      expect(result).toBe('User ran git commands.')
    })

    it('returns fallback on error', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const client = new OllamaClient()
      const result = await client.summarizeSession([])

      expect(result).toBe('Could not summarize session.')
    })
  })

  describe('getHelp', () => {
    it('returns help text', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'grep searches for patterns in files.',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.getHelp('grep')

      expect(result).toBe('grep searches for patterns in files.')
    })
  })

  describe('naturalToCommand', () => {
    it('converts description to command', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'find . -name "*.txt"',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.naturalToCommand('find all text files')

      expect(result).toBe('find . -name "*.txt"')
    })

    it('returns null for "none" response', async () => {
      const mockFetch = vi.mocked(fetch)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          response: 'none',
          done: true
        })
      } as Response)

      const client = new OllamaClient()
      const result = await client.naturalToCommand('unclear request')

      expect(result).toBeNull()
    })
  })
})
