/**
 * Sync BashBros policies to Moltbot exec-approvals
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface SyncOptions {
  /** Path to bashbros config (default: .bashbros.yml or ~/.bashbros/config.yml) */
  bashbrosConfig?: string
  /** Path to moltbot config directory (default: ~/.clawdbot) */
  moltbotDir?: string
  /** Agent name to sync to (default: 'main') */
  agent?: string
  /** Dry run - show what would change without writing */
  dryRun?: boolean
  /** Merge with existing allowlist (default: true) */
  merge?: boolean
}

export interface SyncResult {
  success: boolean
  message: string
  added: string[]
  removed: string[]
  unchanged: string[]
  approvalsPath: string
}

export interface ExecApprovals {
  version: number
  socket?: string
  defaults?: Record<string, unknown>
  agents?: Record<string, AgentApprovals>
}

interface AgentApprovals {
  allowlist?: string[]
  [key: string]: unknown
}

const DEFAULT_MOLTBOT_DIR = join(homedir(), '.clawdbot')
const EXEC_APPROVALS_FILE = 'exec-approvals.json'

/**
 * Main sync class for BashBros → Moltbot policy sync
 */
export class MoltbotSync {
  private moltbotDir: string
  private agent: string

  constructor(options: SyncOptions = {}) {
    this.moltbotDir = options.moltbotDir || DEFAULT_MOLTBOT_DIR
    this.agent = options.agent || 'main'
  }

  /**
   * Get path to exec-approvals.json
   */
  getApprovalsPath(): string {
    return join(this.moltbotDir, EXEC_APPROVALS_FILE)
  }

