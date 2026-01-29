import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ProfileManager } from './profiles.js'
import type { ModelProfile } from './profiles.js'

describe('ProfileManager', () => {
  let tempDir: string
  let manager: ProfileManager

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bashbros-profiles-test-'))
    manager = new ProfileManager(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('save and load', () => {
    it('saves a profile and loads it back', () => {
      const profile: ModelProfile = {
        name: 'test-profile',
        baseModel: 'qwen2.5-coder:7b',
        adapters: {
          suggest: 'suggest-adapter',
          safety: 'safety-adapter'
        }
      }

      manager.save(profile)
      const loaded = manager.load('test-profile')

      expect(loaded).not.toBeNull()
      expect(loaded!.name).toBe('test-profile')
      expect(loaded!.baseModel).toBe('qwen2.5-coder:7b')
      expect(loaded!.adapters.suggest).toBe('suggest-adapter')
      expect(loaded!.adapters.safety).toBe('safety-adapter')
    })

    it('returns null for nonexistent profile', () => {
      const loaded = manager.load('nonexistent')
      expect(loaded).toBeNull()
    })

    it('overwrites existing profile on save', () => {
      const profile: ModelProfile = {
        name: 'overwrite-test',
        baseModel: 'llama2',
        adapters: {}
      }

      manager.save(profile)

      const updated: ModelProfile = {
        name: 'overwrite-test',
        baseModel: 'codellama',
        adapters: { explain: 'explain-v2' }
      }

      manager.save(updated)
      const loaded = manager.load('overwrite-test')

      expect(loaded).not.toBeNull()
      expect(loaded!.baseModel).toBe('codellama')
      expect(loaded!.adapters.explain).toBe('explain-v2')
    })

    it('creates profiles directory if it does not exist', () => {
      const nestedDir = join(tempDir, 'nested', 'deep', 'profiles')
      const nestedManager = new ProfileManager(nestedDir)

      const profile: ModelProfile = {
        name: 'nested-test',
        baseModel: 'llama2',
        adapters: {}
      }

      nestedManager.save(profile)
      const loaded = nestedManager.load('nested-test')

      expect(loaded).not.toBeNull()
      expect(loaded!.name).toBe('nested-test')
    })

    it('returns null for corrupted JSON file', () => {
      const { writeFileSync } = require('fs')
      writeFileSync(join(tempDir, 'bad.json'), 'not valid json {{{')

      const loaded = manager.load('bad')
      expect(loaded).toBeNull()
    })
  })

  describe('list', () => {
    it('returns empty array when no profiles exist', () => {
      const profiles = manager.list()
      expect(profiles).toEqual([])
    })

    it('returns empty array when directory does not exist', () => {
      const noDir = new ProfileManager(join(tempDir, 'nonexistent-dir'))
      const profiles = noDir.list()
      expect(profiles).toEqual([])
    })

    it('lists all saved profiles', () => {
      const profile1: ModelProfile = {
        name: 'alpha',
        baseModel: 'llama2',
        adapters: {}
      }
      const profile2: ModelProfile = {
        name: 'beta',
        baseModel: 'codellama',
        adapters: { suggest: 'suggest-adapter' }
      }
      const profile3: ModelProfile = {
        name: 'gamma',
        baseModel: 'qwen2.5-coder:7b',
        adapters: { safety: 'safety-v1', fix: 'fix-v1' }
      }

      manager.save(profile1)
      manager.save(profile2)
      manager.save(profile3)

      const profiles = manager.list()

      expect(profiles).toHaveLength(3)

      const names = profiles.map(p => p.name).sort()
      expect(names).toEqual(['alpha', 'beta', 'gamma'])
    })

    it('skips corrupted JSON files in listing', () => {
      const { writeFileSync } = require('fs')

      const goodProfile: ModelProfile = {
        name: 'good',
        baseModel: 'llama2',
        adapters: {}
      }
      manager.save(goodProfile)

      writeFileSync(join(tempDir, 'corrupted.json'), '{{invalid json}}')

      const profiles = manager.list()
      expect(profiles).toHaveLength(1)
      expect(profiles[0].name).toBe('good')
    })

    it('ignores non-JSON files', () => {
      const { writeFileSync } = require('fs')

      const profile: ModelProfile = {
        name: 'valid',
        baseModel: 'llama2',
        adapters: {}
      }
      manager.save(profile)

      writeFileSync(join(tempDir, 'readme.txt'), 'not a profile')
      writeFileSync(join(tempDir, 'notes.md'), '# Notes')

      const profiles = manager.list()
      expect(profiles).toHaveLength(1)
      expect(profiles[0].name).toBe('valid')
    })
  })

  describe('delete', () => {
    it('deletes an existing profile', () => {
      const profile: ModelProfile = {
        name: 'to-delete',
        baseModel: 'llama2',
        adapters: {}
      }

      manager.save(profile)
      expect(manager.load('to-delete')).not.toBeNull()

      const result = manager.delete('to-delete')
      expect(result).toBe(true)
      expect(manager.load('to-delete')).toBeNull()
    })

    it('returns false when deleting nonexistent profile', () => {
      const result = manager.delete('nonexistent')
      expect(result).toBe(false)
    })

    it('profile no longer appears in list after deletion', () => {
      const profile1: ModelProfile = {
        name: 'keep',
        baseModel: 'llama2',
        adapters: {}
      }
      const profile2: ModelProfile = {
        name: 'remove',
        baseModel: 'codellama',
        adapters: {}
      }

      manager.save(profile1)
      manager.save(profile2)
      expect(manager.list()).toHaveLength(2)

      manager.delete('remove')

      const remaining = manager.list()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].name).toBe('keep')
    })
  })

  describe('getModelForPurpose', () => {
    it('returns adapter model name when adapter is configured', () => {
      const profile: ModelProfile = {
        name: 'with-adapters',
        baseModel: 'qwen2.5-coder:7b',
        adapters: {
          suggest: 'suggest-v1',
          safety: 'safety-v2'
        }
      }

      const model = manager.getModelForPurpose(profile, 'suggest')
      expect(model).toBe('bashbros/suggest-v1')
    })

    it('returns base model when no adapter is configured for purpose', () => {
      const profile: ModelProfile = {
        name: 'partial-adapters',
        baseModel: 'qwen2.5-coder:7b',
        adapters: {
          suggest: 'suggest-v1'
        }
      }

      const model = manager.getModelForPurpose(profile, 'safety')
      expect(model).toBe('qwen2.5-coder:7b')
    })

    it('returns base model when adapters map is empty', () => {
      const profile: ModelProfile = {
        name: 'no-adapters',
        baseModel: 'llama2',
        adapters: {}
      }

      const model = manager.getModelForPurpose(profile, 'explain')
      expect(model).toBe('llama2')
    })

    it('returns correct model for each configured purpose', () => {
      const profile: ModelProfile = {
        name: 'full-adapters',
        baseModel: 'qwen2.5-coder:7b',
        adapters: {
          suggest: 'suggest-adapter',
          safety: 'safety-adapter',
          route: 'route-adapter',
          explain: 'explain-adapter',
          fix: 'fix-adapter',
          script: 'script-adapter',
          general: 'general-adapter'
        }
      }

      expect(manager.getModelForPurpose(profile, 'suggest')).toBe('bashbros/suggest-adapter')
      expect(manager.getModelForPurpose(profile, 'safety')).toBe('bashbros/safety-adapter')
      expect(manager.getModelForPurpose(profile, 'route')).toBe('bashbros/route-adapter')
      expect(manager.getModelForPurpose(profile, 'explain')).toBe('bashbros/explain-adapter')
      expect(manager.getModelForPurpose(profile, 'fix')).toBe('bashbros/fix-adapter')
      expect(manager.getModelForPurpose(profile, 'script')).toBe('bashbros/script-adapter')
      expect(manager.getModelForPurpose(profile, 'general')).toBe('bashbros/general-adapter')
    })
  })
})
