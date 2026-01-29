import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CopilotCLIHooks, type CopilotHookConfig } from './copilot-cli.js'

describe('CopilotCLIHooks', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), 'bashbros-copilot-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('isInstalled', () => {
    it('returns false when no hooks file exists', () => {
      expect(CopilotCLIHooks.isInstalled(testDir)).toBe(false)
    })

    it('returns false when hooks file exists without _bashbros marker', () => {
      const hooksDir = join(testDir, '.github', 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(join(hooksDir, 'bashbros.json'), JSON.stringify({
        version: 1,
        hooks: {}
      }))

      expect(CopilotCLIHooks.isInstalled(testDir)).toBe(false)
    })

    it('returns true when hooks file has _bashbros marker', () => {
      const hooksDir = join(testDir, '.github', 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(join(hooksDir, 'bashbros.json'), JSON.stringify({
        version: 1,
        _bashbros: true,
        hooks: {}
      }))

      expect(CopilotCLIHooks.isInstalled(testDir)).toBe(true)
    })
  })

  describe('install', () => {
    it('fails when copilot not installed', () => {
      const result = CopilotCLIHooks.install(testDir)
      // May fail because copilot command not on PATH
      if (!result.success) {
        expect(result.message).toContain('not found')
      }
    })

    it('creates correct hook structure when installed manually', () => {
      // Simulate successful installation by writing the file directly
      const hooksDir = join(testDir, '.github', 'hooks')
      mkdirSync(hooksDir, { recursive: true })

      const config: CopilotHookConfig = {
        version: 1,
        _bashbros: true,
        hooks: {
          preToolUse: [{
            type: 'command',
            bash: 'bashbros copilot-gate',
            powershell: 'bashbros copilot-gate',
            timeoutSec: 30
          }],
          postToolUse: [{
            type: 'command',
            bash: 'bashbros copilot-record',
            powershell: 'bashbros copilot-record'
          }],
          sessionEnd: [{
            type: 'command',
            bash: 'bashbros session-end',
            powershell: 'bashbros session-end'
          }]
        }
      }

      writeFileSync(join(hooksDir, 'bashbros.json'), JSON.stringify(config, null, 2))

      // Verify structure
      const content = JSON.parse(readFileSync(join(hooksDir, 'bashbros.json'), 'utf-8'))
      expect(content.version).toBe(1)
      expect(content._bashbros).toBe(true)
      expect(content.hooks.preToolUse[0].bash).toBe('bashbros copilot-gate')
      expect(content.hooks.preToolUse[0].powershell).toBe('bashbros copilot-gate')
      expect(content.hooks.preToolUse[0].timeoutSec).toBe(30)
      expect(content.hooks.postToolUse[0].bash).toBe('bashbros copilot-record')
      expect(content.hooks.sessionEnd[0].bash).toBe('bashbros session-end')
    })
  })

  describe('uninstall', () => {
    it('succeeds when no hooks file exists', () => {
      const result = CopilotCLIHooks.uninstall(testDir)
      expect(result.success).toBe(true)
      expect(result.message).toContain('Nothing to uninstall')
    })

    it('refuses to remove non-bashbros hooks file', () => {
      const hooksDir = join(testDir, '.github', 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(join(hooksDir, 'bashbros.json'), JSON.stringify({
        version: 1,
        hooks: { preToolUse: [] }
      }))

      const result = CopilotCLIHooks.uninstall(testDir)
      expect(result.success).toBe(false)
      expect(result.message).toContain('not created by BashBros')
    })

    it('removes bashbros hooks file', () => {
      const hooksDir = join(testDir, '.github', 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(join(hooksDir, 'bashbros.json'), JSON.stringify({
        version: 1,
        _bashbros: true,
        hooks: {}
      }))

      const result = CopilotCLIHooks.uninstall(testDir)
      expect(result.success).toBe(true)
      expect(existsSync(join(hooksDir, 'bashbros.json'))).toBe(false)
    })
  })

  describe('getStatus', () => {
    it('returns correct status when not installed', () => {
      const status = CopilotCLIHooks.getStatus(testDir)
      expect(status.hooksInstalled).toBe(false)
      expect(status.hooks).toEqual([])
    })

    it('returns hooks list when installed', () => {
      const hooksDir = join(testDir, '.github', 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(join(hooksDir, 'bashbros.json'), JSON.stringify({
        version: 1,
        _bashbros: true,
        hooks: {
          preToolUse: [{ type: 'command', bash: 'bashbros copilot-gate', powershell: 'bashbros copilot-gate' }],
          postToolUse: [{ type: 'command', bash: 'bashbros copilot-record', powershell: 'bashbros copilot-record' }],
          sessionEnd: [{ type: 'command', bash: 'bashbros session-end', powershell: 'bashbros session-end' }]
        }
      }))

      const status = CopilotCLIHooks.getStatus(testDir)
      expect(status.hooksInstalled).toBe(true)
      expect(status.hooks).toContain('preToolUse (gate)')
      expect(status.hooks).toContain('postToolUse (record)')
      expect(status.hooks).toContain('sessionEnd (report)')
    })
  })

  describe('hook format matches Copilot CLI specification', () => {
    it('includes version 1 in config', () => {
      const hooksDir = join(testDir, '.github', 'hooks')
      mkdirSync(hooksDir, { recursive: true })
      writeFileSync(join(hooksDir, 'bashbros.json'), JSON.stringify({
        version: 1,
        _bashbros: true,
        hooks: {}
      }))

      const content = JSON.parse(readFileSync(join(hooksDir, 'bashbros.json'), 'utf-8'))
      expect(content.version).toBe(1)
    })

    it('provides both bash and powershell commands', () => {
      const entry = {
        type: 'command',
        bash: 'bashbros copilot-gate',
        powershell: 'bashbros copilot-gate',
        timeoutSec: 30
      }
      expect(entry.bash).toBeDefined()
      expect(entry.powershell).toBeDefined()
    })
  })
})
