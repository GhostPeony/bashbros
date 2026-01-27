import { Command } from 'commander'
import chalk from 'chalk'
import { runOnboarding } from './onboarding.js'
import { runDoctor } from './doctor.js'
import { startWatch } from './watch.js'
import { handleAllow } from './allow.js'
import { BashBro } from './bro/bro.js'

const logo = `
  ╱BashBros ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🤝 Your Friendly Bash Agent Helper
`

const program = new Command()

program
  .name('bashbros')
  .description('The Bash Agent Helper')
  .version('0.1.0')

program
  .command('init')
  .description('Set up BashBros for your project')
  .action(async () => {
    console.log(chalk.cyan(logo))
    await runOnboarding()
  })

program
  .command('watch')
  .description('Start protecting your agent')
  .option('-v, --verbose', 'Show all commands as they run')
  .action(async (options) => {
    console.log(chalk.cyan(logo))
    await startWatch(options)
  })

program
  .command('doctor')
  .description('Check your BashBros configuration')
  .action(async () => {
    console.log(chalk.cyan(logo))
    await runDoctor()
  })

program
  .command('allow <command>')
  .description('Allow a specific command')
  .option('--once', 'Allow only for current session')
  .option('--persist', 'Add to config permanently')
  .action(async (command, options) => {
    await handleAllow(command, options)
  })

program
  .command('audit')
  .description('View recent command history')
  .option('-n, --lines <number>', 'Number of lines to show', '50')
  .option('--violations', 'Show only blocked commands')
  .action(async (options) => {
    const { viewAudit } = await import('./audit.js')
    await viewAudit(options)
  })

// ─────────────────────────────────────────────────────────────
// Bash Bro Commands
// ─────────────────────────────────────────────────────────────

program
  .command('scan')
  .description('Scan your system and project environment')
  .option('-p, --project <path>', 'Project path to scan', '.')
  .action(async (options) => {
    console.log(chalk.cyan(logo))
    console.log(chalk.dim('  Scanning your environment...\n'))

    const bro = new BashBro()
    await bro.initialize()

    if (options.project) {
      bro.scanProject(options.project)
    }

    console.log(bro.getSystemContext())
    console.log()
    console.log(chalk.green('✓'), 'System profile saved to ~/.bashbros/system-profile.json')
  })

program
  .command('status')
  .alias('bro')
  .description('Show Bash Bro status and system info')
  .action(async () => {
    console.log(chalk.cyan(logo))

    const bro = new BashBro()
    await bro.initialize()

    console.log(bro.status())
  })

program
  .command('suggest')
  .description('Get command suggestions based on context')
  .option('-c, --command <cmd>', 'Last command for context')
  .option('-e, --error <msg>', 'Last error message')
  .action(async (options) => {
    const bro = new BashBro()
    await bro.initialize()

    const suggestions = bro.suggest({
      lastCommand: options.command,
      lastError: options.error,
      cwd: process.cwd()
    })

    if (suggestions.length === 0) {
      console.log(chalk.dim('No suggestions available.'))
      return
    }

    console.log(chalk.bold('🤝 Bash Bro suggests:\n'))
    for (const s of suggestions) {
      const confidence = Math.round(s.confidence * 100)
      console.log(`  ${chalk.cyan(s.command)}`)
      console.log(chalk.dim(`    ${s.description} (${confidence}% confidence)`))
      console.log()
    }
  })

program
  .command('route <command>')
  .description('Check how a command would be routed')
  .action(async (command) => {
    const bro = new BashBro()
    await bro.initialize()

    const result = bro.route(command)
    const icon = result.decision === 'bro' ? '🤝' : result.decision === 'main' ? '🤖' : '⚡'
    const label = result.decision === 'bro' ? 'Bash Bro' : result.decision === 'main' ? 'Main Agent' : 'Both (parallel)'

    console.log()
    console.log(`${icon} Route: ${chalk.bold(label)}`)
    console.log(chalk.dim(`   Reason: ${result.reason}`))
    console.log(chalk.dim(`   Confidence: ${Math.round(result.confidence * 100)}%`))
    console.log()
  })

