/**
 * Agent Configuration Discovery
 * Discovers and reports on agent configurations for transparency
 */

import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { homedir, platform } from 'os'
import { execFileSync } from 'child_process'
import type { AgentType, AgentConfigInfo } from '../types.js'
import { ClaudeCodeHooks } from '../hooks/claude-code.js'
import { parseAgentConfig } from './config-parser.js'

// Known agent config paths
// Primary path is checked first, then fallbacks
export const AGENT_CONFIG_PATHS: Record<AgentType, string[]> = {
  'claude-code': [
    join(homedir(), '.claude', 'settings.json')
  ],
  'clawdbot': [
    join(homedir(), '.clawdbot', 'moltbot.json'),  // New primary (moltbot format)
    join(homedir(), '.clawdbot', 'config.yml'),    // Legacy
    join(homedir(), '.config', 'clawdbot', 'config.yml')
  ],
  'moltbot': [
    join(homedir(), '.moltbot', 'config.json'),
    join(homedir(), '.clawdbot', 'moltbot.json'),  // Common location
    join(homedir(), '.config', 'moltbot', 'config.json')
  ],
  'aider': [
    join(homedir(), '.aider.conf.yml'),
    join(homedir(), '.config', 'aider', 'aider.conf.yml')
  ],
  'gemini-cli': [
    join(homedir(), '.config', 'gemini-cli', 'config.json')
  ],
  'opencode': [
    join(homedir(), '.opencode', 'config.yml'),
    join(homedir(), '.config', 'opencode', 'config.yml')
  ],
  'custom': []
}

// Command names for each agent (used to check if installed)
const AGENT_COMMANDS: Record<AgentType, string> = {
  'claude-code': 'claude',
  'clawdbot': 'clawdbot',
  'moltbot': 'moltbot',
  'aider': 'aider',
  'gemini-cli': 'gemini',
  'opencode': 'opencode',
  'custom': ''
}

/**
 * Detect which naming convention is being used (moltbot vs clawdbot)
 * Returns the detected naming or null if neither is found
 */
export function detectMoltbotNaming(): 'moltbot' | 'clawdbot' | null {
  // Check environment variables first (runtime indicator)
  if (process.env.MOLTBOT_SESSION_ID || process.env.MOLTBOT_AGENT) {
    return 'moltbot'
  }
  if (process.env.CLAWDBOT_SESSION_ID || process.env.CLAWDBOT_AGENT) {
    return 'clawdbot'
  }

  // Check for moltbot command
  if (commandExists('moltbot')) {
    return 'moltbot'
  }

  // Check for clawdbot command
  if (commandExists('clawdbot')) {
    return 'clawdbot'
  }

  // Check for config files
  const moltbotPaths = AGENT_CONFIG_PATHS['moltbot']
  for (const p of moltbotPaths) {
    if (existsSync(p)) {
      return 'moltbot'
    }
  }

  const clawdbotPaths = AGENT_CONFIG_PATHS['clawdbot']
  for (const p of clawdbotPaths) {
    if (existsSync(p)) {
      return 'clawdbot'
    }
  }

  return null
}

/**
 * Check if a command exists in PATH
 */
function commandExists(cmd: string): boolean {
  if (!cmd) return false

  try {
    const whichCmd = platform() === 'win32' ? 'where' : 'which'
    execFileSync(whichCmd, [cmd], {
      stdio: 'pipe',
      timeout: 3000,
      windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

/**
 * Get version of an agent command
 */
function getAgentVersion(agent: AgentType): string | undefined {
  const cmd = AGENT_COMMANDS[agent]
  if (!cmd) return undefined

  try {
    const output = execFileSync(cmd, ['--version'], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    }).trim()

    // Extract version number
    const match = output.match(/(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/i)
    return match ? match[1] : output.split('\n')[0].slice(0, 50)
  } catch {
    return undefined
  }
}

/**
 * Find the config path for an agent
 */
function findAgentConfigPath(agent: AgentType): string | undefined {
  const paths = AGENT_CONFIG_PATHS[agent]

  for (const configPath of paths) {
    if (existsSync(configPath)) {
      return configPath
    }
  }

  return undefined
}

/**
 * Get last modified date of a file
 */
function getLastModified(filePath: string): Date | undefined {
  try {
    const stats = statSync(filePath)
    return stats.mtime
  } catch {
    return undefined
  }
}

/**
 * Check if BashBros is integrated with an agent
 */
async function isBashbrosIntegrated(agent: AgentType): Promise<boolean> {
  if (agent === 'claude-code') {
    const status = ClaudeCodeHooks.getStatus()
    return status.hooksInstalled
  }

  if (agent === 'moltbot' || agent === 'clawdbot') {
    try {
      const { MoltbotHooks } = await import('../hooks/moltbot.js')
      return MoltbotHooks.isInstalled()
    } catch {
      return false
    }
  }

  // For other agents, check if they have bashbros hooks configured
  // This would need to be extended as more integrations are built
  return false
}

/**
 * Get configuration info for a specific agent
 */
export async function getAgentConfigInfo(agent: AgentType): Promise<AgentConfigInfo> {
  const cmd = AGENT_COMMANDS[agent]
  const installed = cmd ? commandExists(cmd) : false
  const configPath = findAgentConfigPath(agent)
  const configExists = configPath ? existsSync(configPath) : false

  const info: AgentConfigInfo = {
    agent,
    installed,
    configPath,
    configExists,
    bashbrosIntegrated: await isBashbrosIntegrated(agent)
  }

  if (installed) {
    info.version = getAgentVersion(agent)
  }

  if (configExists && configPath) {
    info.lastModified = getLastModified(configPath)

    // Parse config for permissions and hooks
    const parsed = await parseAgentConfig(agent, configPath)
    if (parsed) {
      info.permissions = parsed.permissions
      info.hooks = parsed.hooks
    }
  }

  return info
}

/**
 * Get configuration info for all known agents
 */
export async function getAllAgentConfigs(): Promise<AgentConfigInfo[]> {
  const agents: AgentType[] = ['claude-code', 'moltbot', 'clawdbot', 'aider', 'gemini-cli', 'opencode']
  const results: AgentConfigInfo[] = []

  for (const agent of agents) {
    const info = await getAgentConfigInfo(agent)
    results.push(info)
  }

  return results
}

/**
 * Get only installed agents
 */
export async function getInstalledAgents(): Promise<AgentConfigInfo[]> {
  const all = await getAllAgentConfigs()
  return all.filter(info => info.installed)
}

/**
 * Get agents with configurations
 */
export async function getConfiguredAgents(): Promise<AgentConfigInfo[]> {
  const all = await getAllAgentConfigs()
  return all.filter(info => info.configExists)
}
