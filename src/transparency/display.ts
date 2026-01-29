/**
 * Display utilities for agent transparency
 * Formats agent info and permissions for CLI output
 */

import chalk from 'chalk'
import type { AgentConfigInfo, EffectivePermissions, AgentType } from '../types.js'
import { loadConfig } from '../config.js'

// Human-readable agent names
const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  'moltbot': 'Moltbot',
  'clawdbot': 'Clawdbot (legacy)',
  'aider': 'Aider',
  'gemini-cli': 'Gemini CLI',
  'copilot-cli': 'Copilot CLI',
  'opencode': 'OpenCode',
  'custom': 'Custom Agent'
}

/**
 * Format a single agent's info for display
 */
export function formatAgentInfo(info: AgentConfigInfo): string {
  const lines: string[] = []
  const name = AGENT_DISPLAY_NAMES[info.agent] || info.agent

  lines.push(chalk.bold(`${name} (${info.agent})`))

  // Status
  const statusIcon = info.installed ? chalk.green('Installed') : chalk.dim('Not found')
  lines.push(`  Status:     ${statusIcon}`)

  if (info.version) {
    lines.push(`  Version:    ${info.version}`)
  }

  // Config
  if (info.configPath) {
    const configStatus = info.configExists ? chalk.green(info.configPath) : chalk.yellow(`${info.configPath} (not found)`)
    lines.push(`  Config:     ${configStatus}`)
  } else {
    lines.push(`  Config:     ${chalk.dim('No known config location')}`)
  }

  if (info.lastModified) {
    lines.push(`  Modified:   ${info.lastModified.toLocaleDateString()} ${info.lastModified.toLocaleTimeString()}`)
  }

  // Hooks
  if (info.hooks && info.hooks.length > 0) {
    lines.push(`  Hooks:      ${info.hooks.join(', ')}`)
  }

  // Permissions
  if (info.permissions) {
    lines.push(`  Permissions:`)

    if (info.permissions.allowedPaths && info.permissions.allowedPaths.length > 0) {
      const paths = info.permissions.allowedPaths.slice(0, 5).join(', ')
      const more = info.permissions.allowedPaths.length > 5 ? ` (+${info.permissions.allowedPaths.length - 5} more)` : ''
      lines.push(`    Allowed paths: ${paths}${more}`)
    }

    if (info.permissions.blockedCommands && info.permissions.blockedCommands.length > 0) {
      lines.push(`    Blocked commands: ${info.permissions.blockedCommands.length} patterns`)
    }

    if (info.permissions.rateLimit) {
      lines.push(`    Rate limit: ${info.permissions.rateLimit}`)
    }

    if (info.permissions.securityProfile) {
      lines.push(`    Security profile: ${info.permissions.securityProfile}`)
    }
  }

  // BashBros integration
  const integrationStatus = info.bashbrosIntegrated
    ? chalk.green('Hooks installed')
    : chalk.yellow('Not integrated (no hooks)')
  lines.push(`  Bashbros:   ${integrationStatus}`)

  return lines.join('\n')
}

/**
 * Format all agents info
 */
export function formatAllAgentsInfo(agents: AgentConfigInfo[]): string {
  const lines: string[] = [
    chalk.bold.cyan('AGENT CONFIGURATIONS'),
    chalk.dim('='.repeat(40)),
    ''
  ]

  const installed = agents.filter(a => a.installed)
  const notInstalled = agents.filter(a => !a.installed)

  if (installed.length === 0) {
    lines.push(chalk.yellow('No agents detected.'))
    lines.push('')
  } else {
    for (const agent of installed) {
      lines.push(formatAgentInfo(agent))
      lines.push('')
    }
  }

  // Show not-installed agents briefly
  if (notInstalled.length > 0) {
    lines.push(chalk.dim('Other known agents (not installed):'))
    lines.push(chalk.dim('  ' + notInstalled.map(a => AGENT_DISPLAY_NAMES[a.agent]).join(', ')))
  }

  return lines.join('\n')
}

/**
 * Calculate effective permissions by combining bashbros config with agent config
 */
export function getEffectivePermissions(agentInfo: AgentConfigInfo): EffectivePermissions {
  const bashbrosConfig = loadConfig()

  // Get bashbros settings
  const bashbrosPaths = bashbrosConfig.paths.allow
  const bashbrosBlocked = bashbrosConfig.commands.block
  const bashbrosRiskThreshold = bashbrosConfig.riskScoring.blockThreshold
  const bashbrosRateLimit = bashbrosConfig.rateLimit.maxPerMinute

  // Get agent settings
  const agentPaths = agentInfo.permissions?.allowedPaths || []
  const agentBlocked = agentInfo.permissions?.blockedCommands || []
  const agentRiskThreshold = typeof agentInfo.permissions?.rateLimit === 'number'
    ? agentInfo.permissions.rateLimit
    : null
  const agentRateLimit = null // Most agents don't have rate limits in their config

  // Calculate effective (most restrictive)
  // For paths: intersection if both have values, otherwise the one that exists
  let effectivePaths: string[]
  if (bashbrosPaths.length > 0 && agentPaths.length > 0) {
    // Find paths that appear in both (simplified intersection)
    effectivePaths = bashbrosPaths.filter(bp =>
      agentPaths.some(ap => ap === bp || bp.startsWith(ap) || ap.startsWith(bp))
    )
    if (effectivePaths.length === 0) {
      effectivePaths = bashbrosPaths // Fall back to bashbros if no overlap
    }
  } else {
    effectivePaths = bashbrosPaths.length > 0 ? bashbrosPaths : agentPaths
  }

  // For blocked commands: union
  const effectiveBlocked = Array.from(new Set([...bashbrosBlocked, ...agentBlocked]))

  // For numeric thresholds: use the more restrictive (lower) value
  const effectiveRiskThreshold = agentRiskThreshold !== null
    ? Math.min(bashbrosRiskThreshold, agentRiskThreshold)
    : bashbrosRiskThreshold

  const effectiveRateLimit = agentRateLimit !== null
    ? Math.min(bashbrosRateLimit, agentRateLimit)
    : bashbrosRateLimit

  return {
    allowedPaths: {
      bashbros: bashbrosPaths,
      agent: agentPaths,
      effective: effectivePaths
    },
    riskThreshold: {
      bashbros: bashbrosRiskThreshold,
      agent: agentRiskThreshold,
      effective: effectiveRiskThreshold
    },
    rateLimit: {
      bashbros: bashbrosRateLimit,
      agent: agentRateLimit,
      effective: effectiveRateLimit
    },
    blockedCommands: {
      bashbros: bashbrosBlocked,
      agent: agentBlocked,
      effective: effectiveBlocked
    }
  }
}

