import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { findConfig, loadConfig } from './config.js'
import { getAllAgentConfigs, getAgentConfigInfo } from './transparency/agent-config.js'
import { ExposureScanner, EgressPatternMatcher } from './policy/ward/index.js'
import type { AgentConfigInfo } from './types.js'

interface CheckResult {
  name: string
  passed: boolean
  message: string
}

/**
 * Check agent configurations for health issues
 */
async function checkAgentConfigs(agents: AgentConfigInfo[]): Promise<CheckResult[]> {
  const checks: CheckResult[] = []

  for (const agent of agents) {
    const agentName = agent.agent.charAt(0).toUpperCase() + agent.agent.slice(1).replace('-', ' ')

    // Check if config exists
    if (agent.configPath && !agent.configExists) {
      checks.push({
        name: `${agentName} config`,
        passed: false,
        message: `Config path known (${agent.configPath}) but file not found`
      })
    } else if (agent.configExists) {
      checks.push({
        name: `${agentName} config`,
        passed: true,
        message: `Found at ${agent.configPath}`
      })
    }

    // Check bashbros integration
    if (agent.agent === 'claude-code') {
      checks.push({
        name: `${agentName} integration`,
        passed: agent.bashbrosIntegrated,
        message: agent.bashbrosIntegrated
          ? 'BashBros hooks installed'
          : 'Hooks not installed. Run "bashbros hook install" to protect Claude Code'
      })
    }

    // Check moltbot/clawdbot specific integration
    if (agent.agent === 'moltbot' || agent.agent === 'clawdbot') {
      checks.push({
        name: `${agentName} integration`,
        passed: agent.bashbrosIntegrated,
        message: agent.bashbrosIntegrated
          ? 'BashBros hooks installed'
          : 'Hooks not installed. Run "bashbros moltbot install" to protect moltbot'
      })

      // Check for moltbot-specific settings via dynamic import
      try {
        const { MoltbotHooks } = await import('./hooks/moltbot.js')
        const status = MoltbotHooks.getStatus()

        // Check sandbox mode
        if (status.sandboxMode) {
          checks.push({
            name: `${agentName} sandbox`,
            passed: status.sandboxMode === 'strict',
            message: status.sandboxMode === 'strict'
              ? 'Sandbox mode enabled (strict)'
              : `Sandbox mode: ${status.sandboxMode} (consider "strict" for better security)`
          })
        }

        // Check gateway configuration
        if (status.gatewayRunning) {
          const gatewayStatus = await MoltbotHooks.getGatewayStatus()
          checks.push({
            name: `${agentName} gateway`,
            passed: gatewayStatus.running,
            message: gatewayStatus.running
              ? `Gateway running on port ${gatewayStatus.port}`
              : 'Gateway configured but not running'
          })
        }
      } catch {
        // Moltbot hooks module not available, skip additional checks
      }
    }

    // Check for potential permission conflicts
    if (agent.permissions) {
      const config = loadConfig()

      // Warn if agent has no path restrictions but bashbros does
      if ((!agent.permissions.allowedPaths || agent.permissions.allowedPaths.length === 0) &&
          config.paths.allow.length > 0 && !config.paths.allow.includes('*')) {
        checks.push({
          name: `${agentName} path policy`,
          passed: true,  // Not a failure, just a note
          message: `Agent has no path restrictions; bashbros will enforce: ${config.paths.allow.slice(0, 3).join(', ')}`
        })
      }
    }
  }

  return checks
}

