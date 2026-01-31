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
    SessionStart?: HookConfig[]
    UserPromptSubmit?: HookConfig[]
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
// Use --marker flag for Windows compatibility (ignored by the command but lets us identify our hooks)
const BASHBROS_ALL_TOOLS_MARKER = '--marker=bashbros-all-tools'
const BASHBROS_PROMPT_MARKER = '--marker=bashbros-prompt'

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

    // Add SessionStart hook for session initialization
    const sessionStartHook: HookConfig = {
      hooks: [{
        type: 'command',
        command: `bashbros session-start ${BASHBROS_HOOK_MARKER}`
      }]
    }

    settings.hooks.SessionStart = [
      ...(settings.hooks.SessionStart || []),
      sessionStartHook
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
    settings.hooks.SessionStart = filterHooks(settings.hooks.SessionStart)

    // Also remove prompt hooks
    if (settings.hooks.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(h =>
        !h.hooks.some(hook => hook.command.includes(BASHBROS_PROMPT_MARKER))
      )
    }

    // Clean up empty arrays
    if (settings.hooks.PreToolUse?.length === 0) delete settings.hooks.PreToolUse
    if (settings.hooks.PostToolUse?.length === 0) delete settings.hooks.PostToolUse
    if (settings.hooks.SessionEnd?.length === 0) delete settings.hooks.SessionEnd
    if (settings.hooks.SessionStart?.length === 0) delete settings.hooks.SessionStart
    if (settings.hooks.UserPromptSubmit?.length === 0) delete settings.hooks.UserPromptSubmit
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
           hasMarker(s.hooks.SessionEnd) ||
           hasMarker(s.hooks.SessionStart)
  }

  /**
   * Get hook status
   */
  static getStatus(): {
    claudeInstalled: boolean
    hooksInstalled: boolean
    allToolsInstalled: boolean
    promptHookInstalled: boolean
    hooks: string[]
  } {
    const claudeInstalled = this.isClaudeInstalled()
    const settings = claudeInstalled ? this.loadSettings() : {}
    const hooksInstalled = this.isInstalled(settings)
    const allToolsInstalled = this.isAllToolsInstalled(settings)
    const promptHookInstalled = this.isPromptHookInstalled(settings)

    const hooks: string[] = []
    if (settings.hooks?.PreToolUse) hooks.push('PreToolUse (gate)')
    if (settings.hooks?.PostToolUse) hooks.push('PostToolUse (record)')
    if (settings.hooks?.SessionEnd) hooks.push('SessionEnd (report)')
    if (settings.hooks?.SessionStart) hooks.push('SessionStart (session-start)')
    if (allToolsInstalled) hooks.push('PostToolUse (all-tools)')
    if (promptHookInstalled) hooks.push('UserPromptSubmit (prompt)')

    return {
      claudeInstalled,
      hooksInstalled,
      allToolsInstalled,
      promptHookInstalled,
      hooks
    }
  }

  /**
   * Check if all-tools recording is installed
   */
  static isAllToolsInstalled(settings?: ClaudeSettings): boolean {
    const s = settings || this.loadSettings()

    if (!s.hooks?.PostToolUse) return false

    // Check for both old (# bashbros-all-tools) and new (--marker=bashbros-all-tools) formats
    return s.hooks.PostToolUse.some(h =>
      h.hooks.some(hook =>
        hook.command.includes(BASHBROS_ALL_TOOLS_MARKER) ||
        hook.command.includes('bashbros-all-tools')
      )
    )
  }

  /**
   * Install all-tools recording hook (records ALL Claude Code tools, not just Bash)
   */
  static installAllTools(): { success: boolean; message: string } {
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
    if (this.isAllToolsInstalled(settings)) {
      return {
        success: true,
        message: 'BashBros all-tools recording already installed.'
      }
    }

    // Add PostToolUse hook for ALL tools (empty matcher = all tools)
    const allToolsHook: HookConfig = {
      matcher: '',  // Empty matcher matches ALL tools
      hooks: [{
        type: 'command',
        command: `bashbros record-tool ${BASHBROS_ALL_TOOLS_MARKER}`
      }]
    }

    // Add to beginning of PostToolUse hooks so it runs for all tools
    settings.hooks.PostToolUse = [
      allToolsHook,
      ...(settings.hooks.PostToolUse || [])
    ]

    this.saveSettings(settings)

    return {
      success: true,
      message: 'BashBros all-tools recording installed. All Claude Code tools will now be recorded.'
    }
  }

  /**
   * Uninstall all-tools recording hook
   */
  static uninstallAllTools(): { success: boolean; message: string } {
    if (!this.isClaudeInstalled()) {
      return {
        success: false,
        message: 'Claude Code not found.'
      }
    }

    const settings = this.loadSettings()

    if (!settings.hooks?.PostToolUse) {
      return {
        success: true,
        message: 'No all-tools hook to uninstall.'
      }
    }

    // Remove all-tools hook (both old and new marker formats)
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(h =>
      !h.hooks.some(hook =>
        hook.command.includes(BASHBROS_ALL_TOOLS_MARKER) ||
        hook.command.includes('bashbros-all-tools')
      )
    )

    // Clean up empty array
    if (settings.hooks.PostToolUse.length === 0) {
      delete settings.hooks.PostToolUse
    }
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }

    this.saveSettings(settings)

    return {
      success: true,
      message: 'BashBros all-tools recording uninstalled.'
    }
  }
  /**
   * Check if prompt recording hook is installed
   */
  static isPromptHookInstalled(settings?: ClaudeSettings): boolean {
    const s = settings || this.loadSettings()

    if (!s.hooks?.UserPromptSubmit) return false

    return s.hooks.UserPromptSubmit.some(h =>
      h.hooks.some(hook => hook.command.includes(BASHBROS_PROMPT_MARKER))
    )
  }

  /**
   * Install prompt recording hook (records user prompt submissions)
   */
  static installPromptHook(): { success: boolean; message: string } {
    if (!this.isClaudeInstalled()) {
      return {
        success: false,
        message: 'Claude Code not found. Install Claude Code first.'
      }
    }

    const settings = this.loadSettings()

    if (!settings.hooks) {
      settings.hooks = {}
    }

    if (this.isPromptHookInstalled(settings)) {
      return {
        success: true,
        message: 'BashBros prompt recording already installed.'
      }
    }

    const promptHook: HookConfig = {
      hooks: [{
        type: 'command',
        command: `bashbros record-prompt ${BASHBROS_PROMPT_MARKER}`
      }]
    }

    settings.hooks.UserPromptSubmit = [
      ...(settings.hooks.UserPromptSubmit || []),
      promptHook
    ]

    this.saveSettings(settings)

    return {
      success: true,
      message: 'BashBros prompt recording installed. User prompts will now be recorded.'
    }
  }

  /**
   * Uninstall prompt recording hook
   */
  static uninstallPromptHook(): { success: boolean; message: string } {
    if (!this.isClaudeInstalled()) {
      return {
        success: false,
        message: 'Claude Code not found.'
      }
    }

    const settings = this.loadSettings()

    if (!settings.hooks?.UserPromptSubmit) {
      return {
        success: true,
        message: 'No prompt hook to uninstall.'
      }
    }

    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(h =>
      !h.hooks.some(hook => hook.command.includes(BASHBROS_PROMPT_MARKER))
    )

    if (settings.hooks.UserPromptSubmit.length === 0) {
      delete settings.hooks.UserPromptSubmit
    }
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks
    }

    this.saveSettings(settings)

    return {
      success: true,
      message: 'BashBros prompt recording uninstalled.'
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

  // Config-driven risk threshold checks
  if (config.riskScoring.enabled) {
    if (risk.score >= config.riskScoring.blockThreshold) {
      return {
        allowed: false,
        reason: `Risk score ${risk.score} >= block threshold ${config.riskScoring.blockThreshold}: ${risk.factors.join(', ')}`,
        riskScore: risk.score
      }
    }
    if (risk.score >= config.riskScoring.warnThreshold) {
      process.stderr.write(`[BashBros] Warning: risk score ${risk.score} (${risk.factors.join(', ')})\n`)
    }
  }

  // DB-backed cross-process checks (fail-open: DB errors never block commands)
  try {
    const { join } = await import('path')
    const { homedir } = await import('os')
    const { DashboardDB } = await import('../dashboard/db.js')
    const { checkLoopDetection, checkAnomalyDetection, checkRateLimit } = await import('../policy/db-checks.js')

    const dbPath = join(homedir(), '.bashbros', 'dashboard.db')
    const db = new DashboardDB(dbPath)
    try {
      // Loop detection
      if (config.loopDetection.enabled) {
        const loop = checkLoopDetection(command, config.loopDetection, db)
        if (loop.violation) {
          db.close()
          return { allowed: false, reason: loop.violation.message, riskScore: risk.score }
        }
        if (loop.warning) {
          process.stderr.write(`[BashBros] ${loop.warning}\n`)
        }
      }

      // Anomaly detection
      if (config.anomalyDetection.enabled) {
        const anomaly = checkAnomalyDetection(command, config.anomalyDetection, db)
        if (anomaly.violation) {
          db.close()
          return { allowed: false, reason: anomaly.violation.message, riskScore: risk.score }
        }
        if (anomaly.warning) {
          process.stderr.write(`[BashBros] ${anomaly.warning}\n`)
        }
      }

      // Rate limiting
      if (config.rateLimit.enabled) {
        const rate = checkRateLimit(config.rateLimit, db)
        if (rate.violation) {
          db.close()
          return { allowed: false, reason: rate.violation.message, riskScore: risk.score }
        }
      }
    } finally {
      db.close()
    }
  } catch {
    // Fail-open: DB errors never block commands
  }

  return {
    allowed: true,
    riskScore: risk.score
  }
}
