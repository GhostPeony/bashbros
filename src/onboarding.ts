import inquirer from 'inquirer'
import chalk from 'chalk'
import { writeFileSync } from 'fs'
import { stringify } from 'yaml'
import type { BashBrosConfig, AgentType, SecurityProfile } from './types.js'
import { getDefaultConfig } from './config.js'

export async function runOnboarding(): Promise<void> {
  console.log(chalk.dim('  "I watch your agent\'s back so you don\'t have to."\n'))

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'agent',
      message: 'What agent are you protecting?',
      choices: [
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Clawdbot', value: 'clawdbot' },
        { name: 'Gemini CLI', value: 'gemini-cli' },
        { name: 'Aider', value: 'aider' },
        { name: 'OpenCode', value: 'opencode' },
        { name: 'Other (custom)', value: 'custom' }
      ]
    },
    {
      type: 'list',
      name: 'projectType',
      message: "What's this project about? (helps tune defaults)",
      choices: [
        { name: 'Web development', value: 'web' },
        { name: 'DevOps / Infrastructure', value: 'devops' },
        { name: 'Data engineering', value: 'data' },
        { name: 'General coding', value: 'general' },
        { name: 'Sensitive/regulated work', value: 'sensitive' }
      ]
    },
    {
      type: 'list',
      name: 'profile',
      message: 'Security posture:',
      choices: [
        {
          name: 'Balanced (recommended) - Block dangerous, allow common dev tools',
          value: 'balanced'
        },
        {
          name: 'Strict - Allowlist only, explicit approval for new commands',
          value: 'strict'
        },
        {
          name: 'Permissive - Log everything, block only critical threats',
          value: 'permissive'
        },
        {
          name: "Custom - I'll configure manually",
          value: 'custom'
        }
      ]
    },
    {
      type: 'list',
      name: 'secrets',
      message: 'Protect secrets? (scans for .env, credentials, SSH keys)',
      choices: [
        { name: 'Yes, block access and warn (recommended)', value: 'block' },
        { name: 'Yes, but allow read with audit log', value: 'audit' },
        { name: 'No', value: 'disabled' }
      ]
    },
    {
      type: 'list',
      name: 'audit',
      message: 'Enable audit logging?',
      choices: [
        { name: 'Local file (~/.bashbros/audit.log)', value: 'local' },
        { name: 'Send to remote (Datadog, Splunk, webhook)', value: 'remote' },
        { name: 'Both', value: 'both' },
        { name: 'None', value: 'disabled' }
      ]
    }
  ])

  // Build config
  const config = buildConfig(answers)

  // Write config file
  const configYaml = stringify(config)
  writeFileSync('.bashbros.yml', configYaml)

  console.log()
  console.log(chalk.green('✓'), 'Config written to', chalk.cyan('.bashbros.yml'))
  console.log(chalk.green('✓'), 'PTY wrapper ready')
  console.log(chalk.green('✓'), 'Audit logging', answers.audit !== 'disabled' ? 'enabled' : 'disabled')
  console.log()
  console.log(chalk.dim("Run"), chalk.cyan("'bashbros doctor'"), chalk.dim("to verify setup"))
  console.log(chalk.dim("Run"), chalk.cyan("'bashbros watch'"), chalk.dim("to start protection"))
  console.log()
}

function buildConfig(answers: Record<string, string>): BashBrosConfig {
  const defaults = getDefaultConfig()

  const config: BashBrosConfig = {
    ...defaults,
    agent: answers.agent as AgentType,
    profile: answers.profile as SecurityProfile,
    secrets: {
      ...defaults.secrets,
      enabled: answers.secrets !== 'disabled',
      mode: answers.secrets === 'audit' ? 'audit' : 'block'
    },
    audit: {
      ...defaults.audit,
      enabled: answers.audit !== 'disabled',
      destination: answers.audit === 'disabled' ? 'local' : answers.audit as 'local' | 'remote' | 'both'
    }
  }

  // Adjust for project type
  if (answers.projectType === 'sensitive') {
    config.profile = 'strict'
    config.rateLimit.maxPerMinute = 50
  }

  if (answers.projectType === 'devops') {
    config.commands.allow.push('docker *', 'kubectl *', 'terraform *', 'aws *')
  }

  if (answers.projectType === 'data') {
    config.commands.allow.push('python *', 'jupyter *', 'pandas *', 'psql *')
  }

  return config
}
