# Ollama, Adapters, Context Store & Dashboard - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand BashBros into a full Ollama control plane with LoRA adapter management, AI-powered routing/suggestions, a shared file-based context store, and three new/updated dashboard tabs.

**Architecture:** Three new modules (`src/bro/adapters.ts`, `src/bro/profiles.ts`, `src/context/store.ts`) plus extensions to existing Ollama client, router, suggester, dashboard server, database, and dashboard UI. File-based context store at `.bashbros/context/` per project. Adapter discovery from `~/.bashgym/integration/models/adapters/`.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Express 5, WebSocket, Ollama HTTP API, fs/path for file-based stores.

---

## Task 1: Ollama Client - Model Management Methods

Add `pullModel`, `deleteModel`, `showModel`, and `listRunning` to the existing `OllamaClient`.

**Files:**
- Modify: `src/bro/ollama.ts`
- Create: `src/bro/ollama.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/bro/ollama.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OllamaClient } from './ollama.js'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OllamaClient', () => {
  let client: OllamaClient

  beforeEach(() => {
    client = new OllamaClient({ host: 'http://localhost:11434' })
    mockFetch.mockReset()
  })

  describe('showModel', () => {
    it('returns model details', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          modelfile: 'FROM qwen2.5-coder:7b',
          parameters: 'temperature 0.7',
          template: '{{ .System }}',
          details: {
            parent_model: '',
            format: 'gguf',
            family: 'qwen2',
            families: ['qwen2'],
            parameter_size: '7.6B',
            quantization_level: 'Q4_K_M'
          }
        })
      })

      const info = await client.showModel('qwen2.5-coder:7b')
      expect(info).not.toBeNull()
      expect(info!.details.family).toBe('qwen2')
      expect(info!.details.parameter_size).toBe('7.6B')
      expect(info!.details.quantization_level).toBe('Q4_K_M')
    })

    it('returns null when model not found', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 })
      const info = await client.showModel('nonexistent')
      expect(info).toBeNull()
    })
  })

  describe('deleteModel', () => {
    it('returns true on success', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true })
      const result = await client.deleteModel('old-model')
      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/delete',
        expect.objectContaining({ method: 'DELETE' })
      )
    })

    it('returns false on failure', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false })
      const result = await client.deleteModel('nonexistent')
      expect(result).toBe(false)
    })
  })

  describe('listRunning', () => {
    it('returns running models with memory info', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{
            name: 'qwen2.5-coder:7b',
            model: 'qwen2.5-coder:7b',
            size: 4_920_000_000,
            size_vram: 4_920_000_000,
            digest: 'abc123',
            details: { family: 'qwen2', parameter_size: '7.6B', quantization_level: 'Q4_K_M' },
            expires_at: '2026-01-28T12:00:00Z'
          }]
        })
      })

      const running = await client.listRunning()
      expect(running).toHaveLength(1)
      expect(running[0].name).toBe('qwen2.5-coder:7b')
      expect(running[0].size_vram).toBe(4_920_000_000)
    })

    it('returns empty array when Ollama is down', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const running = await client.listRunning()
      expect(running).toEqual([])
    })
  })

  describe('pullModel', () => {
    it('calls POST /api/pull with model name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success' })
      })

      const result = await client.pullModel('llama3:8b')
      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/pull',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'llama3:8b', stream: false })
        })
      )
    })
  })

  describe('createModelFromAdapter', () => {
    it('calls POST /api/create with modelfile', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'success' })
      })

      const result = await client.createModel('bashbros/suggest:v1', 'FROM qwen2.5-coder:7b\nADAPTER /path/to/adapter.gguf')
      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/create',
        expect.objectContaining({ method: 'POST' })
      )
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/bro/ollama.test.ts`
Expected: FAIL - methods don't exist yet

**Step 3: Implement the new methods**

Add these types and methods to `src/bro/ollama.ts`:

```typescript
// New types (add after existing interfaces)
export interface ModelInfo {
  modelfile: string
  parameters: string
  template: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

export interface RunningModel {
  name: string
  model: string
  size: number
  size_vram: number
  digest: string
  details: {
    family: string
    parameter_size: string
    quantization_level: string
  }
  expires_at: string
}

// New methods on OllamaClient class:

async showModel(name: string): Promise<ModelInfo | null> {
  try {
    const response = await fetch(`${this.config.host}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (!response.ok) return null
    return await response.json() as ModelInfo
  } catch {
    return null
  }
}

async deleteModel(name: string): Promise<boolean> {
  try {
    const response = await fetch(`${this.config.host}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    return response.ok
  } catch {
    return false
  }
}

async listRunning(): Promise<RunningModel[]> {
  try {
    const response = await fetch(`${this.config.host}/api/ps`)
    if (!response.ok) return []
    const data = await response.json() as { models?: RunningModel[] }
    return data.models || []
  } catch {
    return []
  }
}

async pullModel(name: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000) // 5 min for pulls
    const response = await fetch(`${this.config.host}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false }),
      signal: controller.signal
    })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

