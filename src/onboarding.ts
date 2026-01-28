import inquirer from 'inquirer'
import chalk from 'chalk'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { stringify } from 'yaml'
import type { BashBrosConfig, AgentType, SecurityProfile } from './types.js'
import { getDefaultConfig } from './config.js'
import { getBashgymIntegration } from './integration/bashgym.js'

export async function runOnboarding(): Promise<void> {
  console.log(chalk.dim('  "I watch your agent\'s back so you don\'t have to."\n'))

  // Check if bashgym integration is available
  const bashgymAvailable = existsSync(join(homedir(), '.bashgym', 'integration'))

  const questions: any[] = [
    {
      type: 'list',
      name: 'agent',
      message: 'What agent are you protecting?',
      choices: [
        { name: 'Claude Code', value: 'claude-code' },
        { name: 'Moltbot (clawd.bot)', value: 'moltbot' },
        { name: 'Clawdbot (legacy)', value: 'clawdbot' },
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
  ]

  // Add bashgym integration question if available
  if (bashgymAvailable) {
    questions.push({
      type: 'list',
      name: 'bashgym',
      message: 'Link to BashGym? (enables self-improving AI sidekick)',
      choices: [
        {
          name: 'Yes (recommended) - Export traces for training, get smarter sidekick',
          value: 'link'
        },
        {
          name: 'No - Use bashbros standalone',
          value: 'skip'
        }
      ]
    })
  }

  const answers = await inquirer.prompt(questions)

  // Build config
  const config = buildConfig(answers)

  // Write config file
  const configYaml = stringify(config)
  writeFileSync('.bashbros.yml', configYaml)

  console.log()
  console.log(chalk.green('✓'), 'Config written to', chalk.cyan('.bashbros.yml'))
  console.log(chalk.green('✓'), 'PTY wrapper ready')
  console.log(chalk.green('✓'), 'Audit logging', answers.audit !== 'disabled' ? 'enabled' : 'disabled')

  // Handle bashgym integration
  if (answers.bashgym === 'link') {
    const linked = await linkBashgym()
    if (linked) {
      console.log(chalk.green('✓'), 'BashGym integration', chalk.cyan('linked'))
      console.log(chalk.dim('  Traces will be exported for training'))
      console.log(chalk.dim('  AI sidekick will improve over time'))
    } else {
      console.log(chalk.yellow('⚠'), 'BashGym integration', chalk.dim('not linked (bashgym not running?)'))
    }
  } else if (bashgymAvailable) {
    console.log(chalk.dim('○'), 'BashGym integration', chalk.dim('skipped'))
  }

  console.log()
  console.log(chalk.dim("Run"), chalk.cyan("'bashbros doctor'"), chalk.dim("to verify setup"))
  console.log(chalk.dim("Run"), chalk.cyan("'bashbros watch'"), chalk.dim("to start protection"))
  console.log()
}

/**
 * Link bashbros to bashgym integration
 */
async function linkBashgym(): Promise<boolean> {
  try {
    const integration = getBashgymIntegration()

    // Check if bashgym directory exists
    if (!integration.isAvailable()) {
      // Create the integration directory structure
      const integrationDir = join(homedir(), '.bashgym', 'integration')
      const dirs = [
        join(integrationDir, 'traces', 'pending'),
        join(integrationDir, 'traces', 'processed'),
        join(integrationDir, 'traces', 'failed'),
        join(integrationDir, 'models', 'latest'),
        join(integrationDir, 'config'),
        join(integrationDir, 'status'),
      ]

      for (const dir of dirs) {
        mkdirSync(dir, { recursive: true })
      }

      // Create initial settings file
      const settingsPath = join(integrationDir, 'config', 'settings.json')
      const settings = {
        version: '1.0',
        updated_at: new Date().toISOString(),
        updated_by: 'bashbros',
        integration: {
          enabled: true,
          linked_at: new Date().toISOString(),
        },
        capture: {
          mode: 'successful_only',
          auto_stream: true,
        },
        training: {
          auto_enabled: false,
          quality_threshold: 50,
          trigger: 'quality_based',
        },
        security: {
          bashbros_primary: true,
          policy_path: null,
        },
        model_sync: {
          auto_export_ollama: true,
          ollama_model_name: 'bashgym-sidekick',
          notify_on_update: true,
        },
      }

      writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
    } else {
      // Update existing settings to enable integration
      integration.updateSettings({
        integration: {
          enabled: true,
          linked_at: new Date().toISOString(),
        },
      } as any)
    }

    return true
  } catch (error) {
    console.error('Failed to link bashgym:', error)
    return false
  }
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
