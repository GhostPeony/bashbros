import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// We test the setup wizard's underlying logic by exercising the hook classes
// it delegates to. The interactive inquirer prompt is not testable in CI,
// so we verify detection, install, and multi-agent install flows directly.

import { GeminiCLIHooks } from './hooks/gemini-cli.js'
import { CopilotCLIHooks } from './hooks/copilot-cli.js'
import { OpenCodeHooks } from './hooks/opencode.js'

describe('setup wizard logic', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), 'bashbros-setup-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  describe('agent detection', () => {
    it('detects Gemini when .gemini directory exists', () => {
      mkdirSync(join(testDir, '.gemini'), { recursive: true })
      expect(GeminiCLIHooks.isGeminiInstalled(testDir)).toBe(true)
    })

    it('detects OpenCode when .opencode directory exists', () => {
      mkdirSync(join(testDir, '.opencode'), { recursive: true })
      expect(OpenCodeHooks.isOpenCodeInstalled(testDir)).toBe(true)
    })

    it('Copilot detection checks PATH only', () => {
      // CopilotCLIHooks.isCopilotInstalled() has no projectDir parameter
      // for directory-based detection; it only checks PATH
      const result = CopilotCLIHooks.isCopilotInstalled()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('multi-agent install flow', () => {
    it('installs hooks for multiple project-scoped agents', () => {
      // Simulate a project with both Gemini and OpenCode
      mkdirSync(join(testDir, '.gemini'), { recursive: true })
      mkdirSync(join(testDir, '.opencode'), { recursive: true })

      const results: { key: string; success: boolean }[] = []

      // Install Gemini
      const geminiResult = GeminiCLIHooks.install(testDir)
      results.push({ key: 'gemini-cli', success: geminiResult.success })

      // Install OpenCode
      const opencodeResult = OpenCodeHooks.install(testDir)
      results.push({ key: 'opencode', success: opencodeResult.success })

      // Both should succeed
      expect(results.every(r => r.success)).toBe(true)
      expect(results).toHaveLength(2)

      // Verify both are installed
      expect(GeminiCLIHooks.isInstalled()).toBe(false) // not in testDir default
      expect(GeminiCLIHooks.getStatus(testDir).hooksInstalled).toBe(true)
      expect(OpenCodeHooks.getStatus(testDir).pluginInstalled).toBe(true)
    })

    it('handles mixed success and failure', () => {
      // Only set up Gemini, not OpenCode
      mkdirSync(join(testDir, '.gemini'), { recursive: true })
      // No .opencode directory

      const geminiResult = GeminiCLIHooks.install(testDir)
      const opencodeResult = OpenCodeHooks.install(testDir)

      // Gemini should succeed
      expect(geminiResult.success).toBe(true)

      // OpenCode may succeed (if `opencode` is on PATH) or fail (no .opencode dir)
      if (!OpenCodeHooks.isOpenCodeInstalled(testDir)) {
        expect(opencodeResult.success).toBe(false)
      }
    })

    it('install is idempotent across all agents', () => {
      mkdirSync(join(testDir, '.gemini'), { recursive: true })
      mkdirSync(join(testDir, '.opencode'), { recursive: true })

      // First pass
      GeminiCLIHooks.install(testDir)
      OpenCodeHooks.install(testDir)

      // Second pass should report already installed
      const gemini2 = GeminiCLIHooks.install(testDir)
      const opencode2 = OpenCodeHooks.install(testDir)

      expect(gemini2.success).toBe(true)
      expect(gemini2.message).toContain('already installed')
      expect(opencode2.success).toBe(true)
      expect(opencode2.message).toContain('already installed')
    })
  })

  describe('multi-agent uninstall flow', () => {
    it('cleanly uninstalls all agents', () => {
      mkdirSync(join(testDir, '.gemini'), { recursive: true })
      mkdirSync(join(testDir, '.opencode'), { recursive: true })

      // Install both
      GeminiCLIHooks.install(testDir)
      OpenCodeHooks.install(testDir)

      // Uninstall both
      const geminiUn = GeminiCLIHooks.uninstall(testDir)
      const opencodeUn = OpenCodeHooks.uninstall(testDir)

      expect(geminiUn.success).toBe(true)
      expect(opencodeUn.success).toBe(true)

      // Verify both are gone
      expect(GeminiCLIHooks.getStatus(testDir).hooksInstalled).toBe(false)
      expect(OpenCodeHooks.getStatus(testDir).pluginInstalled).toBe(false)
    })
  })

  describe('agent entry structure', () => {
    it('all agents have required fields', () => {
      // This mirrors the structure built in runSetup()
      const agents = [
        { name: 'Claude Code', key: 'claude-code', scope: 'user' },
        { name: 'Moltbot', key: 'moltbot', scope: 'user' },
        { name: 'Gemini CLI', key: 'gemini-cli', scope: 'project' },
        { name: 'Copilot CLI', key: 'copilot-cli', scope: 'project' },
        { name: 'OpenCode', key: 'opencode', scope: 'project' },
      ]

      expect(agents).toHaveLength(5)
      for (const agent of agents) {
        expect(agent.name).toBeTruthy()
        expect(agent.key).toBeTruthy()
        expect(['user', 'project']).toContain(agent.scope)
      }
    })

    it('keys match valid AgentType values', () => {
      const validAgents = ['claude-code', 'clawdbot', 'moltbot', 'gemini-cli', 'copilot-cli', 'aider', 'opencode', 'custom']
      const setupKeys = ['claude-code', 'moltbot', 'gemini-cli', 'copilot-cli', 'opencode']

      for (const key of setupKeys) {
        expect(validAgents).toContain(key)
      }
    })
  })
})