export async function runDoctor(): Promise<void> {
  console.log(chalk.bold('\nRunning diagnostics...\n'))

  const checks: CheckResult[] = []

  // Check 1: Config file exists
  const configPath = findConfig()
  checks.push({
    name: 'Config file',
    passed: configPath !== null,
    message: configPath
      ? `Found at ${configPath}`
      : 'Not found. Run "bashbros init" to create one.'
  })

  // Check 2: Config is valid
  if (configPath) {
    try {
      const config = loadConfig(configPath)
      checks.push({
        name: 'Config valid',
        passed: true,
        message: `Profile: ${config.profile}, Agent: ${config.agent}`
      })
    } catch (error) {
      checks.push({
        name: 'Config valid',
        passed: false,
        message: `Parse error: ${error}`
      })
    }
  }

  // Check 3: Audit directory exists
  const auditDir = join(homedir(), '.bashbros')
  checks.push({
    name: 'Audit directory',
    passed: existsSync(auditDir),
    message: existsSync(auditDir)
      ? `Found at ${auditDir}`
      : 'Will be created on first run'
  })

  // Check 4: node-pty available
  try {
    await import('node-pty')
    checks.push({
      name: 'PTY support',
      passed: true,
      message: 'node-pty loaded successfully'
    })
  } catch (error) {
    checks.push({
      name: 'PTY support',
      passed: false,
      message: 'node-pty not available. Run "npm install" to install dependencies.'
    })
  }

  // Check 5: Secrets protection patterns
  if (configPath) {
    const config = loadConfig(configPath)
    const secretsEnabled = config.secrets.enabled
    checks.push({
      name: 'Secrets protection',
      passed: secretsEnabled,
      message: secretsEnabled
        ? `Enabled with ${config.secrets.patterns.length} patterns`
        : 'Disabled - credentials may be exposed'
    })
  }

  // Check 6: Rate limiting
  if (configPath) {
    const config = loadConfig(configPath)
    checks.push({
      name: 'Rate limiting',
      passed: config.rateLimit.enabled,
      message: config.rateLimit.enabled
        ? `${config.rateLimit.maxPerMinute}/min, ${config.rateLimit.maxPerHour}/hr`
        : 'Disabled - runaway agents possible'
    })
  }

  // Check 7: Agent configurations
  const agents = await getAllAgentConfigs()
  const installedAgents = agents.filter(a => a.installed)

  if (installedAgents.length > 0) {
    // Check agent config health
    const agentChecks = await checkAgentConfigs(installedAgents)
    checks.push(...agentChecks)
  } else {
    checks.push({
      name: 'Agent detection',
      passed: true,
      message: 'No agents detected (install claude, aider, etc. to use bashbros protection)'
    })
  }

  // Check 8: Ward security
  if (configPath) {
    const config = loadConfig(configPath)
    const wardEnabled = config.ward?.enabled ?? false
    checks.push({
      name: 'Ward security',
      passed: wardEnabled,
      message: wardEnabled
        ? `Enabled (exposure scan: ${config.ward.exposure.scanInterval}ms)`
        : 'Disabled - network exposure monitoring off'
    })
  }

  // Check 9: Dashboard
  if (configPath) {
    const config = loadConfig(configPath)
    const dashEnabled = config.dashboard?.enabled ?? false
    checks.push({
      name: 'Dashboard',
      passed: dashEnabled,
      message: dashEnabled
        ? `Enabled on ${config.dashboard.bind}:${config.dashboard.port}`
        : 'Disabled - run "bashbros dashboard" to start'
    })
  }

  // Check 10: Exposure scanner
  try {
    const scanner = new ExposureScanner()
    const agentSignatures = scanner.getAgents()
    checks.push({
      name: 'Exposure scanner',
      passed: true,
      message: `Ready, monitoring ${agentSignatures.length} agent signatures`
    })
  } catch {
    checks.push({
      name: 'Exposure scanner',
      passed: false,
      message: 'Failed to initialize exposure scanner'
    })
  }

  // Check 11: Egress patterns
  try {
    const matcher = new EgressPatternMatcher()
    const patterns = matcher.getPatterns()
    const credPatterns = patterns.filter(p => p.category === 'credentials').length
    const piiPatterns = patterns.filter(p => p.category === 'pii').length
    checks.push({
      name: 'Egress patterns',
      passed: true,
      message: `Loaded ${patterns.length} patterns (${credPatterns} credential, ${piiPatterns} PII)`
    })
  } catch {
    checks.push({
      name: 'Egress patterns',
      passed: false,
      message: 'Failed to initialize egress patterns'
    })
  }

  // Print results
  let passed = 0
  let failed = 0

  for (const check of checks) {
    const icon = check.passed ? chalk.green('✓') : chalk.red('✗')
    const status = check.passed ? chalk.green('OK') : chalk.red('FAIL')

    console.log(`  ${icon} ${chalk.bold(check.name)}: ${status}`)
    console.log(chalk.dim(`    ${check.message}`))
    console.log()

    if (check.passed) passed++
    else failed++
  }

  // Summary
  console.log(chalk.bold('─'.repeat(40)))
  if (failed === 0) {
    console.log(chalk.green(`\n✓ All ${passed} checks passed. BashBros is ready.\n`))
  } else {
    console.log(chalk.yellow(`\n${passed} passed, ${failed} failed. Fix issues above.\n`))
  }
}
