/**
 * Claude Code Hook Integration
 * Seamlessly integrate BashBros with Claude Code
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookConfig[]
    PostToolUse?: HookConfig[]
    SessionEnd?: HookConfig[]
  }
  [key: string]: unknown
}

interface HookConfig {
  matcher?: string
  hooks: { type: string; command: string }[]
}

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json')
const CLAUDE_DIR = join(homedir(), '.claude')

const BASHBROS_HOOK_MARKER = '# bashbros-managed'

export class ClaudeCodeHooks {
  /**
   * Check if Claude Code is installed
   */
  static isClaudeInstalled(): boolean {
    return existsSync(CLAUDE_DIR)
  }

  /**
   * Load current Claude settings
   */
  static loadSettings(): ClaudeSettings {
    if (!existsSync(CLAUDE_SETTINGS_PATH)) {
      return {}
    }

    try {
      const content = readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  /**
   * Save Claude settings
   */
  static saveSettings(settings: ClaudeSettings): void {
    if (!existsSync(CLAUDE_DIR)) {
      mkdirSync(CLAUDE_DIR, { recursive: true })
    }

    writeFileSync(
      CLAUDE_SETTINGS_PATH,
      JSON.stringify(settings, null, 2),
      'utf-8'
    )
  }

  /**
   * Install BashBros hooks into Claude Code
   */
  static install(): { success: boolean; message: string } {
    if (!this.isClaudeInstalled()) {
      return {
        success: false,
        message: 'Claude Code not found. Install Claude Code first.'
      }
    }

    const settings = this.loadSettings()

    // Initialize hooks if not present
    if (!settings.hooks) {
      settings.hooks = {}
    }

    // Check if already installed
    if (this.isInstalled(settings)) {
      return {
        success: true,
        message: 'BashBros hooks already installed.'
      }
    }

    // Add PreToolUse hook for Bash commands
    const preToolUseHook: HookConfig = {
      matcher: 'Bash',
      hooks: [{
        type: 'command',
        command: `bashbros gate "$TOOL_INPUT" ${BASHBROS_HOOK_MARKER}`
      }]
    }

    // Add PostToolUse hook for metrics
    const postToolUseHook: HookConfig = {
      matcher: 'Bash',
      hooks: [{
        type: 'command',
        command: `bashbros record "$TOOL_INPUT" "$TOOL_OUTPUT" ${BASHBROS_HOOK_MARKER}`
      }]
    }

    // Add SessionEnd hook for reports
    const sessionEndHook: HookConfig = {
      hooks: [{
        type: 'command',
        command: `bashbros session-end ${BASHBROS_HOOK_MARKER}`
      }]
    }

    // Merge with existing hooks
    settings.hooks.PreToolUse = [
      ...(settings.hooks.PreToolUse || []),
      preToolUseHook
    ]

    settings.hooks.PostToolUse = [
      ...(settings.hooks.PostToolUse || []),
      postToolUseHook
    ]

    settings.hooks.SessionEnd = [
      ...(settings.hooks.SessionEnd || []),
      sessionEndHook
    ]

    this.saveSettings(settings)

    return {
      success: true,
      message: 'BashBros hooks installed successfully.'
    }
  }

  /**
   * Uninstall BashBros hooks from Claude Code
   */
  static uninstall(): { success: boolean; message: string } {
    if (!this.isClaudeInstalled()) {
      return {
        success: false,
        message: 'Claude Code not found.'
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
    const filterHooks = (hooks: HookConfig[] | undefined): HookConfig[] => {
      if (!hooks) return []
      return hooks.filter(h =>
        !h.hooks.some(hook => hook.command.includes(BASHBROS_HOOK_MARKER))
      )
    }

    settings.hooks.PreToolUse = filterHooks(settings.hooks.PreToolUse)
    settings.hooks.PostToolUse = filterHooks(settings.hooks.PostToolUse)
    settings.hooks.SessionEnd = filterHooks(settings.hooks.SessionEnd)

    // Clean up empty arrays
    if (settings.hooks.PreToolUse?.length === 0) delete settings.hooks.PreToolUse
    if (settings.hooks.PostToolUse?.length === 0) delete settings.hooks.PostToolUse
    if (settings.hooks.SessionEnd?.length === 0) delete settings.hooks.SessionEnd
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
  static isInstalled(settings?: ClaudeSettings): boolean {
    const s = settings || this.loadSettings()

    if (!s.hooks) return false

    const hasMarker = (hooks: HookConfig[] | undefined): boolean => {
      if (!hooks) return false
      return hooks.some(h =>
        h.hooks.some(hook => hook.command.includes(BASHBROS_HOOK_MARKER))
      )
    }

    return hasMarker(s.hooks.PreToolUse) ||
           hasMarker(s.hooks.PostToolUse) ||
           hasMarker(s.hooks.SessionEnd)
  }

  /**
   * Get hook status
   */
  static getStatus(): {
    claudeInstalled: boolean
    hooksInstalled: boolean
    hooks: string[]
  } {
    const claudeInstalled = this.isClaudeInstalled()
    const settings = claudeInstalled ? this.loadSettings() : {}
    const hooksInstalled = this.isInstalled(settings)

    const hooks: string[] = []
    if (settings.hooks?.PreToolUse) hooks.push('PreToolUse (gate)')
    if (settings.hooks?.PostToolUse) hooks.push('PostToolUse (record)')
    if (settings.hooks?.SessionEnd) hooks.push('SessionEnd (report)')

    return {
      claudeInstalled,
      hooksInstalled,
      hooks
    }
  }
}

/**
 * Gate command - called by PreToolUse hook
 * Returns exit code 0 to allow, non-zero to block
 */
export async function gateCommand(command: string): Promise<{
  allowed: boolean
  reason?: string
  riskScore?: number
}> {
  // Dynamic import to avoid circular deps
  const { PolicyEngine } = await import('../policy/engine.js')
  const { RiskScorer } = await import('../policy/risk-scorer.js')
  const { loadConfig } = await import('../config.js')

  const config = loadConfig()
  const engine = new PolicyEngine(config)
  const scorer = new RiskScorer()

  const violations = engine.validate(command)
  const risk = scorer.score(command)

  if (violations.length > 0) {
    return {
      allowed: false,
      reason: violations[0].message,
      riskScore: risk.score
    }
  }

  // Block critical risk commands
  if (risk.level === 'critical') {
    return {
      allowed: false,
      reason: `Critical risk: ${risk.factors.join(', ')}`,
      riskScore: risk.score
    }
  }

  return {
    allowed: true,
    riskScore: risk.score
  }
}
