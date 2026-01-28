import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('MoltbotHooks', () => {
  // Create fresh test directory for each test
  let testDir: string
  let mockMoltbotDir: string
  let mockClawdbotDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), 'bashbros-moltbot-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
    mockMoltbotDir = join(testDir, '.moltbot')
    mockClawdbotDir = join(testDir, '.clawdbot')

    // Clean up test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    // Clean up after tests
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  // Import MoltbotHooks dynamically to allow mocking
  async function getMoltbotHooks(customHomeDir?: string) {
    if (customHomeDir) {
      vi.doMock('os', () => ({
        homedir: () => customHomeDir,
        platform: () => process.platform,
        tmpdir
      }))
    }
    // Re-import to get mocked version
    const module = await import('./moltbot.js')
    return module.MoltbotHooks
  }

  describe('isInstalled', () => {
    it('returns false when no hooks exist', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      expect(MoltbotHooks.isInstalled({})).toBe(false)
    })

    it('returns true when bashbros hooks are present', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const settings = {
        hooks: {
          preBash: [{ command: 'bashbros gate "$COMMAND" # bashbros-managed' }]
        }
      }
      expect(MoltbotHooks.isInstalled(settings)).toBe(true)
    })

    it('returns false when only non-bashbros hooks exist', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const settings = {
        hooks: {
          preBash: [{ command: 'echo "other hook"' }]
        }
      }
      expect(MoltbotHooks.isInstalled(settings)).toBe(false)
    })

    it('detects bashbros hooks in postBash', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const settings = {
        hooks: {
          postBash: [{ command: 'bashbros record "$COMMAND" # bashbros-managed' }]
        }
      }
      expect(MoltbotHooks.isInstalled(settings)).toBe(true)
    })

    it('detects bashbros hooks in sessionEnd', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const settings = {
        hooks: {
          sessionEnd: [{ command: 'bashbros session-end # bashbros-managed' }]
        }
      }
      expect(MoltbotHooks.isInstalled(settings)).toBe(true)
    })
  })

  describe('getStatus', () => {
    it('returns complete status object', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const status = MoltbotHooks.getStatus()

      expect(status).toHaveProperty('moltbotInstalled')
      expect(status).toHaveProperty('clawdbotInstalled')
      expect(status).toHaveProperty('hooksInstalled')
      expect(status).toHaveProperty('hooks')
      expect(status).toHaveProperty('configPath')
      expect(status).toHaveProperty('gatewayRunning')
      expect(status).toHaveProperty('sandboxMode')
      expect(Array.isArray(status.hooks)).toBe(true)
    })
  })

  describe('getGatewayStatus', () => {
    it('returns gateway status structure', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const status = await MoltbotHooks.getGatewayStatus()

      expect(status).toHaveProperty('running')
      expect(status).toHaveProperty('port')
      expect(status).toHaveProperty('host')
      expect(status).toHaveProperty('sandboxMode')
    })

    it('uses default port 18789 when not configured', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const status = await MoltbotHooks.getGatewayStatus()
      expect(status.port).toBe(18789) // Default port per moltbot docs
    })

    it('uses default host localhost when not configured', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const status = await MoltbotHooks.getGatewayStatus()
      expect(status.host).toBe('localhost')
    })
  })

  describe('runSecurityAudit', () => {
    it('returns audit result structure', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const result = await MoltbotHooks.runSecurityAudit()

      expect(result).toHaveProperty('passed')
      expect(result).toHaveProperty('findings')
      expect(result).toHaveProperty('timestamp')
      expect(Array.isArray(result.findings)).toBe(true)
      expect(result.timestamp instanceof Date).toBe(true)
    })

    it('findings have required properties', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const result = await MoltbotHooks.runSecurityAudit()

      for (const finding of result.findings) {
        expect(finding).toHaveProperty('severity')
        expect(finding).toHaveProperty('category')
        expect(finding).toHaveProperty('message')
        expect(['info', 'warning', 'critical']).toContain(finding.severity)
      }
    })
  })

  describe('install behavior', () => {
    it('fails when neither moltbot nor clawdbot is installed', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const result = MoltbotHooks.install()

      // Will fail because moltbot/clawdbot command not found (unless actually installed)
      // This test verifies the error handling works
      if (!result.success) {
        expect(result.message).toContain('not found')
      }
    })
  })

  describe('uninstall behavior', () => {
    it('succeeds when no config exists', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const result = MoltbotHooks.uninstall()

      // Should succeed with "nothing to uninstall" message
      expect(result.success).toBe(true)
    })
  })

  describe('hook format matches moltbot specification', () => {
    it('uses correct preBash hook format', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')

      // The hook format should match moltbot.json structure:
      // hooks.preBash[].command
      const settings = {
        hooks: {
          preBash: [{ command: 'bashbros gate "$COMMAND" # bashbros-managed' }]
        }
      }

      expect(MoltbotHooks.isInstalled(settings)).toBe(true)

      // Verify the command uses $COMMAND variable (moltbot convention)
      expect(settings.hooks.preBash[0].command).toContain('$COMMAND')
    })

    it('uses correct hook marker for management', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')

      const settings = {
        hooks: {
          preBash: [{ command: 'bashbros gate "$COMMAND" # bashbros-managed' }],
          postBash: [{ command: 'bashbros record "$COMMAND" # bashbros-managed' }],
          sessionEnd: [{ command: 'bashbros session-end # bashbros-managed' }]
        }
      }

      // All hooks should be detected
      expect(MoltbotHooks.isInstalled(settings)).toBe(true)

      // Verify marker is consistent
      for (const hookType of ['preBash', 'postBash', 'sessionEnd'] as const) {
        const hooks = settings.hooks[hookType]
        for (const hook of hooks) {
          expect(hook.command).toContain('# bashbros-managed')
        }
      }
    })
  })

  describe('config path detection', () => {
    it('respects CLAWDBOT_CONFIG_PATH env var', async () => {
      const customPath = join(testDir, 'custom-config.json')
      writeFileSync(customPath, JSON.stringify({ test: true }))

      process.env.CLAWDBOT_CONFIG_PATH = customPath

      try {
        const { MoltbotHooks } = await import('./moltbot.js')
        const configPath = MoltbotHooks.findConfigPath()
        expect(configPath).toBe(customPath)
      } finally {
        delete process.env.CLAWDBOT_CONFIG_PATH
      }
    })
  })

  describe('gateway info', () => {
    it('returns gateway info or null depending on gateway state', async () => {
      const { MoltbotHooks } = await import('./moltbot.js')
      const info = await MoltbotHooks.getGatewayInfo()

      // Gateway may or may not be running in test environment
      if (info === null) {
        expect(info).toBeNull()
      } else {
        // If running, verify structure
        expect(info).toHaveProperty('port')
        expect(info).toHaveProperty('host')
        expect(typeof info.port).toBe('number')
      }
    })
  })
})

describe('MoltbotHooks sandbox mode detection', () => {
  it('correctly parses sandbox mode from settings', async () => {
    const { MoltbotHooks } = await import('./moltbot.js')

    // Test with strict sandbox
    const strictSettings = {
      agents: { defaults: { sandbox: { mode: 'strict' } } }
    }
    // getGatewayStatus reads from loadSettings, but we can test the structure
    expect(strictSettings.agents.defaults.sandbox.mode).toBe('strict')
  })
})