  /**
   * Load current exec-approvals
   */
  loadApprovals(): ExecApprovals {
    const approvalsPath = this.getApprovalsPath()

    if (!existsSync(approvalsPath)) {
      return { version: 1, agents: {} }
    }

    try {
      const content = readFileSync(approvalsPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return { version: 1, agents: {} }
    }
  }

  /**
   * Save exec-approvals
   */
  saveApprovals(approvals: ExecApprovals): void {
    const approvalsPath = this.getApprovalsPath()

    // Ensure directory exists
    if (!existsSync(this.moltbotDir)) {
      mkdirSync(this.moltbotDir, { recursive: true })
    }

    writeFileSync(approvalsPath, JSON.stringify(approvals, null, 2), 'utf-8')
  }

  /**
   * Get current allowlist for agent
   */
  getAllowlist(): string[] {
    const approvals = this.loadApprovals()
    return approvals.agents?.[this.agent]?.allowlist || []
  }

  /**
   * Convert bashbros allow patterns to moltbot glob patterns
   */
  convertPatterns(bashbrosPatterns: string[]): string[] {
    return bashbrosPatterns.map(pattern => {
      // Convert bashbros patterns to moltbot glob format
      // bashbros: "git *" → moltbot: "git *" or "/usr/bin/git"
      // bashbros: "npm *" → moltbot: "npm *"

      // If it's already a path, keep it
      if (pattern.startsWith('/') || pattern.startsWith('~') || pattern.includes('\\')) {
        return pattern
      }

      // If it's a command pattern, keep as-is (moltbot supports globs)
      return pattern
    })
  }

  /**
   * Load bashbros config and extract allow patterns
   */
  loadBashbrosAllowPatterns(configPath?: string): string[] {
    // Try to dynamically import bashbros
    try {
      // Look for .bashbros.yml in current directory or home
      const possiblePaths = [
        configPath,
        join(process.cwd(), '.bashbros.yml'),
        join(process.cwd(), '.bashbros.yaml'),
        join(homedir(), '.bashbros', 'config.yml'),
        join(homedir(), '.bashbros', 'config.yaml'),
      ].filter(Boolean) as string[]

      for (const p of possiblePaths) {
        if (existsSync(p)) {
          const content = readFileSync(p, 'utf-8')
          // Simple YAML parsing for commands.allow
          const match = content.match(/commands:\s*\n\s*allow:\s*\[(.*?)\]/s)
          if (match) {
            // Parse array format: [git *, npm *, node *]
            const items = match[1].split(',').map(s => s.trim().replace(/['"]/g, ''))
            return items.filter(Boolean)
          }

          // Try multi-line format
          const multiLineMatch = content.match(/commands:\s*\n\s*allow:\s*\n((?:\s*-\s*.+\n?)+)/)
          if (multiLineMatch) {
            const lines = multiLineMatch[1].split('\n')
            return lines
              .map(l => l.replace(/^\s*-\s*/, '').trim().replace(/['"]/g, ''))
              .filter(Boolean)
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return []
  }

  /**
   * Sync bashbros policies to moltbot
   */
  sync(options: SyncOptions = {}): SyncResult {
    const approvalsPath = this.getApprovalsPath()
    const currentAllowlist = this.getAllowlist()
    const bashbrosPatterns = this.loadBashbrosAllowPatterns(options.bashbrosConfig)
    const moltbotPatterns = this.convertPatterns(bashbrosPatterns)

    // Calculate changes
    const currentSet = new Set(currentAllowlist)
    const newSet = new Set(moltbotPatterns)

    const added: string[] = []
    const removed: string[] = []
    const unchanged: string[] = []

    // Find what to add
    for (const pattern of moltbotPatterns) {
      if (currentSet.has(pattern)) {
        unchanged.push(pattern)
      } else {
        added.push(pattern)
      }
    }

    // Find what would be removed (if not merging)
    if (!options.merge) {
      for (const pattern of currentAllowlist) {
        if (!newSet.has(pattern)) {
          removed.push(pattern)
        }
      }
    }

    // Build new allowlist
    let newAllowlist: string[]
    if (options.merge !== false) {
      // Merge: keep existing + add new
      newAllowlist = [...new Set([...currentAllowlist, ...moltbotPatterns])]
    } else {
      // Replace: use only bashbros patterns
      newAllowlist = moltbotPatterns
    }

    // Sort for consistency
    newAllowlist.sort()

    if (options.dryRun) {
      return {
        success: true,
        message: `Dry run: would sync ${added.length} patterns to moltbot`,
        added,
        removed,
        unchanged,
        approvalsPath
      }
    }

    // Write changes
    const approvals = this.loadApprovals()
    if (!approvals.agents) {
      approvals.agents = {}
    }
    if (!approvals.agents[this.agent]) {
      approvals.agents[this.agent] = {}
    }
    approvals.agents[this.agent].allowlist = newAllowlist

    this.saveApprovals(approvals)

    return {
      success: true,
      message: `Synced ${added.length} new patterns to moltbot (${unchanged.length} unchanged)`,
      added,
      removed,
      unchanged,
      approvalsPath
    }
  }

  /**
   * Add a single pattern to the allowlist
   */
  addPattern(pattern: string): SyncResult {
    const currentAllowlist = this.getAllowlist()

    if (currentAllowlist.includes(pattern)) {
      return {
        success: true,
        message: `Pattern already in allowlist: ${pattern}`,
        added: [],
        removed: [],
        unchanged: [pattern],
        approvalsPath: this.getApprovalsPath()
      }
    }

    const approvals = this.loadApprovals()
    if (!approvals.agents) approvals.agents = {}
    if (!approvals.agents[this.agent]) approvals.agents[this.agent] = {}

    const newAllowlist = [...currentAllowlist, pattern].sort()
    approvals.agents[this.agent].allowlist = newAllowlist

    this.saveApprovals(approvals)

    return {
      success: true,
      message: `Added pattern: ${pattern}`,
      added: [pattern],
      removed: [],
      unchanged: currentAllowlist,
      approvalsPath: this.getApprovalsPath()
    }
  }

  /**
   * Remove a pattern from the allowlist
   */
  removePattern(pattern: string): SyncResult {
    const currentAllowlist = this.getAllowlist()

    if (!currentAllowlist.includes(pattern)) {
      return {
        success: true,
        message: `Pattern not in allowlist: ${pattern}`,
        added: [],
        removed: [],
        unchanged: currentAllowlist,
        approvalsPath: this.getApprovalsPath()
      }
    }

    const approvals = this.loadApprovals()
    const newAllowlist = currentAllowlist.filter(p => p !== pattern)

    if (approvals.agents?.[this.agent]) {
      approvals.agents[this.agent].allowlist = newAllowlist
    }

    this.saveApprovals(approvals)

    return {
      success: true,
      message: `Removed pattern: ${pattern}`,
      added: [],
      removed: [pattern],
      unchanged: newAllowlist,
      approvalsPath: this.getApprovalsPath()
    }
  }

  /**
   * Clear all bashbros-synced patterns
   */
  clear(): SyncResult {
    const currentAllowlist = this.getAllowlist()
    const approvals = this.loadApprovals()

    if (approvals.agents?.[this.agent]) {
      approvals.agents[this.agent].allowlist = []
    }

    this.saveApprovals(approvals)

    return {
      success: true,
      message: `Cleared ${currentAllowlist.length} patterns from allowlist`,
      added: [],
      removed: currentAllowlist,
      unchanged: [],
      approvalsPath: this.getApprovalsPath()
    }
  }
}

/**
 * Convenience function to sync policies
 */
export function syncPolicies(options: SyncOptions = {}): SyncResult {
  const sync = new MoltbotSync(options)
  return sync.sync(options)
}

/**
 * Get current sync status
 */
export function getSyncStatus(options: Pick<SyncOptions, 'moltbotDir' | 'agent'> = {}): {
  moltbotDir: string
  approvalsPath: string
  approvalsExist: boolean
  allowlistCount: number
  allowlist: string[]
} {
  const sync = new MoltbotSync(options)
  const approvalsPath = sync.getApprovalsPath()
  const allowlist = sync.getAllowlist()

  return {
    moltbotDir: options.moltbotDir || DEFAULT_MOLTBOT_DIR,
    approvalsPath,
    approvalsExist: existsSync(approvalsPath),
    allowlistCount: allowlist.length,
    allowlist
  }
}