async createModel(name: string, modelfile: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000)
    const response = await fetch(`${this.config.host}/api/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, modelfile, stream: false }),
      signal: controller.signal
    })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/bro/ollama.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bro/ollama.ts src/bro/ollama.test.ts
git commit -m "feat(ollama): add model management methods - show, delete, pull, listRunning, createModel"
```

---

## Task 2: Adapter Registry

New module to discover, register, and manage BashGym LoRA adapters. Generates Ollama Modelfiles from base model + adapter.

**Files:**
- Create: `src/bro/adapters.ts`
- Create: `src/bro/adapters.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/bro/adapters.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AdapterRegistry, type AdapterEntry } from './adapters.js'
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('AdapterRegistry', () => {
  let testDir: string
  let registry: AdapterRegistry

  beforeEach(() => {
    testDir = join(tmpdir(), `bashbros-test-adapters-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    registry = new AdapterRegistry(testDir)
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('discover', () => {
    it('finds adapters with manifest.json files', () => {
      // Create adapter directory with manifest
      const adapterDir = join(testDir, 'suggest-v1')
      mkdirSync(adapterDir, { recursive: true })
      writeFileSync(join(adapterDir, 'adapter.gguf'), 'fake-gguf-data')
      writeFileSync(join(adapterDir, 'manifest.json'), JSON.stringify({
        name: 'suggest-v1',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'suggest',
        trainedAt: '2026-01-28T00:00:00Z',
        tracesUsed: 500,
        qualityScore: 82
      }))

      const adapters = registry.discover()
      expect(adapters).toHaveLength(1)
      expect(adapters[0].name).toBe('suggest-v1')
      expect(adapters[0].purpose).toBe('suggest')
    })

    it('returns empty array if directory does not exist', () => {
      const noDir = new AdapterRegistry('/nonexistent/path')
      expect(noDir.discover()).toEqual([])
    })
  })

  describe('generateModelfile', () => {
    it('creates Modelfile with FROM and ADAPTER', () => {
      const entry: AdapterEntry = {
        name: 'suggest-v1',
        baseModel: 'qwen2.5-coder:7b',
        purpose: 'suggest',
        adapterPath: '/path/to/adapter.gguf',
        trainedAt: '2026-01-28T00:00:00Z',
        tracesUsed: 500,
        qualityScore: 82
      }

      const modelfile = registry.generateModelfile(entry)
      expect(modelfile).toContain('FROM qwen2.5-coder:7b')
      expect(modelfile).toContain('ADAPTER /path/to/adapter.gguf')
    })
  })

  describe('ollamaModelName', () => {
    it('generates namespaced model name', () => {
      const name = registry.ollamaModelName('suggest-v1')
      expect(name).toBe('bashbros/suggest-v1')
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/bro/adapters.test.ts`
Expected: FAIL - module doesn't exist yet

**Step 3: Implement AdapterRegistry**

```typescript
// src/bro/adapters.ts
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export type AdapterPurpose = 'suggest' | 'safety' | 'route' | 'explain' | 'fix' | 'script' | 'general'

export interface AdapterEntry {
  name: string
  baseModel: string
  purpose: AdapterPurpose
  adapterPath: string
  trainedAt: string
  tracesUsed: number
  qualityScore: number
}

interface AdapterManifest {
  name: string
  baseModel: string
  purpose: AdapterPurpose
  trainedAt: string
  tracesUsed: number
  qualityScore: number
}

const DEFAULT_ADAPTERS_DIR = join(homedir(), '.bashgym', 'integration', 'models', 'adapters')

export class AdapterRegistry {
  private adaptersDir: string

  constructor(adaptersDir?: string) {
    this.adaptersDir = adaptersDir || DEFAULT_ADAPTERS_DIR
  }

  discover(): AdapterEntry[] {
    if (!existsSync(this.adaptersDir)) {
      return []
    }

    const entries: AdapterEntry[] = []

    try {
      const dirs = readdirSync(this.adaptersDir, { withFileTypes: true })
        .filter(d => d.isDirectory())

      for (const dir of dirs) {
        const manifestPath = join(this.adaptersDir, dir.name, 'manifest.json')
        const adapterPath = join(this.adaptersDir, dir.name, 'adapter.gguf')

        if (!existsSync(manifestPath) || !existsSync(adapterPath)) {
          continue
        }

        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AdapterManifest
          entries.push({
            ...manifest,
            adapterPath
          })
        } catch {
          // Skip malformed manifests
        }
      }
    } catch {
      // Directory read error
    }

    return entries
  }

  generateModelfile(adapter: AdapterEntry): string {
    return `FROM ${adapter.baseModel}\nADAPTER ${adapter.adapterPath}`
  }

  ollamaModelName(adapterName: string): string {
    return `bashbros/${adapterName}`
  }

  getAdaptersDir(): string {
    return this.adaptersDir
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/bro/adapters.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bro/adapters.ts src/bro/adapters.test.ts
git commit -m "feat(adapters): add LoRA adapter registry with discovery and Modelfile generation"
```

---

## Task 3: Model Profiles

Profiles assign specific models/adapters to BashBro functions. Stored as JSON files.

**Files:**
- Create: `src/bro/profiles.ts`
- Create: `src/bro/profiles.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/bro/profiles.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ProfileManager, type ModelProfile } from './profiles.js'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ProfileManager', () => {
  let testDir: string
  let manager: ProfileManager

  beforeEach(() => {
    testDir = join(tmpdir(), `bashbros-test-profiles-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    manager = new ProfileManager(testDir)
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('saves and loads a profile', () => {
    const profile: ModelProfile = {
      name: 'balanced',
      baseModel: 'qwen2.5-coder:7b',
      adapters: {
        suggest: 'suggest-v3',
        safety: 'safety-v2'
      }
    }

    manager.save(profile)
    const loaded = manager.load('balanced')
    expect(loaded).not.toBeNull()
    expect(loaded!.name).toBe('balanced')
    expect(loaded!.adapters.suggest).toBe('suggest-v3')
  })

  it('lists all profiles', () => {
    manager.save({ name: 'fast', baseModel: 'qwen2.5-coder:3b', adapters: {} })
    manager.save({ name: 'full', baseModel: 'qwen2.5-coder:7b', adapters: { suggest: 'v1' } })

    const profiles = manager.list()
    expect(profiles).toHaveLength(2)
    expect(profiles.map(p => p.name).sort()).toEqual(['fast', 'full'])
  })

  it('deletes a profile', () => {
    manager.save({ name: 'temp', baseModel: 'qwen2.5-coder:7b', adapters: {} })
    expect(manager.load('temp')).not.toBeNull()
    manager.delete('temp')
    expect(manager.load('temp')).toBeNull()
  })

  it('getModelForPurpose returns adapter model when assigned', () => {
    const profile: ModelProfile = {
      name: 'test',
      baseModel: 'qwen2.5-coder:7b',
      adapters: { suggest: 'suggest-v3' }
    }

    expect(manager.getModelForPurpose(profile, 'suggest')).toBe('bashbros/suggest-v3')
    expect(manager.getModelForPurpose(profile, 'explain')).toBe('qwen2.5-coder:7b')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/bro/profiles.test.ts`
Expected: FAIL

**Step 3: Implement ProfileManager**

```typescript
// src/bro/profiles.ts
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AdapterPurpose } from './adapters.js'

export interface ModelProfile {
  name: string
  baseModel: string
  adapters: Partial<Record<AdapterPurpose, string>>
}

const DEFAULT_PROFILES_DIR = join(homedir(), '.bashbros', 'models', 'profiles')

export class ProfileManager {
  private profilesDir: string

  constructor(profilesDir?: string) {
    this.profilesDir = profilesDir || DEFAULT_PROFILES_DIR
  }

  save(profile: ModelProfile): void {
    if (!existsSync(this.profilesDir)) {
      mkdirSync(this.profilesDir, { recursive: true })
    }
    const filePath = join(this.profilesDir, `${profile.name}.json`)
    writeFileSync(filePath, JSON.stringify(profile, null, 2))
  }

  load(name: string): ModelProfile | null {
    const filePath = join(this.profilesDir, `${name}.json`)
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as ModelProfile
    } catch {
      return null
    }
  }

  list(): ModelProfile[] {
    if (!existsSync(this.profilesDir)) return []
    try {
      return readdirSync(this.profilesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            return JSON.parse(readFileSync(join(this.profilesDir, f), 'utf-8')) as ModelProfile
          } catch {
            return null
          }
        })
        .filter((p): p is ModelProfile => p !== null)
    } catch {
      return []
    }
  }

  delete(name: string): boolean {
    const filePath = join(this.profilesDir, `${name}.json`)
    if (!existsSync(filePath)) return false
    unlinkSync(filePath)
    return true
  }

  getModelForPurpose(profile: ModelProfile, purpose: AdapterPurpose): string {
    const adapterName = profile.adapters[purpose]
    if (adapterName) {
      return `bashbros/${adapterName}`
    }
    return profile.baseModel
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/bro/profiles.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bro/profiles.ts src/bro/profiles.test.ts
git commit -m "feat(profiles): add model profile manager for per-function adapter assignment"
```

---

## Task 4: Context Store

File-based shared context at `.bashbros/context/` per project.

**Files:**
- Create: `src/context/store.ts`
- Create: `src/context/store.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/context/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ContextStore } from './store.js'
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('ContextStore', () => {
  let testDir: string
  let store: ContextStore

  beforeEach(() => {
    testDir = join(tmpdir(), `bashbros-test-context-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    store = new ContextStore(testDir)
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('initialize', () => {
    it('creates directory structure', () => {
      store.initialize()
      expect(existsSync(join(testDir, '.bashbros', 'context', 'memory'))).toBe(true)
      expect(existsSync(join(testDir, '.bashbros', 'context', 'memory', 'custom'))).toBe(true)
      expect(existsSync(join(testDir, '.bashbros', 'context', 'artifacts', 'sessions'))).toBe(true)
      expect(existsSync(join(testDir, '.bashbros', 'context', 'artifacts', 'commands'))).toBe(true)
      expect(existsSync(join(testDir, '.bashbros', 'context', 'artifacts', 'errors'))).toBe(true)
      expect(existsSync(join(testDir, '.bashbros', 'context', 'index.json'))).toBe(true)
    })

    it('creates starter memory files', () => {
      store.initialize()
      expect(existsSync(join(testDir, '.bashbros', 'context', 'memory', 'decisions.md'))).toBe(true)
      expect(existsSync(join(testDir, '.bashbros', 'context', 'memory', 'conventions.md'))).toBe(true)
      expect(existsSync(join(testDir, '.bashbros', 'context', 'memory', 'issues.md'))).toBe(true)
    })
  })

  describe('appendCommand', () => {
    it('appends a command entry to the daily JSONL file', () => {
      store.initialize()
      store.appendCommand({
        command: 'npm test',
        output: 'all tests passed',
        agent: 'claude-code',
        exitCode: 0,
        cwd: '/project'
      })

      const today = new Date().toISOString().slice(0, 10)
      const filePath = join(testDir, '.bashbros', 'context', 'artifacts', 'commands', `${today}.jsonl`)
      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, 'utf-8').trim()
      const entry = JSON.parse(content)
      expect(entry.command).toBe('npm test')
      expect(entry.agent).toBe('claude-code')
    })
  })

  describe('appendError', () => {
    it('appends an error entry to the daily JSONL file', () => {
      store.initialize()
      store.appendError({
        command: 'npm build',
        error: 'Module not found',
        agent: 'claude-code',
        resolved: false
      })

      const today = new Date().toISOString().slice(0, 10)
      const filePath = join(testDir, '.bashbros', 'context', 'artifacts', 'errors', `${today}.jsonl`)
      expect(existsSync(filePath)).toBe(true)
    })
  })

  describe('writeSession', () => {
    it('writes a session summary JSON file', () => {
      store.initialize()
      store.writeSession({
        id: 'test-session-1',
        agent: 'claude-code',
        startTime: '2026-01-28T10:00:00Z',
        endTime: '2026-01-28T10:30:00Z',
        commandCount: 15,
        summary: 'Implemented feature X'
      })

      const sessionsDir = join(testDir, '.bashbros', 'context', 'artifacts', 'sessions')
      const files = require('fs').readdirSync(sessionsDir)
      expect(files.length).toBe(1)
      expect(files[0]).toMatch(/claude-code/)
    })
  })

  describe('readMemory', () => {
    it('reads a memory file', () => {
      store.initialize()
      const content = store.readMemory('decisions')
      expect(content).toContain('Decisions')
    })

    it('returns null for nonexistent memory file', () => {
      store.initialize()
      const content = store.readMemory('nonexistent')
      expect(content).toBeNull()
    })
  })

  describe('writeMemory', () => {
    it('writes/appends to a memory file', () => {
      store.initialize()
      store.writeMemory('decisions', '## Use SQLite for storage\nDecided 2026-01-28\n')
      const content = store.readMemory('decisions')
      expect(content).toContain('Use SQLite for storage')
    })
  })

  describe('getIndex', () => {
    it('returns manifest with stats', () => {
      store.initialize()
      store.appendCommand({ command: 'ls', output: '', agent: 'claude-code', exitCode: 0, cwd: '/project' })
      store.updateIndex()

      const index = store.getIndex()
      expect(index.lastUpdated).toBeDefined()
      expect(index.agents).toContain('claude-code')
    })
  })

  describe('prune', () => {
    it('removes artifacts older than retention days', () => {
      store.initialize()
      // Create an old commands file
      const oldDate = '2025-11-01'
      const oldFile = join(testDir, '.bashbros', 'context', 'artifacts', 'commands', `${oldDate}.jsonl`)
      require('fs').writeFileSync(oldFile, '{"command":"old"}\n')

      store.prune(30) // 30 day retention
      expect(existsSync(oldFile)).toBe(false)
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/context/store.test.ts`
Expected: FAIL

**Step 3: Implement ContextStore**

```typescript
// src/context/store.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

export interface CommandEntry {
  command: string
  output: string
  agent: string
  exitCode: number
  cwd: string
}

export interface ErrorEntry {
  command: string
  error: string
  agent: string
  resolved: boolean
}

export interface SessionSummary {
  id: string
  agent: string
  startTime: string
  endTime: string
  commandCount: number
  summary: string
}

export interface ContextIndex {
  lastUpdated: string
  agents: string[]
  sessionCount: number
  commandFileCount: number
  errorFileCount: number
}

export class ContextStore {
  private projectRoot: string
  private contextDir: string
  private memoryDir: string
  private artifactsDir: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.contextDir = join(projectRoot, '.bashbros', 'context')
    this.memoryDir = join(this.contextDir, 'memory')
    this.artifactsDir = join(this.contextDir, 'artifacts')
  }

  initialize(): void {
    const dirs = [
      this.memoryDir,
      join(this.memoryDir, 'custom'),
      join(this.artifactsDir, 'sessions'),
      join(this.artifactsDir, 'commands'),
      join(this.artifactsDir, 'errors')
    ]
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }

    // Create starter memory files if they don't exist
    const starters: Record<string, string> = {
      'decisions.md': '# Decisions\n\nArchitectural decisions recorded during sessions.\n',
      'conventions.md': '# Conventions\n\nCoding patterns and style choices for this project.\n',
      'issues.md': '# Known Issues\n\nGotchas, workarounds, and known problems.\n'
    }
    for (const [file, content] of Object.entries(starters)) {
      const filePath = join(this.memoryDir, file)
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content)
      }
    }

    // Create index
    const indexPath = join(this.contextDir, 'index.json')
    if (!existsSync(indexPath)) {
      writeFileSync(indexPath, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        agents: [],
        sessionCount: 0,
        commandFileCount: 0,
        errorFileCount: 0
      }, null, 2))
    }
  }

  appendCommand(entry: CommandEntry): void {
    const today = new Date().toISOString().slice(0, 10)
    const filePath = join(this.artifactsDir, 'commands', `${today}.jsonl`)
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n'
    appendFileSync(filePath, line)
  }

  appendError(entry: ErrorEntry): void {
    const today = new Date().toISOString().slice(0, 10)
    const filePath = join(this.artifactsDir, 'errors', `${today}.jsonl`)
    const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n'
    appendFileSync(filePath, line)
  }

  writeSession(session: SessionSummary): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${timestamp}-${session.agent}-${session.id.slice(-8)}.json`
    const filePath = join(this.artifactsDir, 'sessions', filename)
    writeFileSync(filePath, JSON.stringify(session, null, 2))
  }

  readMemory(name: string): string | null {
    const filePath = join(this.memoryDir, `${name}.md`)
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, 'utf-8')
  }

  writeMemory(name: string, content: string): void {
    const filePath = join(this.memoryDir, `${name}.md`)
    writeFileSync(filePath, content)
  }

  listMemoryFiles(): string[] {
    if (!existsSync(this.memoryDir)) return []
    return readdirSync(this.memoryDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  }

  updateIndex(): void {
    const agents = new Set<string>()

    // Scan session files for agents
    const sessionsDir = join(this.artifactsDir, 'sessions')
    if (existsSync(sessionsDir)) {
      for (const file of readdirSync(sessionsDir)) {
        try {
          const data = JSON.parse(readFileSync(join(sessionsDir, file), 'utf-8'))
          if (data.agent) agents.add(data.agent)
        } catch { /* skip */ }
      }
    }

    // Scan command files for agents
    const commandsDir = join(this.artifactsDir, 'commands')
    if (existsSync(commandsDir)) {
      for (const file of readdirSync(commandsDir)) {
        try {
          const lines = readFileSync(join(commandsDir, file), 'utf-8').trim().split('\n')
          for (const line of lines) {
            const data = JSON.parse(line)
            if (data.agent) agents.add(data.agent)
          }
        } catch { /* skip */ }
      }
    }

    const sessionCount = existsSync(sessionsDir) ? readdirSync(sessionsDir).length : 0
    const commandFileCount = existsSync(commandsDir) ? readdirSync(commandsDir).length : 0
    const errorsDir = join(this.artifactsDir, 'errors')
    const errorFileCount = existsSync(errorsDir) ? readdirSync(errorsDir).length : 0

    const index: ContextIndex = {
      lastUpdated: new Date().toISOString(),
      agents: [...agents],
      sessionCount,
      commandFileCount,
      errorFileCount
    }

    writeFileSync(join(this.contextDir, 'index.json'), JSON.stringify(index, null, 2))
  }

  getIndex(): ContextIndex {
    const indexPath = join(this.contextDir, 'index.json')
    if (!existsSync(indexPath)) {
      return { lastUpdated: '', agents: [], sessionCount: 0, commandFileCount: 0, errorFileCount: 0 }
    }
    return JSON.parse(readFileSync(indexPath, 'utf-8'))
  }

  prune(retentionDays: number): void {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000

    for (const subdir of ['commands', 'errors']) {
      const dir = join(this.artifactsDir, subdir)
      if (!existsSync(dir)) continue

      for (const file of readdirSync(dir)) {
        // Filenames are YYYY-MM-DD.jsonl
        const dateStr = file.replace('.jsonl', '')
        const fileDate = new Date(dateStr).getTime()
        if (fileDate < cutoff) {
          unlinkSync(join(dir, file))
        }
      }
    }
  }

  getContextDir(): string {
    return this.contextDir
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/context/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/context/store.ts src/context/store.test.ts
git commit -m "feat(context): add file-based shared context store with memory and artifacts"
```

---

## Task 5: AI-Enhanced Router

Add Ollama fallback to `TaskRouter` for ambiguous commands.

**Files:**
- Modify: `src/bro/router.ts`
- Modify: `src/bro/router.test.ts`

**Step 1: Write the failing tests**

Add to `src/bro/router.test.ts`:

```typescript
describe('AI-enhanced routing', () => {
  it('uses AI fallback for ambiguous commands when ollama provided', async () => {
    const mockOllama = {
      generate: vi.fn().mockResolvedValue('bro'),
      getModel: vi.fn().mockReturnValue('test-model')
    }

    const router = new TaskRouter(null, mockOllama as any)
    const result = await router.routeAsync('some ambiguous command with pipes | and stuff')

    // Should have called AI since pattern match has low confidence
    expect(result.decision).toBeDefined()
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('falls back to main when AI is unavailable', async () => {
    const mockOllama = {
      generate: vi.fn().mockRejectedValue(new Error('timeout')),
      getModel: vi.fn().mockReturnValue('test-model')
    }

    const router = new TaskRouter(null, mockOllama as any)
    const result = await router.routeAsync('ambiguous command here')

    expect(result.decision).toBe('main')
    expect(result.reason).toContain('fallback')
  })

  it('still uses patterns first (fast path)', async () => {
    const mockOllama = { generate: vi.fn(), getModel: vi.fn() }
    const router = new TaskRouter(null, mockOllama as any)

    const result = await router.routeAsync('git status')
    expect(result.decision).toBe('bro')
    expect(mockOllama.generate).not.toHaveBeenCalled()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/bro/router.test.ts`
Expected: FAIL - `routeAsync` doesn't exist

**Step 3: Implement AI-enhanced routing**

Add to `src/bro/router.ts`:

- Accept optional `OllamaClient` in constructor
- Add `routeAsync(command: string): Promise<RoutingResult>` method
- Pattern match first; if confidence < 0.7, call Ollama with 2s timeout
- Parse Ollama response for `bro`, `main`, or `both`
- Fallback to `main` if Ollama fails

```typescript
// Add to constructor:
private ollama: OllamaClient | null

constructor(profile: SystemProfile | null = null, ollama: OllamaClient | null = null) {
  this.profile = profile
  this.ollama = ollama
  this.rules = this.buildDefaultRules()
}

// New async method:
async routeAsync(command: string): Promise<RoutingResult> {
  // Fast path: pattern match
  const patternResult = this.route(command)
  if (patternResult.confidence >= 0.7) {
    return patternResult
  }

  // AI fallback for ambiguous commands
  if (!this.ollama) {
    return patternResult
  }

  try {
    const prompt = `Classify this command as one of: bro (simple, local task), main (complex, needs reasoning), both (can run in background). Command: "${command}". Respond with ONLY one word: bro, main, or both.`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const response = await this.ollama.generate(prompt, 'You are a command classifier. Respond with exactly one word: bro, main, or both.')
    clearTimeout(timeout)

    const decision = response.trim().toLowerCase() as RouteDecision
    if (['bro', 'main', 'both'].includes(decision)) {
      return { decision, reason: 'AI classification', confidence: 0.8 }
    }
  } catch {
    // AI unavailable - fallback
  }

  return { decision: 'main', reason: 'AI fallback - defaulting to main', confidence: 0.5 }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/bro/router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bro/router.ts src/bro/router.test.ts
git commit -m "feat(router): add AI-enhanced routing with Ollama fallback for ambiguous commands"
```

---

## Task 6: AI-Enhanced Suggester

Add Ollama-powered suggestions with caching.

**Files:**
- Modify: `src/bro/suggester.ts`
- Modify: `src/bro/suggester.test.ts`

**Step 1: Write the failing tests**

Add to `src/bro/suggester.test.ts`:

```typescript
describe('AI-enhanced suggestions', () => {
  it('adds AI suggestions via suggestAsync', async () => {
    const mockOllama = {
      suggestCommand: vi.fn().mockResolvedValue('npm run lint'),
      getModel: vi.fn().mockReturnValue('test-model')
    }

    const suggester = new CommandSuggester(null, mockOllama as any)
    const suggestions = await suggester.suggestAsync({
      lastCommand: 'npm test',
      lastOutput: 'all tests passed'
    })

    // Should include both pattern and AI suggestions
    expect(suggestions.some(s => s.source === 'pattern')).toBe(true)
    expect(suggestions.some(s => s.source === 'model')).toBe(true)
  })

  it('caches AI suggestions for identical contexts', async () => {
    const mockOllama = {
      suggestCommand: vi.fn().mockResolvedValue('npm run lint'),
      getModel: vi.fn().mockReturnValue('test-model')
    }

    const suggester = new CommandSuggester(null, mockOllama as any)
    const ctx = { lastCommand: 'npm test', lastOutput: 'ok' }

    await suggester.suggestAsync(ctx)
    await suggester.suggestAsync(ctx)

    // Should only call Ollama once due to cache
    expect(mockOllama.suggestCommand).toHaveBeenCalledTimes(1)
  })

  it('works without Ollama (graceful degradation)', async () => {
    const suggester = new CommandSuggester()
    const suggestions = await suggester.suggestAsync({ lastCommand: 'git status' })

    expect(suggestions.length).toBeGreaterThan(0)
    expect(suggestions.every(s => s.source !== 'model')).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/bro/suggester.test.ts`
Expected: FAIL

**Step 3: Implement AI-enhanced suggestions**

Add to `src/bro/suggester.ts`:

- Accept optional `OllamaClient` in constructor
- Add `suggestAsync(context)` method
- Build context string from `SuggestionContext`, call `ollama.suggestCommand()`
- Parse response, add as `source: 'model'` suggestion
- Cache with 5-minute TTL keyed on context hash

```typescript
// Add to class:
private ollama: OllamaClient | null
private aiCache: Map<string, { suggestions: Suggestion[], expiry: number }> = new Map()

constructor(profile: SystemProfile | null = null, ollama: OllamaClient | null = null) {
  this.profile = profile
  this.ollama = ollama
  this.initPatterns()
}

async suggestAsync(context: SuggestionContext): Promise<Suggestion[]> {
  // Get pattern/history/context suggestions first
  const suggestions = this.suggest(context)

  if (!this.ollama) return suggestions

  // Check cache
  const cacheKey = JSON.stringify({ lc: context.lastCommand, lo: context.lastOutput?.slice(0, 100) })
  const cached = this.aiCache.get(cacheKey)
  if (cached && cached.expiry > Date.now()) {
    suggestions.push(...cached.suggestions)
    return this.dedupeAndRank(suggestions).slice(0, 5)
  }

  // Call Ollama
  try {
    const contextStr = `Last command: ${context.lastCommand || 'none'}\nOutput: ${(context.lastOutput || '').slice(0, 200)}\nProject: ${context.projectType || 'unknown'}`
    const aiSuggestion = await this.ollama.suggestCommand(contextStr)

    if (aiSuggestion) {
      const aiSuggestions: Suggestion[] = [{
        command: aiSuggestion,
        description: 'AI suggestion',
        confidence: 0.75,
        source: 'model'
      }]

      this.aiCache.set(cacheKey, { suggestions: aiSuggestions, expiry: Date.now() + 5 * 60 * 1000 })
      suggestions.push(...aiSuggestions)
    }
  } catch {
    // AI unavailable
  }

  return this.dedupeAndRank(suggestions).slice(0, 5)
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/bro/suggester.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bro/suggester.ts src/bro/suggester.test.ts
git commit -m "feat(suggester): add AI-enhanced suggestions with caching via Ollama"
```

---

## Task 7: Wire Adapters & Profiles into BashBro

Connect `AdapterRegistry` and `ProfileManager` to the main `BashBro` class. Add `generateWithAdapter` method to `OllamaClient`.

**Files:**
- Modify: `src/bro/ollama.ts`
- Modify: `src/bro/bro.ts`

**Step 1: Add `generateWithAdapter` to OllamaClient**

In `src/bro/ollama.ts`, add:

```typescript
async generateWithAdapter(modelOverride: string, prompt: string, systemPrompt?: string): Promise<string> {
  const originalModel = this.config.model
  this.config.model = modelOverride
  try {
    return await this.generate(prompt, systemPrompt)
  } finally {
    this.config.model = originalModel
  }
}
```

**Step 2: Wire into BashBro constructor**

In `src/bro/bro.ts`, add imports and initialization:

```typescript
import { AdapterRegistry } from './adapters.js'
import { ProfileManager, type ModelProfile } from './profiles.js'

// Add to BroConfig:
activeProfile?: string

// Add to BashBro class fields:
private adapterRegistry: AdapterRegistry
private profileManager: ProfileManager
private activeProfile: ModelProfile | null = null

// In constructor, after ollama init:
this.adapterRegistry = new AdapterRegistry()
this.profileManager = new ProfileManager()
if (this.config.activeProfile) {
  this.activeProfile = this.profileManager.load(this.config.activeProfile)
}
```

**Step 3: Add profile-aware AI methods**

Update `aiSuggest` and `aiAnalyzeSafety` to use profile-specific models:

```typescript
// Helper method:
private getModelForPurpose(purpose: AdapterPurpose): string | null {
  if (!this.activeProfile) return null
  return this.profileManager.getModelForPurpose(this.activeProfile, purpose)
}
```

Then in each AI method, before calling `this.ollama.method()`, check if a profile override exists and use `generateWithAdapter` instead.

**Step 4: Add adapter/profile getters**

```typescript
getAdapters(): AdapterEntry[] {
  return this.adapterRegistry.discover()
}

getProfiles(): ModelProfile[] {
  return this.profileManager.list()
}

getActiveProfile(): ModelProfile | null {
  return this.activeProfile
}

setActiveProfile(name: string): boolean {
  const profile = this.profileManager.load(name)
  if (!profile) return false
  this.activeProfile = profile
  return true
}
```

**Step 5: Run all bro tests**

Run: `npx vitest run src/bro/`
Expected: PASS

**Step 6: Commit**

```bash
git add src/bro/ollama.ts src/bro/bro.ts
git commit -m "feat(bro): wire adapter registry and profile manager into BashBro class"
```

---

## Task 8: Dashboard Database - New Tables

Add tables for adapter activation events and context store queries.

**Files:**
- Modify: `src/dashboard/db.ts`

**Step 1: Add new table creation SQL**

In `initTables()`, add after existing tables:

```sql
CREATE TABLE IF NOT EXISTS adapter_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  adapter_name TEXT NOT NULL,
  base_model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  action TEXT NOT NULL,
  success INTEGER NOT NULL
)

CREATE INDEX IF NOT EXISTS idx_adapter_events_timestamp ON adapter_events(timestamp);
```

**Step 2: Add insert/query methods**

```typescript
export interface InsertAdapterEventInput {
  adapterName: string
  baseModel: string
  purpose: string
  action: 'activated' | 'deactivated' | 'created' | 'deleted'
  success: boolean
}

export interface AdapterEventRecord {
  id: string
  timestamp: Date
  adapterName: string
  baseModel: string
  purpose: string
  action: string
  success: boolean
}

insertAdapterEvent(input: InsertAdapterEventInput): string {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  const stmt = this.db.prepare(`
    INSERT INTO adapter_events (id, timestamp, adapter_name, base_model, purpose, action, success)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(id, timestamp, input.adapterName, input.baseModel, input.purpose, input.action, input.success ? 1 : 0)
  return id
}

getAdapterEvents(limit: number = 50): AdapterEventRecord[] {
  const stmt = this.db.prepare(`SELECT * FROM adapter_events ORDER BY timestamp DESC LIMIT ?`)
  const rows = stmt.all(limit) as any[]
  return rows.map(row => ({
    id: row.id,
    timestamp: new Date(row.timestamp),
    adapterName: row.adapter_name,
    baseModel: row.base_model,
    purpose: row.purpose,
    action: row.action,
    success: row.success === 1
  }))
}
```

**Step 3: Run existing dashboard tests**

Run: `npx vitest run src/dashboard/`
Expected: PASS (new tables don't break existing)

**Step 4: Commit**

```bash
git add src/dashboard/db.ts
git commit -m "feat(db): add adapter_events table for tracking adapter activations"
```

---

## Task 9: Dashboard Server - New Endpoints

Add model management, adapter, profile, and context endpoints.

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `src/dashboard/server.test.ts`

**Step 1: Add model management endpoints**

In `setupRoutes()`, after existing bro endpoints, add:

```typescript
// ─── Model Management ───

// Get model details
this.app.get('/api/bro/models/:name', async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(String(req.params.name))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch('http://localhost:11434/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: controller.signal
    })
    clearTimeout(timeout)
    if (!response.ok) {
      res.status(404).json({ error: 'Model not found' })
      return
    }
    const data = await response.json()
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch model details' })
  }
})

// Get running models
this.app.get('/api/bro/models/running', async (_req: Request, res: Response) => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const response = await fetch('http://localhost:11434/api/ps', { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) {
      res.json({ models: [] })
      return
    }
    const data = await response.json()
    res.json(data)
  } catch {
    res.json({ models: [] })
  }
})

// Pull a model
this.app.post('/api/bro/models/pull', async (req: Request, res: Response) => {
  try {
    const { name } = req.body
    if (!name) {
      res.status(400).json({ error: 'Model name required' })
      return
    }
    // Start the pull (non-streaming for simplicity, broadcast progress via WebSocket)
    this.broadcast({ type: 'model:pull:start', name })
    const response = await fetch('http://localhost:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, stream: false })
    })
    if (response.ok) {
      this.broadcast({ type: 'model:pull:complete', name })
      res.json({ success: true })
    } else {
      this.broadcast({ type: 'model:pull:error', name })
      res.status(500).json({ error: 'Pull failed' })
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to pull model' })
  }
})

// Delete a model
this.app.delete('/api/bro/models/:name', async (req: Request, res: Response) => {
  try {
    const name = decodeURIComponent(String(req.params.name))
    const response = await fetch('http://localhost:11434/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (response.ok) {
      res.json({ success: true })
    } else {
      res.status(500).json({ error: 'Delete failed' })
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete model' })
  }
})
```

**Step 2: Add adapter endpoints**

```typescript
// ─── Adapter Endpoints ───

// List discovered adapters
this.app.get('/api/bro/adapters', (_req: Request, res: Response) => {
  try {
    const { AdapterRegistry } = require('../bro/adapters.js')
    const registry = new AdapterRegistry()
    res.json(registry.discover())
  } catch (error) {
    res.json([])
  }
})

// Activate an adapter (create Ollama model from it)
this.app.post('/api/bro/adapters/:name/activate', async (req: Request, res: Response) => {
  try {
    const adapterName = String(req.params.name)
    const { AdapterRegistry } = require('../bro/adapters.js')
    const registry = new AdapterRegistry()
    const adapters = registry.discover()
    const adapter = adapters.find((a: any) => a.name === adapterName)

    if (!adapter) {
      res.status(404).json({ error: 'Adapter not found' })
      return
    }

    const modelfile = registry.generateModelfile(adapter)
    const ollamaName = registry.ollamaModelName(adapterName)

    const response = await fetch('http://localhost:11434/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: ollamaName, modelfile, stream: false })
    })

    if (response.ok) {
      this.db.insertAdapterEvent({
        adapterName, baseModel: adapter.baseModel,
        purpose: adapter.purpose, action: 'activated', success: true
      })
      this.broadcast({ type: 'adapter:activated', name: adapterName })
      res.json({ success: true, ollamaModel: ollamaName })
    } else {
      res.status(500).json({ error: 'Failed to create Ollama model from adapter' })
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate adapter' })
  }
})

// Get adapter events
this.app.get('/api/bro/adapters/events', (_req: Request, res: Response) => {
  try {
    res.json(this.db.getAdapterEvents())
  } catch {
    res.json([])
  }
})
```

**Step 3: Add profile endpoints**

```typescript
// ─── Profile Endpoints ───

this.app.get('/api/bro/profiles', (_req: Request, res: Response) => {
  try {
    const { ProfileManager } = require('../bro/profiles.js')
    const manager = new ProfileManager()
    res.json(manager.list())
  } catch {
    res.json([])
  }
})

this.app.post('/api/bro/profiles', (req: Request, res: Response) => {
  try {
    const { ProfileManager } = require('../bro/profiles.js')
    const manager = new ProfileManager()
    manager.save(req.body)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to save profile' })
  }
})

this.app.delete('/api/bro/profiles/:name', (req: Request, res: Response) => {
  try {
    const { ProfileManager } = require('../bro/profiles.js')
    const manager = new ProfileManager()
    manager.delete(String(req.params.name))
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete profile' })
  }
})
```

**Step 4: Add context endpoints**

```typescript
// ─── Context Endpoints ───

this.app.get('/api/context/index', (_req: Request, res: Response) => {
  try {
    const { ContextStore } = require('../context/store.js')
    const store = new ContextStore(process.cwd())
    res.json(store.getIndex())
  } catch {
    res.json({ lastUpdated: '', agents: [], sessionCount: 0, commandFileCount: 0, errorFileCount: 0 })
  }
})

this.app.get('/api/context/memory', (_req: Request, res: Response) => {
  try {
    const { ContextStore } = require('../context/store.js')
    const store = new ContextStore(process.cwd())
    const files = store.listMemoryFiles()
    const result: Record<string, string | null> = {}
    for (const file of files) {
      result[file] = store.readMemory(file)
    }
    res.json(result)
  } catch {
    res.json({})
  }
})

this.app.put('/api/context/memory/:name', (req: Request, res: Response) => {
  try {
    const { ContextStore } = require('../context/store.js')
    const store = new ContextStore(process.cwd())
    store.writeMemory(String(req.params.name), req.body.content)
    this.broadcast({ type: 'context:updated', file: req.params.name })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: 'Failed to write memory file' })
  }
})
```

**Step 5: Run dashboard tests**

Run: `npx vitest run src/dashboard/server.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/server.test.ts
git commit -m "feat(dashboard): add model management, adapter, profile, and context API endpoints"
```

---

## Task 10: Dashboard UI - Models Tab

Add the Models tab to the dashboard HTML with model cards, pull bar, adapter cards, and profile editor.

**Files:**
- Modify: `src/dashboard/static/index.html`

This is the largest UI task. Add:

1. **Tab button** in the nav: `<button onclick="switchTab('models')">Models</button>`
2. **Tab content** section with four sub-panels:
   - **Installed Models** - card grid fetched from `GET /api/bro/models`, each card shows name/size/family/quantization, delete button, "activate" quick-switch
   - **Running Models** - fetched from `GET /api/bro/models/running`, shows VRAM usage
   - **Pull Model** - input + button, calls `POST /api/bro/models/pull`, listens for WebSocket `model:pull:complete`
   - **Adapters** - card grid from `GET /api/bro/adapters`, activate button calls `POST /api/bro/adapters/:name/activate`
   - **Profiles** - list from `GET /api/bro/profiles`, simple editor form

3. **JavaScript functions**: `fetchModels()`, `fetchRunningModels()`, `pullModel()`, `deleteModel()`, `fetchAdapters()`, `activateAdapter()`, `fetchProfiles()`, `saveProfile()`
4. **WebSocket handler** additions for `model:pull:start`, `model:pull:complete`, `model:pull:error`, `adapter:activated`
5. **CSS** for model cards matching existing dashboard style

**Implementation notes:**
- Follow the existing HTML patterns in `index.html` (inline CSS, vanilla JS, fetch API)
- Model size should be formatted as human-readable (e.g., "4.9 GB")
- Cards should use the existing `.card` CSS class pattern

**Step 1: Implement the full Models tab**

Add the tab and all associated HTML/CSS/JS. This is a single large edit to `index.html`.

**Step 2: Test manually**

Run: `npx tsx src/dashboard/server.ts` (or the watch mode) and verify the Models tab renders.

**Step 3: Commit**

```bash
git add src/dashboard/static/index.html
git commit -m "feat(dashboard): add Models tab with model cards, pull bar, adapters, and profiles"
```

---

## Task 11: Dashboard UI - Context Tab

Add the Context tab with memory viewer, session browser, and stats.

**Files:**
- Modify: `src/dashboard/static/index.html`

Add:

1. **Tab button**: `<button onclick="switchTab('context')">Context</button>`
2. **Tab content** with three panels:
   - **Memory Files** - list of markdown files from `GET /api/context/memory`, inline editor with `<textarea>`, save button calls `PUT /api/context/memory/:name`
   - **Stats** - from `GET /api/context/index` - total sessions, commands logged, agents seen
   - **Session Browser** - placeholder (future: search/filter artifacts)

3. **JavaScript functions**: `fetchContextMemory()`, `saveMemoryFile()`, `fetchContextIndex()`
4. **WebSocket handler** for `context:updated`

**Step 1: Implement the Context tab**

**Step 2: Test manually**

**Step 3: Commit**

```bash
git add src/dashboard/static/index.html
git commit -m "feat(dashboard): add Context tab with memory viewer and stats"
```

---

## Task 12: Dashboard UI - Updated Bash Bro Tab

Enrich the existing Bash Bro tab with adapter info and routing stats.

**Files:**
- Modify: `src/dashboard/static/index.html`

Update the existing Bash Bro section:

1. **Status panel** - Add: active profile name, active adapters per function
2. **Activity log** - Add columns: adapter used (if any), cache hit/miss badge
3. **New section: Router Stats** - Show pattern-matched vs AI-routed counts (from bro_events where event_type = 'route')
4. **New section: Adapter Events** - Table from `GET /api/bro/adapters/events`

**Step 1: Implement updates**

**Step 2: Test manually**

**Step 3: Commit**

```bash
git add src/dashboard/static/index.html
git commit -m "feat(dashboard): enrich Bash Bro tab with adapter info and routing stats"
```

---

## Task 13: Integration - Wire Context Store into Watch Mode

Connect the context store to the watch mode so it auto-writes after sessions.

**Files:**
- Modify: `src/watch.ts`

**Step 1: Import and initialize context store**

At session start, call `store.initialize()`. On each command result, call `store.appendCommand()`. On errors, call `store.appendError()`. At session end, call `store.writeSession()` and `store.updateIndex()`.

**Step 2: Run existing tests**

Run: `npx vitest run`
Expected: All existing tests PASS

**Step 3: Commit**

```bash
git add src/watch.ts
git commit -m "feat(watch): wire context store auto-write into watch mode sessions"
```

---

## Task 14: Final Integration & Smoke Test

Wire the AI-enhanced router and suggester through `BashBro` and run full test suite.

**Files:**
- Modify: `src/bro/bro.ts` (pass `this.ollama` to `TaskRouter` and `CommandSuggester`)

**Step 1: Update BashBro constructor**

```typescript
this.router = new TaskRouter(null, this.ollama)
this.suggester = new CommandSuggester(null, this.ollama)
```

**Step 2: Add async routing/suggestion methods to BashBro**

```typescript
async routeAsync(command: string): Promise<RoutingResult> {
  if (!this.config.enableRouting) {
    return { decision: 'main', reason: 'Routing disabled', confidence: 1 }
  }
  return this.router.routeAsync(command)
}

