/**
 * Moltbot Hook Integration
 * Seamlessly integrate BashBros with Moltbot (formerly clawd.bot)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import type {
  MoltbotGatewayInfo,
  MoltbotSecurityAuditResult,
  MoltbotSecurityFinding
} from '../types.js'

export interface MoltbotSettings {
  hooks?: {
    preBash?: MoltbotHookEntry[]
    postBash?: MoltbotHookEntry[]
    sessionEnd?: MoltbotHookEntry[]
  }
  gateway?: {
    port?: number
    host?: string
    auth?: unknown
  }
  agents?: {
    defaults?: {
      sandbox?: {
        mode?: string
      }
    }
  }
  [key: string]: unknown
}

interface MoltbotHookEntry {
  command: string
  [key: string]: unknown
}

export interface MoltbotStatus {
  moltbotInstalled: boolean
  clawdbotInstalled: boolean
  hooksInstalled: boolean
  hooks: string[]
  configPath: string | null
  gatewayRunning: boolean
  sandboxMode: string | null
}

export interface MoltbotGatewayStatus {
  running: boolean
  port: number
  host: string
  sandboxMode: boolean
  error?: string
}

// Config paths to check (in order of preference)
const CONFIG_PATHS = [
  join(homedir(), '.moltbot', 'config.json'),
  join(homedir(), '.clawdbot', 'moltbot.json'),
  join(homedir(), '.config', 'moltbot', 'config.json')
]

const MOLTBOT_DIR = join(homedir(), '.moltbot')
const CLAWDBOT_DIR = join(homedir(), '.clawdbot')
const BASHBROS_HOOK_MARKER = '# bashbros-managed'
const DEFAULT_GATEWAY_PORT = 18789

export class MoltbotHooks {
  /**
   * Check if moltbot command is installed
   */
  static isMoltbotInstalled(): boolean {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(cmd, ['moltbot'], { stdio: 'pipe', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if clawdbot command is installed (legacy)
   */
  static isClawdbotInstalled(): boolean {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(cmd, ['clawdbot'], { stdio: 'pipe', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Find the config file path
   */
  static findConfigPath(): string | null {
    // Check environment variable first
    const envPath = process.env.CLAWDBOT_CONFIG_PATH
    if (envPath && existsSync(envPath)) {
      return envPath
    }

    // Check standard paths
    for (const configPath of CONFIG_PATHS) {
      if (existsSync(configPath)) {
        return configPath
      }
    }

    return null
  }

  /**
   * Get the config directory (creating if needed)
   */
  static getConfigDir(): string {
    // Prefer .moltbot if moltbot is installed, otherwise .clawdbot
    if (this.isMoltbotInstalled() || existsSync(MOLTBOT_DIR)) {
      return MOLTBOT_DIR
    }
    return CLAWDBOT_DIR
  }

  /**
   * Load current moltbot settings
   */
  static loadSettings(): MoltbotSettings {
    const configPath = this.findConfigPath()
    if (!configPath) {
      return {}
    }

    try {
      const content = readFileSync(configPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  /**
   * Save moltbot settings
   */
  static saveSettings(settings: MoltbotSettings): void {
    const configDir = this.getConfigDir()
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    const configPath = join(configDir, this.isMoltbotInstalled() ? 'config.json' : 'moltbot.json')
    writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf-8')
  }

  /**
   * Install BashBros hooks into moltbot
   */
  static install(): { success: boolean; message: string } {
    if (!this.isMoltbotInstalled() && !this.isClawdbotInstalled()) {
      return {
        success: false,
        message: 'Neither moltbot nor clawdbot found. Install moltbot first.'
      }
    }

    const settings = this.loadSettings()

    // Check if already installed
    if (this.isInstalled(settings)) {
      return {
        success: true,
        message: 'BashBros hooks already installed.'
      }
    }

    // Initialize hooks if not present
    if (!settings.hooks) {
      settings.hooks = {}
    }

    // Add preBash hook for command gating
    const preBashHook: MoltbotHookEntry = {
      command: `bashbros gate "$COMMAND" ${BASHBROS_HOOK_MARKER}`
    }

    // Add postBash hook for recording
    const postBashHook: MoltbotHookEntry = {
      command: `bashbros record "$COMMAND" ${BASHBROS_HOOK_MARKER}`
    }

    // Add sessionEnd hook for reports
    const sessionEndHook: MoltbotHookEntry = {
      command: `bashbros session-end ${BASHBROS_HOOK_MARKER}`
    }

    // Merge with existing hooks
    settings.hooks.preBash = [
      ...(settings.hooks.preBash || []),
      preBashHook
    ]

    settings.hooks.postBash = [
      ...(settings.hooks.postBash || []),
      postBashHook
    ]

    settings.hooks.sessionEnd = [
      ...(settings.hooks.sessionEnd || []),
      sessionEndHook
    ]

    this.saveSettings(settings)

    return {
      success: true,
      message: 'BashBros hooks installed successfully.'
    }
  }

  /**
   * Uninstall BashBros hooks from moltbot
   */
  static uninstall(): { success: boolean; message: string } {
    const configPath = this.findConfigPath()
    if (!configPath) {
      return {
        success: true,
        message: 'No moltbot config found. Nothing to uninstall.'
      }
    }

    const settings = this.loadSettings()

    if (!settings.hooks) {
      return {
        success: true,
        message: 'No hooks to uninstall.'
      }
    }

    // Remove BashBros hooks
    const filterHooks = (hooks: MoltbotHookEntry[] | undefined): MoltbotHookEntry[] => {
      if (!hooks) return []
      return hooks.filter(h => !h.command.includes(BASHBROS_HOOK_MARKER))
    }

    settings.hooks.preBash = filterHooks(settings.hooks.preBash)
    settings.hooks.postBash = filterHooks(settings.hooks.postBash)
    settings.hooks.sessionEnd = filterHooks(settings.hooks.sessionEnd)

    // Clean up empty arrays
    if (settings.hooks.preBash?.length === 0) delete settings.hooks.preBash
    if (settings.hooks.postBash?.length === 0) delete settings.hooks.postBash
    if (settings.hooks.sessionEnd?.length === 0) delete settings.hooks.sessionEnd
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks

    this.saveSettings(settings)

    return {
      success: true,
      message: 'BashBros hooks uninstalled successfully.'
    }
  }

  /**
   * Check if BashBros hooks are installed
   */
  static isInstalled(settings?: MoltbotSettings): boolean {
    const s = settings || this.loadSettings()

    if (!s.hooks) return false

    const hasMarker = (hooks: MoltbotHookEntry[] | undefined): boolean => {
      if (!hooks) return false
      return hooks.some(h => h.command.includes(BASHBROS_HOOK_MARKER))
    }

    return hasMarker(s.hooks.preBash) ||
           hasMarker(s.hooks.postBash) ||
           hasMarker(s.hooks.sessionEnd)
  }

  /**
   * Check if moltbot gateway is running
   */
  static async isGatewayRunning(): Promise<boolean> {
    const settings = this.loadSettings()
    const port = settings.gateway?.port || DEFAULT_GATEWAY_PORT
    const host = settings.gateway?.host || 'localhost'

    try {
      // Try to connect to the gateway
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)

      const response = await fetch(`http://${host}:${port}/health`, {
        method: 'GET',
        signal: controller.signal
      })

      clearTimeout(timeout)
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Get gateway status
   */
  static async getGatewayStatus(): Promise<MoltbotGatewayStatus> {
    const settings = this.loadSettings()
    const port = settings.gateway?.port || DEFAULT_GATEWAY_PORT
    const host = settings.gateway?.host || 'localhost'
    const sandboxMode = settings.agents?.defaults?.sandbox?.mode === 'strict'

    const running = await this.isGatewayRunning()

    return {
      running,
      port,
      host,
      sandboxMode,
      error: running ? undefined : 'Gateway not responding'
    }
  }

  /**
   * Get gateway info (for type system)
   */
  static async getGatewayInfo(): Promise<MoltbotGatewayInfo | null> {
    const status = await this.getGatewayStatus()
    if (!status.running) return null

    return {
      port: status.port,
      host: status.host,
      sandboxMode: status.sandboxMode,
      authToken: !!this.loadSettings().gateway?.auth
    }
  }

  /**
   * Run security audit using moltbot CLI
   */
  static async runSecurityAudit(): Promise<MoltbotSecurityAuditResult> {
    const findings: MoltbotSecurityFinding[] = []
    const timestamp = new Date()

    // Check if moltbot is installed
    if (!this.isMoltbotInstalled() && !this.isClawdbotInstalled()) {
      return {
        passed: false,
        findings: [{
          severity: 'critical',
          category: 'installation',
          message: 'Moltbot/clawdbot not installed',
          recommendation: 'Install moltbot to enable security auditing'
        }],
        timestamp
      }
    }

    // Try to run moltbot security audit
    try {
      const cmd = this.isMoltbotInstalled() ? 'moltbot' : 'clawdbot'
      const output = execFileSync(cmd, ['security', 'audit', '--deep', '--json'], {
        encoding: 'utf-8',
        timeout: 30000,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      // Parse moltbot audit output
      const auditResult = JSON.parse(output)

      if (auditResult.findings && Array.isArray(auditResult.findings)) {
        for (const finding of auditResult.findings) {
          findings.push({
            severity: finding.severity || 'info',
            category: finding.category || 'general',
            message: finding.message || 'Unknown finding',
            recommendation: finding.recommendation
          })
        }
      }

      return {
        passed: findings.filter(f => f.severity === 'critical').length === 0,
        findings,
        timestamp
      }
    } catch (error) {
      // moltbot security audit not available or failed
      // Fall back to basic checks
      return this.runBasicSecurityChecks()
    }
  }

  /**
   * Run basic security checks when moltbot audit is not available
   */
  private static runBasicSecurityChecks(): MoltbotSecurityAuditResult {
    const findings: MoltbotSecurityFinding[] = []
    const settings = this.loadSettings()

    // Check if hooks are installed
    if (!this.isInstalled(settings)) {
      findings.push({
        severity: 'warning',
        category: 'hooks',
        message: 'BashBros hooks not installed',
        recommendation: 'Run "bashbros moltbot install" to enable command gating'
      })
    }

    // Check sandbox mode
    const sandboxMode = settings.agents?.defaults?.sandbox?.mode
    if (!sandboxMode || sandboxMode === 'off') {
      findings.push({
        severity: 'warning',
        category: 'sandbox',
        message: 'Sandbox mode is disabled',
        recommendation: 'Enable sandbox mode in moltbot config for additional protection'
      })
    }

    // Check gateway configuration
    if (settings.gateway) {
      if (!settings.gateway.auth) {
        findings.push({
          severity: 'info',
          category: 'gateway',
          message: 'Gateway authentication not configured',
          recommendation: 'Consider enabling gateway authentication for multi-user environments'
        })
      }
    }

    return {
      passed: findings.filter(f => f.severity === 'critical').length === 0,
      findings,
      timestamp: new Date()
    }
  }

  /**
   * Get comprehensive hook status
   */
  static getStatus(): MoltbotStatus {
    const moltbotInstalled = this.isMoltbotInstalled()
    const clawdbotInstalled = this.isClawdbotInstalled()
    const configPath = this.findConfigPath()
    const settings = this.loadSettings()
    const hooksInstalled = this.isInstalled(settings)

    const hooks: string[] = []
    if (settings.hooks?.preBash) hooks.push('preBash (gate)')
    if (settings.hooks?.postBash) hooks.push('postBash (record)')
    if (settings.hooks?.sessionEnd) hooks.push('sessionEnd (report)')

    const sandboxMode = settings.agents?.defaults?.sandbox?.mode || null

    // Note: gatewayRunning is sync approximation; use getGatewayStatus() for accurate check
    let gatewayRunning = false
    // We can't do async here, but we can check if gateway config exists
    if (settings.gateway?.port) {
      gatewayRunning = true // Assume configured means intended to run
    }

    return {
      moltbotInstalled,
      clawdbotInstalled,
      hooksInstalled,
      hooks,
      configPath,
      gatewayRunning,
      sandboxMode
    }
  }
}

// Export helper for backward compatibility
export function getMoltbotHooks(): typeof MoltbotHooks {
  return MoltbotHooks
}
