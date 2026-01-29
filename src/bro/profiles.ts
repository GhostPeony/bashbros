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
    if (!existsSync(this.profilesDir)) mkdirSync(this.profilesDir, { recursive: true })
    writeFileSync(join(this.profilesDir, `${profile.name}.json`), JSON.stringify(profile, null, 2))
  }

  load(name: string): ModelProfile | null {
    const filePath = join(this.profilesDir, `${name}.json`)
    if (!existsSync(filePath)) return null
    try { return JSON.parse(readFileSync(filePath, 'utf-8')) as ModelProfile } catch { return null }
  }

  list(): ModelProfile[] {
    if (!existsSync(this.profilesDir)) return []
    try {
      return readdirSync(this.profilesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => { try { return JSON.parse(readFileSync(join(this.profilesDir, f), 'utf-8')) as ModelProfile } catch { return null } })
        .filter((p): p is ModelProfile => p !== null)
    } catch { return [] }
  }

  delete(name: string): boolean {
    const filePath = join(this.profilesDir, `${name}.json`)
    if (!existsSync(filePath)) return false
    unlinkSync(filePath)
    return true
  }

  getModelForPurpose(profile: ModelProfile, purpose: AdapterPurpose): string {
    const adapterName = profile.adapters[purpose]
    if (adapterName) return `bashbros/${adapterName}`
    return profile.baseModel
  }
}
