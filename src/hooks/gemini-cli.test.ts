import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { GeminiCLIHooks, type GeminiSettings } from './gemini-cli.js'

describe('GeminiCLIHooks', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), 'bashbros-gemini-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('isInstalled', () => {
    it('returns false when no hooks exist', () => {
      expect(GeminiCLIHooks.isInstalled({})).toBe(false)
    })

    it('returns false when hooks exist but no marker', () => {
      const settings: GeminiSettings = {
        hooks: {
          BeforeTool: [{
            matcher: 'run_shell_command',
            hooks: [{ name: 'other', type: 'command', command: 'echo test' }]
          }]
        }
      }
      expect(GeminiCLIHooks.isInstalled(settings)).toBe(false)
    })

    it('returns true when bashbros hooks are present in BeforeTool', () => {
      const settings: GeminiSettings = {
        hooks: {
          BeforeTool: [{
            matcher: 'run_shell_command',
            hooks: [{ name: 'bashbros-gate', type: 'command', command: 'bashbros gemini-gate # bashbros-managed' }]
          }]
        }
      }
      expect(GeminiCLIHooks.isInstalled(settings)).toBe(true)
    })

    it('returns true when bashbros hooks are present in AfterTool', () => {
      const settings: GeminiSettings = {
        hooks: {
          AfterTool: [{
            matcher: 'run_shell_command',
            hooks: [{ name: 'bashbros-record', type: 'command', command: 'bashbros gemini-record # bashbros-managed' }]
          }]
        }
      }
      expect(GeminiCLIHooks.isInstalled(settings)).toBe(true)
    })

    it('returns true when bashbros hooks are present in SessionEnd', () => {
      const settings: GeminiSettings = {
        hooks: {
          SessionEnd: [{
            hooks: [{ name: 'bashbros-session-end', type: 'command', command: 'bashbros session-end # bashbros-managed' }]
          }]
        }
      }
      expect(GeminiCLIHooks.isInstalled(settings)).toBe(true)
    })
  })

  describe('loadSettings', () => {
    it('returns empty object when no settings file exists', () => {
      const settings = GeminiCLIHooks.loadSettings(testDir)
      expect(settings).toEqual({})
    })

    it('loads settings from .gemini/settings.json', () => {
      const geminiDir = join(testDir, '.gemini')
      mkdirSync(geminiDir, { recursive: true })
      writeFileSync(join(geminiDir, 'settings.json'), JSON.stringify({ test: true }))

      const settings = GeminiCLIHooks.loadSettings(testDir)
      expect(settings.test).toBe(true)
    })

    it('returns empty object for invalid JSON', () => {
      const geminiDir = join(testDir, '.gemini')
      mkdirSync(geminiDir, { recursive: true })
      writeFileSync(join(geminiDir, 'settings.json'), 'not json')

      const settings = GeminiCLIHooks.loadSettings(testDir)
      expect(settings).toEqual({})
    })
  })

  describe('saveSettings', () => {
    it('creates .gemini directory if needed', () => {
      GeminiCLIHooks.saveSettings({ test: true } as any, testDir)

      const geminiDir = join(testDir, '.gemini')
      expect(existsSync(geminiDir)).toBe(true)
      expect(existsSync(join(geminiDir, 'settings.json'))).toBe(true)
    })

    it('writes valid JSON', () => {
      const settings: GeminiSettings = { hooks: {} }
      GeminiCLIHooks.saveSettings(settings, testDir)

      const content = readFileSync(join(testDir, '.gemini', 'settings.json'), 'utf-8')
      expect(JSON.parse(content)).toEqual(settings)
    })
  })

  describe('install', () => {
    it('fails when gemini not installed', () => {
      const result = GeminiCLIHooks.install(testDir)
      // If gemini CLI is on PATH, install will succeed (creates .gemini dir)
      // If not on PATH and no .gemini dir, install should fail
      if (!GeminiCLIHooks.isGeminiInstalled(testDir)) {
        expect(result.success).toBe(false)
        expect(result.message).toContain('not found')
      } else {
        expect(result.success).toBe(true)
      }
    })

    it('installs hooks when .gemini directory exists', () => {
      // Create .gemini dir to simulate Gemini being installed
      mkdirSync(join(testDir, '.gemini'), { recursive: true })

      const result = GeminiCLIHooks.install(testDir)
      expect(result.success).toBe(true)
      expect(result.message).toContain('installed')

      // Verify settings were written
      const settings = GeminiCLIHooks.loadSettings(testDir)
      expect(settings.hooks?.BeforeTool).toBeDefined()
      expect(settings.hooks?.AfterTool).toBeDefined()
      expect(settings.hooks?.SessionEnd).toBeDefined()
    })

    it('preserves existing hooks during install', () => {
      // Create .gemini with existing hooks
      const geminiDir = join(testDir, '.gemini')
      mkdirSync(geminiDir, { recursive: true })
      writeFileSync(join(geminiDir, 'settings.json'), JSON.stringify({
        hooks: {
          BeforeTool: [{
            matcher: 'write_file',
            hooks: [{ name: 'other-hook', type: 'command', command: 'echo test' }]
          }]
        }
      }))

      const result = GeminiCLIHooks.install(testDir)
      expect(result.success).toBe(true)

      const settings = GeminiCLIHooks.loadSettings(testDir)
      // Should have both the existing hook and our new one
      expect(settings.hooks?.BeforeTool?.length).toBe(2)
    })

    it('reports already installed on second call', () => {
      mkdirSync(join(testDir, '.gemini'), { recursive: true })

      GeminiCLIHooks.install(testDir)
      const result = GeminiCLIHooks.install(testDir)
      expect(result.success).toBe(true)
      expect(result.message).toContain('already installed')
    })
  })

  describe('uninstall', () => {
    it('removes only bashbros hooks', () => {
      // Install first
      const geminiDir = join(testDir, '.gemini')
      mkdirSync(geminiDir, { recursive: true })
      writeFileSync(join(geminiDir, 'settings.json'), JSON.stringify({
        hooks: {
          BeforeTool: [
            {
              matcher: 'write_file',
              hooks: [{ name: 'other-hook', type: 'command', command: 'echo test' }]
            },
            {
              matcher: 'run_shell_command',
              hooks: [{ name: 'bashbros-gate', type: 'command', command: 'bashbros gemini-gate # bashbros-managed' }]
            }
          ]
        }
      }))

      const result = GeminiCLIHooks.uninstall(testDir)
      expect(result.success).toBe(true)

      const settings = GeminiCLIHooks.loadSettings(testDir)
      // Should keep the non-bashbros hook
      expect(settings.hooks?.BeforeTool?.length).toBe(1)
      expect(settings.hooks?.BeforeTool?.[0].hooks[0].name).toBe('other-hook')
    })

    it('cleans up empty hook arrays', () => {
      mkdirSync(join(testDir, '.gemini'), { recursive: true })
      GeminiCLIHooks.install(testDir)
      GeminiCLIHooks.uninstall(testDir)

      const settings = GeminiCLIHooks.loadSettings(testDir)
      expect(settings.hooks).toBeUndefined()
    })
  })

  describe('getStatus', () => {
    it('returns correct status when not installed', () => {
      const status = GeminiCLIHooks.getStatus(testDir)
      // geminiInstalled may be true if gemini command is on PATH
      expect(status.hooksInstalled).toBe(false)
      expect(status.hooks).toEqual([])
    })

    it('returns correct status when installed', () => {
      mkdirSync(join(testDir, '.gemini'), { recursive: true })
      GeminiCLIHooks.install(testDir)

      const status = GeminiCLIHooks.getStatus(testDir)
      expect(status.geminiInstalled).toBe(true)
      expect(status.hooksInstalled).toBe(true)
      expect(status.hooks).toContain('BeforeTool (gate)')
      expect(status.hooks).toContain('AfterTool (record)')
      expect(status.hooks).toContain('SessionEnd (report)')
    })
  })
})
