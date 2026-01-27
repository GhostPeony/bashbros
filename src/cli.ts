import { Command } from 'commander'
import chalk from 'chalk'
import { runOnboarding } from './onboarding.js'
import { runDoctor } from './doctor.js'
import { startWatch } from './watch.js'
import { handleAllow } from './allow.js'
import { BashBro } from './bro/bro.js'
import { ClaudeCodeHooks, gateCommand } from './hooks/claude-code.js'
import { RiskScorer } from './policy/risk-scorer.js'
import { MetricsCollector } from './observability/metrics.js'
import { CostEstimator } from './observability/cost.js'
import { ReportGenerator } from './observability/report.js'
import { UndoStack } from './safety/undo-stack.js'
import { LoopDetector } from './policy/loop-detector.js'

// Shared state for session tracking
let metricsCollector: MetricsCollector | null = null
let costEstimator: CostEstimator | null = null
let loopDetector: LoopDetector | null = null
let undoStack: UndoStack | null = null

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

program
  .command('script <description>')
  .description('Generate a shell script from description')
  .option('-o, --output <file>', 'Save script to file')
  .action(async (description, options) => {
    const bro = new BashBro()
    await bro.initialize()

    if (!bro.isOllamaAvailable()) {
      console.log(chalk.yellow('Ollama not available. Start Ollama to use AI features.'))
      return
    }

    console.log(chalk.dim('🤝 Bash Bro is generating script...\n'))
    const script = await bro.aiGenerateScript(description)

    if (script) {
      console.log(chalk.cyan(script))

      if (options.output) {
        const { writeFileSync } = await import('fs')
        writeFileSync(options.output, script, { mode: 0o755 })
        console.log(chalk.green(`\n✓ Saved to ${options.output}`))
      }
    } else {
      console.log(chalk.yellow('Could not generate script.'))
    }
  })

program
  .command('safety <command>')
  .description('Analyze a command for security risks')
  .action(async (command) => {
    const bro = new BashBro()
    await bro.initialize()

    if (!bro.isOllamaAvailable()) {
      console.log(chalk.yellow('Ollama not available. Start Ollama to use AI features.'))
      return
    }

    console.log(chalk.dim('🤝 Bash Bro is analyzing...\n'))
    const analysis = await bro.aiAnalyzeSafety(command)

    const riskColors = {
      low: chalk.green,
      medium: chalk.yellow,
      high: chalk.red,
      critical: chalk.bgRed.white
    }

    const icon = analysis.safe ? '✓' : '⚠'
    const color = riskColors[analysis.risk]

    console.log(`${icon} Risk Level: ${color(analysis.risk.toUpperCase())}`)
    console.log()
    console.log(chalk.bold('Explanation:'))
    console.log(`  ${analysis.explanation}`)

    if (analysis.suggestions.length > 0) {
      console.log()
      console.log(chalk.bold('Suggestions:'))
      for (const suggestion of analysis.suggestions) {
        console.log(`  • ${suggestion}`)
      }
    }
  })

program
  .command('help-ai <topic>')
  .alias('h')
  .description('Get AI help for a command or topic')
  .action(async (topic) => {
    const bro = new BashBro()
    await bro.initialize()

    if (!bro.isOllamaAvailable()) {
      console.log(chalk.yellow('Ollama not available. Start Ollama to use AI features.'))
      return
    }

    console.log(chalk.dim('🤝 Bash Bro is looking that up...\n'))
    const help = await bro.aiHelp(topic)
    console.log(help)
  })