/**
 * Format permissions comparison table
 */
export function formatPermissionsTable(
  agents: AgentConfigInfo[]
): string {
  const lines: string[] = [
    chalk.bold.cyan('EFFECTIVE PERMISSIONS'),
    chalk.dim('='.repeat(40)),
    ''
  ]

  const config = loadConfig()

  // Header row
  const installedAgents = agents.filter(a => a.installed)
  const agentHeaders = installedAgents.map(a => AGENT_DISPLAY_NAMES[a.agent].padEnd(12))

  lines.push(chalk.bold('                    Bashbros    ' + agentHeaders.join('  ') + '  Effective'))
  lines.push(chalk.dim('-'.repeat(80)))

  // Allowed paths
  const bashbrosPaths = config.paths.allow.slice(0, 3).join(', ') || '*'
  lines.push(`Allowed paths:      ${bashbrosPaths.padEnd(12)}`)

  for (const agent of installedAgents) {
    const perms = getEffectivePermissions(agent)
    const agentPaths = perms.allowedPaths.agent.slice(0, 2).join(', ') || 'none'
    const effectivePaths = perms.allowedPaths.effective.slice(0, 2).join(', ') || '*'

    lines[lines.length - 1] += `${agentPaths.padEnd(12)}  `

    if (agent === installedAgents[installedAgents.length - 1]) {
      lines[lines.length - 1] += effectivePaths
    }
  }

  // Risk threshold
  const bashbrosRisk = config.riskScoring.blockThreshold
  let riskLine = `Risk threshold:     ${bashbrosRisk.toString().padEnd(12)}`

  for (const agent of installedAgents) {
    const perms = getEffectivePermissions(agent)
    const agentRisk = perms.riskThreshold.agent !== null ? perms.riskThreshold.agent.toString() : 'none'
    riskLine += `${agentRisk.padEnd(12)}  `

    if (agent === installedAgents[installedAgents.length - 1]) {
      const effectiveRisk = perms.riskThreshold.effective
      const note = effectiveRisk < bashbrosRisk ? ' (stricter)' : ''
      riskLine += `${effectiveRisk}${note}`
    }
  }
  lines.push(riskLine)

  // Rate limit
  const bashbrosRate = `${config.rateLimit.maxPerMinute}/min`
  let rateLine = `Rate limit:         ${bashbrosRate.padEnd(12)}`

  for (const agent of installedAgents) {
    const perms = getEffectivePermissions(agent)
    const agentRate = perms.rateLimit.agent !== null ? `${perms.rateLimit.agent}/min` : 'none'
    rateLine += `${agentRate.padEnd(12)}  `

    if (agent === installedAgents[installedAgents.length - 1]) {
      rateLine += `${perms.rateLimit.effective}/min`
    }
  }
  lines.push(rateLine)

  // Blocked commands count
  const bashbrosBlocked = config.commands.block.length
  let blockedLine = `Blocked commands:   ${bashbrosBlocked.toString().padEnd(12)}`

  for (const agent of installedAgents) {
    const perms = getEffectivePermissions(agent)
    const agentBlocked = perms.blockedCommands.agent.length
    blockedLine += `${agentBlocked.toString().padEnd(12)}  `

    if (agent === installedAgents[installedAgents.length - 1]) {
      blockedLine += perms.blockedCommands.effective.length.toString()
    }
  }
  lines.push(blockedLine)

  lines.push('')
  lines.push(chalk.dim('Note: Effective = most restrictive combination of all policies'))

  return lines.join('\n')
}

/**
 * Format a brief summary for scan output
 */
export function formatAgentSummary(agents: AgentConfigInfo[]): string {
  const lines: string[] = []
  const installed = agents.filter(a => a.installed)

  if (installed.length === 0) {
    lines.push(chalk.dim('  No agents detected'))
    return lines.join('\n')
  }

  for (const agent of installed) {
    const name = AGENT_DISPLAY_NAMES[agent.agent]
    const config = agent.configExists
      ? chalk.green('configured')
      : chalk.yellow('no config')
    const integration = agent.bashbrosIntegrated
      ? chalk.green('integrated')
      : chalk.dim('not integrated')

    lines.push(`  ${name}: ${config}, ${integration}`)
  }

  return lines.join('\n')
}
