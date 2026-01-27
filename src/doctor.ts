import chalk from 'chalk'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { findConfig, loadConfig } from './config.js'

interface CheckResult {
  name: string
  passed: boolean
  message: string
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