program
  .command('do <description>')
  .description('Convert natural language to a command')
  .option('-x, --execute', 'Execute the command after showing it')
  .action(async (description, options) => {
    const bro = new BashBro()
    await bro.initialize()

    if (!bro.isOllamaAvailable()) {
      console.log(chalk.yellow('Ollama not available. Start Ollama to use AI features.'))
      return
    }

    console.log(chalk.dim('🤝 Bash Bro is translating...\n'))
    const command = await bro.aiToCommand(description)

    if (command) {
      console.log(chalk.bold('Command:'))
      console.log(chalk.cyan(`  $ ${command}`))

      if (options.execute) {
        console.log()
        console.log(chalk.dim('Executing...'))
        const output = await bro.execute(command)
        console.log(output)
      }
    } else {
      console.log(chalk.yellow('Could not translate to a command.'))
    }
  })

program
  .command('models')
  .description('List available Ollama models')
  .action(async () => {
    console.log(chalk.cyan(logo))

    const { OllamaClient } = await import('./bro/ollama.js')
    const ollama = new OllamaClient()

    const available = await ollama.isAvailable()
    if (!available) {
      console.log(chalk.yellow('Ollama not running. Start Ollama to see available models.'))
      return
    }

    const models = await ollama.listModels()

    if (models.length === 0) {
      console.log(chalk.dim('No models installed. Run: ollama pull qwen2.5-coder:7b'))
      return
    }

    console.log(chalk.bold('🤝 Available Models:\n'))
    for (const model of models) {
      const current = model === ollama.getModel() ? chalk.green(' (current)') : ''
      console.log(`  • ${model}${current}`)
    }
  })

// ─────────────────────────────────────────────────────────────
// Hook & Observability Commands
// ─────────────────────────────────────────────────────────────

const hookCmd = program
  .command('hook')
  .description('Manage Claude Code hook integration')

hookCmd
  .command('install')
  .description('Install BashBros hooks into Claude Code')
  .action(() => {
    const result = ClaudeCodeHooks.install()
    if (result.success) {
      console.log(chalk.green('✓'), result.message)
    } else {
      console.log(chalk.red('✗'), result.message)
      process.exit(1)
    }
  })

hookCmd
  .command('uninstall')
  .description('Remove BashBros hooks from Claude Code')
  .action(() => {
    const result = ClaudeCodeHooks.uninstall()
    if (result.success) {
      console.log(chalk.green('✓'), result.message)
    } else {
      console.log(chalk.red('✗'), result.message)
      process.exit(1)
    }
  })

hookCmd
  .command('status')
  .description('Check Claude Code hook status')
  .action(() => {
    const status = ClaudeCodeHooks.getStatus()
    console.log()
    console.log(chalk.bold('Claude Code Integration Status'))
    console.log()
    console.log(`  Claude Code: ${status.claudeInstalled ? chalk.green('installed') : chalk.yellow('not found')}`)
    console.log(`  BashBros hooks: ${status.hooksInstalled ? chalk.green('active') : chalk.dim('not installed')}`)
    if (status.hooks.length > 0) {
      console.log(`  Active hooks: ${status.hooks.join(', ')}`)
    }
    console.log()
  })

program
  .command('gate <command>')
  .description('Check if a command should be allowed (used by hooks)')
  .action(async (command) => {
    const result = await gateCommand(command)

    if (!result.allowed) {
      console.error(`BLOCKED: ${result.reason}`)
      process.exit(2)  // Non-zero to block in Claude Code
    }

    // Silently allow
    process.exit(0)
  })

program
  .command('record <command>')
  .description('Record a command execution (used by hooks)')
  .option('-o, --output <output>', 'Command output')
  .option('-e, --exit-code <code>', 'Exit code', '0')
  .action(async (command, options) => {
    // Initialize collectors if needed
    if (!metricsCollector) metricsCollector = new MetricsCollector()
    if (!costEstimator) costEstimator = new CostEstimator()
    if (!loopDetector) loopDetector = new LoopDetector()
    if (!undoStack) undoStack = new UndoStack()

    const scorer = new RiskScorer()
    const risk = scorer.score(command)

    // Record metrics
    metricsCollector.record({
      command,
      timestamp: new Date(),
      duration: 0,  // Not available in hook
      allowed: true,
      riskScore: risk,
      violations: [],
      exitCode: parseInt(options.exitCode) || 0
    })

    // Record for cost estimation
    costEstimator.recordToolCall(command, options.output || '')

    // Check for loops
    const loopAlert = loopDetector.check(command)
    if (loopAlert) {
      console.error(chalk.yellow(`⚠ Loop detected: ${loopAlert.message}`))
    }

    // Track file changes for undo
    const paths = command.match(/(?:^|\s)(\.\/|\.\.\/|\/|~\/)[^\s]+/g) || []
    const cleanPaths = paths.map((p: string) => p.trim())
    if (cleanPaths.length > 0) {
      undoStack.recordFromCommand(command, cleanPaths)
    }
  })

