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
    if (!existsSync(this.adaptersDir)) return []
    const entries: AdapterEntry[] = []
    try {
      const dirs = readdirSync(this.adaptersDir, { withFileTypes: true }).filter(d => d.isDirectory())
      for (const dir of dirs) {
        const manifestPath = join(this.adaptersDir, dir.name, 'manifest.json')
        const adapterPath = join(this.adaptersDir, dir.name, 'adapter.gguf')
        if (!existsSync(manifestPath) || !existsSync(adapterPath)) continue
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as AdapterManifest
          entries.push({ ...manifest, adapterPath })
        } catch { /* skip malformed */ }
      }
    } catch { /* dir read error */ }
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
