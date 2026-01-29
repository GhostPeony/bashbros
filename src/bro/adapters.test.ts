import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AdapterRegistry } from './adapters.js'
import type { AdapterEntry } from './adapters.js'

describe('AdapterRegistry', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = join(tmpdir(), `bashbros-adapters-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  /**
   * Helper to create a valid adapter directory with manifest.json and adapter.gguf
   */
  function createAdapter(dir: string, name: string, manifest: Record<string, unknown>): void {
    const adapterDir = join(dir, name)
    mkdirSync(adapterDir, { recursive: true })
    writeFileSync(join(adapterDir, 'manifest.json'), JSON.stringify(manifest))
    writeFileSync(join(adapterDir, 'adapter.gguf'), 'fake-gguf-data')
  }

  describe('constructor', () => {
    it('uses provided adapters directory', () => {
      const registry = new AdapterRegistry(tempDir)
      expect(registry.getAdaptersDir()).toBe(tempDir)
    })

    it('uses default directory when none provided', () => {
      const registry = new AdapterRegistry()
      expect(registry.getAdaptersDir()).toContain('.bashgym')
      expect(registry.getAdaptersDir()).toContain('adapters')
    })
  })

  describe('discover', () => {
    it('finds adapters with manifest.json and adapter.gguf files', () => {
      const manifest = {
        name: 'suggest-v1',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'suggest',
        trainedAt: '2025-01-15T10:00:00Z',
        tracesUsed: 500,
        qualityScore: 0.85
      }
      createAdapter(tempDir, 'suggest-v1', manifest)

      const registry = new AdapterRegistry(tempDir)
      const entries = registry.discover()

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('suggest-v1')
      expect(entries[0].baseModel).toBe('qwen2.5-coder:7b')
      expect(entries[0].purpose).toBe('suggest')
      expect(entries[0].trainedAt).toBe('2025-01-15T10:00:00Z')
      expect(entries[0].tracesUsed).toBe(500)
      expect(entries[0].qualityScore).toBe(0.85)
      expect(entries[0].adapterPath).toBe(join(tempDir, 'suggest-v1', 'adapter.gguf'))
    })

    it('returns empty array if directory does not exist', () => {
      const registry = new AdapterRegistry(join(tempDir, 'nonexistent'))
      const entries = registry.discover()

      expect(entries).toEqual([])
    })

    it('returns empty array for empty directory', () => {
      const registry = new AdapterRegistry(tempDir)
      const entries = registry.discover()

      expect(entries).toEqual([])
    })

    it('skips directories without manifest.json', () => {
      const adapterDir = join(tempDir, 'no-manifest')
      mkdirSync(adapterDir, { recursive: true })
      writeFileSync(join(adapterDir, 'adapter.gguf'), 'fake-gguf-data')

      const registry = new AdapterRegistry(tempDir)
      const entries = registry.discover()

      expect(entries).toEqual([])
    })

    it('skips directories without adapter.gguf', () => {
      const adapterDir = join(tempDir, 'no-gguf')
      mkdirSync(adapterDir, { recursive: true })
      writeFileSync(join(adapterDir, 'manifest.json'), JSON.stringify({
        name: 'no-gguf',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'suggest',
        trainedAt: '2025-01-15T10:00:00Z',
        tracesUsed: 100,
        qualityScore: 0.5
      }))

      const registry = new AdapterRegistry(tempDir)
      const entries = registry.discover()

      expect(entries).toEqual([])
    })

    it('skips directories with malformed manifest.json', () => {
      const adapterDir = join(tempDir, 'bad-manifest')
      mkdirSync(adapterDir, { recursive: true })
      writeFileSync(join(adapterDir, 'manifest.json'), 'not valid json {{{')
      writeFileSync(join(adapterDir, 'adapter.gguf'), 'fake-gguf-data')

      const registry = new AdapterRegistry(tempDir)
      const entries = registry.discover()

      expect(entries).toEqual([])
    })

    it('discovers multiple adapters', () => {
      createAdapter(tempDir, 'suggest-v1', {
        name: 'suggest-v1',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'suggest',
        trainedAt: '2025-01-15T10:00:00Z',
        tracesUsed: 500,
        qualityScore: 0.85
      })
      createAdapter(tempDir, 'safety-v1', {
        name: 'safety-v1',
        baseModel: 'llama3:8b',
        purpose: 'safety',
        trainedAt: '2025-01-16T10:00:00Z',
        tracesUsed: 300,
        qualityScore: 0.92
      })
      createAdapter(tempDir, 'route-v1', {
        name: 'route-v1',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'route',
        trainedAt: '2025-01-17T10:00:00Z',
        tracesUsed: 800,
        qualityScore: 0.78
      })

      const registry = new AdapterRegistry(tempDir)
      const entries = registry.discover()

      expect(entries).toHaveLength(3)
      const names = entries.map(e => e.name).sort()
      expect(names).toEqual(['route-v1', 'safety-v1', 'suggest-v1'])
    })

    it('skips invalid adapters but includes valid ones', () => {
      createAdapter(tempDir, 'valid-adapter', {
        name: 'valid-adapter',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'suggest',
        trainedAt: '2025-01-15T10:00:00Z',
        tracesUsed: 500,
        qualityScore: 0.85
      })

      // Create invalid adapter (no gguf)
      const invalidDir = join(tempDir, 'invalid-adapter')
      mkdirSync(invalidDir, { recursive: true })
      writeFileSync(join(invalidDir, 'manifest.json'), JSON.stringify({
        name: 'invalid-adapter',
        baseModel: 'llama3:8b',
        purpose: 'safety'
      }))

      // Create adapter with bad JSON
      const badJsonDir = join(tempDir, 'bad-json')
      mkdirSync(badJsonDir, { recursive: true })
      writeFileSync(join(badJsonDir, 'manifest.json'), '{bad json}')
      writeFileSync(join(badJsonDir, 'adapter.gguf'), 'fake')

      const registry = new AdapterRegistry(tempDir)
      const entries = registry.discover()

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('valid-adapter')
    })

    it('ignores files (non-directories) in the adapters directory', () => {
      writeFileSync(join(tempDir, 'stray-file.txt'), 'not a directory')

      createAdapter(tempDir, 'real-adapter', {
        name: 'real-adapter',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'general',
        trainedAt: '2025-01-15T10:00:00Z',
        tracesUsed: 100,
        qualityScore: 0.7
      })

      const registry = new AdapterRegistry(tempDir)
      const entries = registry.discover()

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('real-adapter')
    })
  })

  describe('generateModelfile', () => {
    it('creates FROM + ADAPTER string', () => {
      const adapter: AdapterEntry = {
        name: 'suggest-v1',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'suggest',
        adapterPath: '/path/to/adapter.gguf',
        trainedAt: '2025-01-15T10:00:00Z',
        tracesUsed: 500,
        qualityScore: 0.85
      }

      const registry = new AdapterRegistry(tempDir)
      const modelfile = registry.generateModelfile(adapter)

      expect(modelfile).toBe('FROM qwen2.5-coder:7b\nADAPTER /path/to/adapter.gguf')
    })

    it('uses the correct base model from the adapter', () => {
      const adapter: AdapterEntry = {
        name: 'safety-v1',
        baseModel: 'llama3:8b',
        purpose: 'safety',
        adapterPath: '/home/user/.bashgym/adapters/safety-v1/adapter.gguf',
        trainedAt: '2025-01-16T10:00:00Z',
        tracesUsed: 300,
        qualityScore: 0.92
      }

      const registry = new AdapterRegistry(tempDir)
      const modelfile = registry.generateModelfile(adapter)

      expect(modelfile).toContain('FROM llama3:8b')
      expect(modelfile).toContain('ADAPTER /home/user/.bashgym/adapters/safety-v1/adapter.gguf')
    })

    it('modelfile starts with FROM line', () => {
      const adapter: AdapterEntry = {
        name: 'test',
        baseModel: 'codellama:7b',
        purpose: 'general',
        adapterPath: '/tmp/adapter.gguf',
        trainedAt: '2025-01-01T00:00:00Z',
        tracesUsed: 10,
        qualityScore: 0.5
      }

      const registry = new AdapterRegistry(tempDir)
      const modelfile = registry.generateModelfile(adapter)
      const lines = modelfile.split('\n')

      expect(lines[0]).toBe('FROM codellama:7b')
      expect(lines[1]).toBe('ADAPTER /tmp/adapter.gguf')
      expect(lines).toHaveLength(2)
    })
  })

  describe('ollamaModelName', () => {
    it('creates bashbros/ prefix', () => {
      const registry = new AdapterRegistry(tempDir)
      const name = registry.ollamaModelName('suggest-v1')

      expect(name).toBe('bashbros/suggest-v1')
    })

    it('namespaces different adapter names correctly', () => {
      const registry = new AdapterRegistry(tempDir)

      expect(registry.ollamaModelName('safety-v1')).toBe('bashbros/safety-v1')
      expect(registry.ollamaModelName('route-v2')).toBe('bashbros/route-v2')
      expect(registry.ollamaModelName('explain-latest')).toBe('bashbros/explain-latest')
    })

    it('handles adapter names with special characters', () => {
      const registry = new AdapterRegistry(tempDir)

      expect(registry.ollamaModelName('my-adapter_v1.0')).toBe('bashbros/my-adapter_v1.0')
    })
  })

  describe('getAdaptersDir', () => {
    it('returns the configured directory', () => {
      const registry = new AdapterRegistry(tempDir)
      expect(registry.getAdaptersDir()).toBe(tempDir)
    })

    it('returns default path when not configured', () => {
      const registry = new AdapterRegistry()
      const dir = registry.getAdaptersDir()
      expect(dir).toMatch(/\.bashgym/)
      expect(dir).toMatch(/adapters/)
    })
  })
})