program
  .command('session-end')
  .description('Generate session report (used by hooks)')
  .option('-f, --format <format>', 'Output format (text, markdown, json)', 'text')
  .action((options) => {
    if (!metricsCollector) {
      console.log(chalk.dim('No session data to report.'))
      return
    }

    const metrics = metricsCollector.getMetrics()
    const cost = costEstimator?.getEstimate()
    const report = ReportGenerator.generate(metrics, cost, { format: options.format })

    console.log()
    console.log(report)
    console.log()
  })

program
  .command('report')
  .description('Generate a session report')
  .option('-f, --format <format>', 'Output format (text, markdown, json)', 'text')
  .option('--no-cost', 'Hide cost estimate')
  .option('--no-risk', 'Hide risk distribution')
  .action((options) => {
    if (!metricsCollector) {
      console.log(chalk.dim('No session data. Run some commands first.'))
      return
    }

    const metrics = metricsCollector.getMetrics()
    const cost = options.cost ? costEstimator?.getEstimate() : undefined
    const report = ReportGenerator.generate(metrics, cost, {
      format: options.format,
      showCost: options.cost,
      showRisk: options.risk
    })

    console.log()
    console.log(report)
    console.log()
  })

program
  .command('risk <command>')
  .description('Score a command for security risk')
  .action((command) => {
    const scorer = new RiskScorer()
    const result = scorer.score(command)

    const colors: Record<string, (s: string) => string> = {
      safe: chalk.green,
      caution: chalk.yellow,
      dangerous: chalk.red,
      critical: chalk.bgRed.white
    }

    const color = colors[result.level]

    console.log()
    console.log(`  Risk Score: ${color(`${result.score}/10`)} (${color(result.level.toUpperCase())})`)
    console.log()
    console.log(chalk.bold('  Factors:'))
    for (const factor of result.factors) {
      console.log(`    • ${factor}`)
    }
    console.log()
  })

const undoCmd = program
  .command('undo')
  .description('Undo file operations')

undoCmd
  .command('last')
  .alias('pop')
  .description('Undo the last file operation')
  .action(() => {
    if (!undoStack) {
      console.log(chalk.dim('No operations to undo.'))
      return
    }

    const result = undoStack.undo()
    if (result.success) {
      console.log(chalk.green('✓'), result.message)
    } else {
      console.log(chalk.red('✗'), result.message)
    }
  })

undoCmd
  .command('all')
  .description('Undo all file operations in session')
  .action(() => {
    if (!undoStack || undoStack.size() === 0) {
      console.log(chalk.dim('No operations to undo.'))
      return
    }

    const results = undoStack.undoAll()
    let success = 0, failed = 0

    for (const result of results) {
      if (result.success) {
        console.log(chalk.green('✓'), result.message)
        success++
      } else {
        console.log(chalk.red('✗'), result.message)
        failed++
      }
    }

    console.log()
    console.log(`Undone: ${success} successful, ${failed} failed`)
  })

undoCmd
  .command('list')
  .description('Show undo stack')
  .action(() => {
    if (!undoStack) {
      undoStack = new UndoStack()
    }

    console.log()
    console.log(undoStack.formatStack())
    console.log()
  })

program.parse()