async suggestAsync(context: SuggestionContext): Promise<Suggestion[]> {
  if (!this.config.enableSuggestions) return []
  return this.suggester.suggestAsync(context)
}
```

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/bro/bro.ts
git commit -m "feat(bro): wire AI-enhanced router and suggester, final integration"
```

---

## Summary

| Task | Module | What It Does |
|------|--------|-------------|
| 1 | `ollama.ts` | Model management methods (show, delete, pull, listRunning, createModel) |
| 2 | `adapters.ts` | LoRA adapter registry with discovery and Modelfile generation |
| 3 | `profiles.ts` | Model profiles for per-function adapter assignment |
| 4 | `context/store.ts` | File-based shared context store (memory + artifacts) |
| 5 | `router.ts` | AI-enhanced routing with Ollama fallback |
| 6 | `suggester.ts` | AI-enhanced suggestions with caching |
| 7 | `bro.ts` + `ollama.ts` | Wire adapters/profiles into BashBro, add generateWithAdapter |
| 8 | `db.ts` | New adapter_events table |
| 9 | `server.ts` | 15+ new dashboard API endpoints |
| 10 | `index.html` | Models tab UI (cards, pull bar, adapters, profiles) |
| 11 | `index.html` | Context tab UI (memory viewer, stats) |
| 12 | `index.html` | Bash Bro tab updates (adapter info, router stats) |
| 13 | `watch.ts` | Context store auto-write integration |
| 14 | `bro.ts` | Final wiring and smoke test |