program
  .command('run <command>')
  .description('Run a command through Bash Bro')
  .option('-b, --background', 'Run in background')
  .action(async (command, options) => {
    const bro = new BashBro()
    await bro.initialize()

    if (options.background) {
      const task = bro.runBackground(command)
      console.log(chalk.green('✓'), `Started background task: ${task.id}`)
      console.log(chalk.dim(`  Command: ${command}`))
      console.log(chalk.dim(`  Run 'bashbros tasks' to check status`))
    } else {
      console.log(chalk.dim(`🤝 Bash Bro executing: ${command}\n`))
      const output = await bro.execute(command)
      console.log(output)
    }
  })

program
  .command('tasks')
  .description('List background tasks')
  .option('-a, --all', 'Show all tasks (not just running)')
  .action(async (options) => {
    const bro = new BashBro()

    const tasks = options.all
      ? bro.getBackgroundTasks()
      : bro.getBackgroundTasks().filter(t => t.status === 'running')

    if (tasks.length === 0) {
      console.log(chalk.dim('No background tasks.'))
      return
    }

    console.log(chalk.bold('🤝 Background Tasks:\n'))
    for (const task of tasks) {
      const elapsed = Math.round((Date.now() - task.startTime.getTime()) / 1000)
      const statusIcon = task.status === 'running' ? '⏳' :
                         task.status === 'completed' ? '✓' :
                         task.status === 'failed' ? '✗' : '○'

      console.log(`  ${statusIcon} [${task.id}] ${task.command}`)
      console.log(chalk.dim(`    Status: ${task.status}, Elapsed: ${elapsed}s`))
      console.log()
    }
  })

// ─────────────────────────────────────────────────────────────
// AI Commands (requires Ollama)
// ─────────────────────────────────────────────────────────────

program
  .command('explain <command>')
  .description('Ask Bash Bro to explain a command')
  .action(async (command) => {
    const bro = new BashBro()
    await bro.initialize()

    if (!bro.isOllamaAvailable()) {
      console.log(chalk.yellow('Ollama not available. Start Ollama to use AI features.'))
      return
    }

    console.log(chalk.dim('🤝 Bash Bro is thinking...\n'))
    const explanation = await bro.aiExplain(command)
    console.log(explanation)
  })

program
  .command('fix <command>')
  .description('Ask Bash Bro to fix a failed command')
  .option('-e, --error <message>', 'Error message from the failed command')
  .action(async (command, options) => {
    const bro = new BashBro()
    await bro.initialize()

    if (!bro.isOllamaAvailable()) {
      console.log(chalk.yellow('Ollama not available. Start Ollama to use AI features.'))
      return
    }

    const error = options.error || 'Command failed'
    console.log(chalk.dim('🤝 Bash Bro is analyzing...\n'))

    const fixed = await bro.aiFix(command, error)

    if (fixed) {
      console.log(chalk.green('Suggested fix:'))
      console.log(chalk.cyan(`  ${fixed}`))
    } else {
      console.log(chalk.yellow('Could not suggest a fix.'))
    }
  })

program
  .command('ai <prompt>')
  .description('Ask Bash Bro anything')
  .action(async (prompt) => {
    const bro = new BashBro()
    await bro.initialize()

    if (!bro.isOllamaAvailable()) {
      console.log(chalk.yellow('Ollama not available. Start Ollama to use AI features.'))
      return
    }

    console.log(chalk.dim('🤝 Bash Bro is thinking...\n'))
    const suggestion = await bro.aiSuggest(prompt)

    if (suggestion) {
      console.log(chalk.cyan(suggestion))
    } else {
      console.log(chalk.dim('No suggestion available.'))
    }
  })

program.parse()
