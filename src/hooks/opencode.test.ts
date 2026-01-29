import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { OpenCodeHooks } from './opencode.js'

describe('OpenCodeHooks', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), 'bashbros-opencode-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('generatePluginSource', () => {
    it('returns non-empty string', () => {
      const source = OpenCodeHooks.generatePluginSource()
      expect(source.length).toBeGreaterThan(0)
    })

    it('starts with bashbros-managed marker', () => {
      const source = OpenCodeHooks.generatePluginSource()
      expect(source.startsWith('// bashbros-managed')).toBe(true)
    })

    it('imports from @opencode-ai/plugin', () => {
      const source = OpenCodeHooks.generatePluginSource()
      expect(source).toContain('@opencode-ai/plugin')
    })

    it('exports BashBrosPlugin', () => {
      const source = OpenCodeHooks.generatePluginSource()
      expect(source).toContain('export const BashBrosPlugin')
    })

    it('handles tool.execute.before event', () => {
      const source = OpenCodeHooks.generatePluginSource()
      expect(source).toContain('tool.execute.before')
    })

    it('handles tool.execute.after event', () => {
      const source = OpenCodeHooks.generatePluginSource()
      expect(source).toContain('tool.execute.after')
    })

    it('calls bashbros gate for command validation', () => {
      const source = OpenCodeHooks.generatePluginSource()
      expect(source).toContain('bashbros gate')
    })

    it('calls bashbros record for post-execution', () => {
      const source = OpenCodeHooks.generatePluginSource()
      expect(source).toContain('bashbros record')
    })
  })

  describe('isInstalled', () => {
    it('returns false when no plugin file exists', () => {
      expect(OpenCodeHooks.isInstalled(testDir)).toBe(false)
    })

    it('returns false when plugin file exists without marker', () => {
      const pluginsDir = join(testDir, '.opencode', 'plugins')
      mkdirSync(pluginsDir, { recursive: true })
      writeFileSync(join(pluginsDir, 'bashbros.ts'), 'export const MyPlugin = async () => {}')

      expect(OpenCodeHooks.isInstalled(testDir)).toBe(false)
    })

    it('returns true when plugin file has bashbros-managed marker', () => {
      const pluginsDir = join(testDir, '.opencode', 'plugins')
      mkdirSync(pluginsDir, { recursive: true })
      writeFileSync(join(pluginsDir, 'bashbros.ts'), '// bashbros-managed\nexport const Plugin = async () => {}')

      expect(OpenCodeHooks.isInstalled(testDir)).toBe(true)
    })
  })

  describe('install', () => {
    it('fails when OpenCode not installed', () => {
      const result = OpenCodeHooks.install(testDir)
      // If opencode command is on PATH, install will succeed
      if (!OpenCodeHooks.isOpenCodeInstalled(testDir)) {
        expect(result.success).toBe(false)
        expect(result.message).toContain('not found')
      } else {
        expect(result.success).toBe(true)
      }
    })

    it('installs plugin when .opencode directory exists', () => {
      mkdirSync(join(testDir, '.opencode'), { recursive: true })

      const result = OpenCodeHooks.install(testDir)
      expect(result.success).toBe(true)
      expect(result.message).toContain('installed')

      // Verify plugin file was created
      const pluginPath = join(testDir, '.opencode', 'plugins', 'bashbros.ts')
      expect(existsSync(pluginPath)).toBe(true)

      // Verify content starts with marker
      const content = readFileSync(pluginPath, 'utf-8')
      expect(content.startsWith('// bashbros-managed')).toBe(true)
    })

    it('creates plugins directory if needed', () => {
      mkdirSync(join(testDir, '.opencode'), { recursive: true })
      OpenCodeHooks.install(testDir)

      expect(existsSync(join(testDir, '.opencode', 'plugins'))).toBe(true)
    })

    it('reports already installed on second call', () => {
      mkdirSync(join(testDir, '.opencode'), { recursive: true })

      OpenCodeHooks.install(testDir)
      const result = OpenCodeHooks.install(testDir)
      expect(result.success).toBe(true)
      expect(result.message).toContain('already installed')
    })
  })

  describe('uninstall', () => {
    it('succeeds when no plugin file exists', () => {
      const result = OpenCodeHooks.uninstall(testDir)
      expect(result.success).toBe(true)
      expect(result.message).toContain('Nothing to uninstall')
    })

    it('refuses to remove user-created plugin', () => {
      const pluginsDir = join(testDir, '.opencode', 'plugins')
      mkdirSync(pluginsDir, { recursive: true })
      writeFileSync(join(pluginsDir, 'bashbros.ts'), 'export const MyPlugin = async () => {}')

      const result = OpenCodeHooks.uninstall(testDir)
      expect(result.success).toBe(false)
      expect(result.message).toContain('not managed by BashBros')
    })

    it('removes bashbros-managed plugin', () => {
      mkdirSync(join(testDir, '.opencode'), { recursive: true })
      OpenCodeHooks.install(testDir)

      const result = OpenCodeHooks.uninstall(testDir)
      expect(result.success).toBe(true)

      const pluginPath = join(testDir, '.opencode', 'plugins', 'bashbros.ts')
      expect(existsSync(pluginPath)).toBe(false)
    })
  })

  describe('getStatus', () => {
    it('returns correct status when not installed', () => {
      const status = OpenCodeHooks.getStatus(testDir)
      // openCodeInstalled may be true if opencode command is on PATH
      expect(status.pluginInstalled).toBe(false)
    })

    it('detects OpenCode when .opencode dir exists', () => {
      mkdirSync(join(testDir, '.opencode'), { recursive: true })
      const status = OpenCodeHooks.getStatus(testDir)
      expect(status.openCodeInstalled).toBe(true)
    })

    it('detects plugin when installed', () => {
      mkdirSync(join(testDir, '.opencode'), { recursive: true })
      OpenCodeHooks.install(testDir)

      const status = OpenCodeHooks.getStatus(testDir)
      expect(status.openCodeInstalled).toBe(true)
      expect(status.pluginInstalled).toBe(true)
    })
  })
})
