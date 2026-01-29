/**
 * Multi-Agent Setup Wizard
 * Install BashBros hooks for multiple agents at once
 */

import inquirer from 'inquirer'
import chalk from 'chalk'
import { ClaudeCodeHooks } from './hooks/claude-code.js'
import { MoltbotHooks } from './hooks/moltbot.js'
import { GeminiCLIHooks } from './hooks/gemini-cli.js'
import { CopilotCLIHooks } from './hooks/copilot-cli.js'
import { OpenCodeHooks } from './hooks/opencode.js'

interface AgentEntry {
  name: string
  key: string
  detected: boolean
  scope: 'user' | 'project'
  install: () => { success: boolean; message: string }
}

export async function runSetup(): Promise<void> {
  console.log(chalk.dim('  Detecting installed agents...\n'))

  const agents: AgentEntry[] = [
    {
      name: 'Claude Code',
      key: 'claude-code',
      detected: ClaudeCodeHooks.isClaudeInstalled(),
      scope: 'user',
      install: () => ClaudeCodeHooks.install()
    },
    {
      name: 'Moltbot',
      key: 'moltbot',
      detected: MoltbotHooks.isMoltbotInstalled() || MoltbotHooks.isClawdbotInstalled(),
      scope: 'user',
      install: () => MoltbotHooks.install()
    },
    {
      name: 'Gemini CLI',
      key: 'gemini-cli',
      detected: GeminiCLIHooks.isGeminiInstalled(),
      scope: 'project',
      install: () => GeminiCLIHooks.install()
    },
    {
      name: 'Copilot CLI',
      key: 'copilot-cli',
      detected: CopilotCLIHooks.isCopilotInstalled(),
      scope: 'project',
      install: () => CopilotCLIHooks.install()
    },
    {
      name: 'OpenCode',
      key: 'opencode',
      detected: OpenCodeHooks.isOpenCodeInstalled(),
      scope: 'project',
      install: () => OpenCodeHooks.install()
    }
  ]

  // Show detection results
  console.log(chalk.bold('  Detected Agents:\n'))
  for (const agent of agents) {
    const icon = agent.detected ? chalk.green('✓') : chalk.dim('✗')
    const scopeLabel = chalk.dim(`(${agent.scope}-scoped)`)
    console.log(`    ${icon} ${agent.name} ${scopeLabel}`)
  }
  console.log()

  const detectedAgents = agents.filter(a => a.detected)

  if (detectedAgents.length === 0) {
    console.log(chalk.yellow('  No supported agents detected.'))
    console.log(chalk.dim('  Install an agent first, then run bashbros setup again.'))
    console.log(chalk.dim('  Or use "bashbros watch" for universal protection.\n'))
    return
  }

  // Multi-select prompt
  const { selected } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selected',
    message: 'Select agents to install BashBros hooks for:',
    choices: detectedAgents.map(a => ({
      name: `${a.name} (${a.scope}-scoped)`,
      value: a.key,
      checked: true // Pre-select all detected agents
    }))
  }])

  if (selected.length === 0) {
    console.log(chalk.dim('\n  No agents selected. Nothing to do.\n'))
    return
  }

  // Install hooks for selected agents
  console.log()
  let successCount = 0
  let failCount = 0

  for (const key of selected) {
    const agent = agents.find(a => a.key === key)
    if (!agent) continue

    try {
      const result = agent.install()
      if (result.success) {
        console.log(chalk.green('  ✓'), `${agent.name}: ${result.message}`)
        successCount++
      } else {
        console.log(chalk.red('  ✗'), `${agent.name}: ${result.message}`)
        failCount++
      }
    } catch (error) {
      console.log(chalk.red('  ✗'), `${agent.name}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      failCount++
    }
  }

  // Summary
  console.log()
  if (failCount === 0) {
    console.log(chalk.green('  ✓'), `All ${successCount} agent(s) configured successfully.`)
  } else {
    console.log(chalk.yellow('  ⚠'), `${successCount} succeeded, ${failCount} failed.`)
  }

  console.log()
  console.log(chalk.dim('  Run "bashbros doctor" to verify setup'))
  console.log(chalk.dim('  Run "bashbros dashboard" to monitor all agents'))
  console.log()
}
