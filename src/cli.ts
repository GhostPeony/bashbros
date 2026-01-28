import { Command } from 'commander'
import chalk from 'chalk'
import { runOnboarding } from './onboarding.js'
import { runDoctor } from './doctor.js'
import { startWatch } from './watch.js'
import { handleAllow } from './allow.js'
import { BashBro } from './bro/bro.js'
import { ClaudeCodeHooks, gateCommand } from './hooks/claude-code.js'
import { MoltbotHooks } from './hooks/moltbot.js'
import { RiskScorer } from './policy/risk-scorer.js'
import { MetricsCollector } from './observability/metrics.js'
import {
  getAllAgentConfigs,
  getAgentConfigInfo,
  formatRedactedConfig
} from './transparency/index.js'
import {
  formatAllAgentsInfo,
  formatPermissionsTable,
  getEffectivePermissions
} from './transparency/display.js'
import { CostEstimator } from './observability/cost.js'
import { ReportGenerator } from './observability/report.js'
import { UndoStack } from './safety/undo-stack.js'
import { LoopDetector } from './policy/loop-detector.js'
import { DashboardServer } from './dashboard/index.js'
import { ExposureScanner, EgressMonitor, EgressPatternMatcher } from './policy/ward/index.js'

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

    // Add Agent Configurations section
    console.log(chalk.bold('\n## Agent Configurations\n'))
    const { formatAgentSummary } = await import('./transparency/display.js')
    const agents = await getAllAgentConfigs()
    console.log(formatAgentSummary(agents))
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
    console.log(`  All-tools recording: ${status.allToolsInstalled ? chalk.green('active') : chalk.dim('not installed')}`)
    if (status.hooks.length > 0) {
      console.log(`  Active hooks: ${status.hooks.join(', ')}`)
    }
    console.log()
  })

hookCmd
  .command('install-all-tools')
  .description('Install hook to record ALL Claude Code tool uses (not just Bash)')
  .action(() => {
    const result = ClaudeCodeHooks.installAllTools()
    if (result.success) {
      console.log(chalk.green('✓'), result.message)
    } else {
      console.log(chalk.red('✗'), result.message)
      process.exit(1)
    }
  })

hookCmd
  .command('uninstall-all-tools')
  .description('Remove all-tools recording hook')
  .action(() => {
    const result = ClaudeCodeHooks.uninstallAllTools()
    if (result.success) {
      console.log(chalk.green('✓'), result.message)
    } else {
      console.log(chalk.red('✗'), result.message)
      process.exit(1)
    }
  })

// ─────────────────────────────────────────────────────────────
// Moltbot Integration Commands
// ─────────────────────────────────────────────────────────────

const moltbotCmd = program
  .command('moltbot')
  .alias('clawdbot')
  .description('Manage Moltbot/Clawdbot integration')

moltbotCmd
  .command('install')
  .description('Install BashBros hooks into Moltbot')
  .action(() => {
    const result = MoltbotHooks.install()
    if (result.success) {
      console.log(chalk.green('✓'), result.message)
    } else {
      console.log(chalk.red('✗'), result.message)
      process.exit(1)
    }
  })

moltbotCmd
  .command('uninstall')
  .description('Remove BashBros hooks from Moltbot')
  .action(() => {
    const result = MoltbotHooks.uninstall()
    if (result.success) {
      console.log(chalk.green('✓'), result.message)
    } else {
      console.log(chalk.red('✗'), result.message)
      process.exit(1)
    }
  })

moltbotCmd
  .command('status')
  .description('Check Moltbot integration status')
  .action(async () => {
    const status = MoltbotHooks.getStatus()
    console.log()
    console.log(chalk.bold('Moltbot Integration Status'))
    console.log()

    // Installation status
    if (status.moltbotInstalled) {
      console.log(`  Moltbot:       ${chalk.green('installed')}`)
    } else if (status.clawdbotInstalled) {
      console.log(`  Clawdbot:      ${chalk.green('installed')} ${chalk.dim('(legacy)')}`)
    } else {
      console.log(`  Moltbot:       ${chalk.yellow('not found')}`)
    }

    // Config status
    if (status.configPath) {
      console.log(`  Config:        ${chalk.green(status.configPath)}`)
    } else {
      console.log(`  Config:        ${chalk.dim('not found')}`)
    }

    // Hooks status
    console.log(`  BashBros hooks: ${status.hooksInstalled ? chalk.green('active') : chalk.dim('not installed')}`)
    if (status.hooks.length > 0) {
      console.log(`  Active hooks:  ${status.hooks.join(', ')}`)
    }

    // Sandbox mode
    if (status.sandboxMode) {
      const sandboxColor = status.sandboxMode === 'strict' ? chalk.green : chalk.yellow
      console.log(`  Sandbox mode:  ${sandboxColor(status.sandboxMode)}`)
    }

    console.log()
  })

moltbotCmd
  .command('gateway')
  .description('Check Moltbot gateway status')
  .action(async () => {
    console.log()
    console.log(chalk.bold('Moltbot Gateway Status'))
    console.log()

    const gatewayStatus = await MoltbotHooks.getGatewayStatus()

    if (gatewayStatus.running) {
      console.log(`  Status:     ${chalk.green('running')}`)
      console.log(`  Host:       ${gatewayStatus.host}`)
      console.log(`  Port:       ${gatewayStatus.port}`)
      console.log(`  Sandbox:    ${gatewayStatus.sandboxMode ? chalk.green('enabled') : chalk.yellow('disabled')}`)
    } else {
      console.log(`  Status:     ${chalk.yellow('not running')}`)
      console.log(`  Expected:   ${gatewayStatus.host}:${gatewayStatus.port}`)
      if (gatewayStatus.error) {
        console.log(`  Error:      ${chalk.dim(gatewayStatus.error)}`)
      }
    }

    console.log()
  })

moltbotCmd
  .command('audit')
  .description('Run Moltbot security audit')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    console.log(chalk.dim('Running security audit...\n'))

    const result = await MoltbotHooks.runSecurityAudit()

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
      return
    }

    // Display results
    const statusIcon = result.passed ? chalk.green('✓') : chalk.red('✗')
    const statusText = result.passed ? chalk.green('PASSED') : chalk.red('FAILED')

    console.log(`${statusIcon} Security Audit: ${statusText}`)
    console.log()

    if (result.findings.length === 0) {
      console.log(chalk.dim('  No findings.'))
    } else {
      const severityColors: Record<string, (s: string) => string> = {
        critical: chalk.bgRed.white,
        warning: chalk.yellow,
        info: chalk.dim
      }

      for (const finding of result.findings) {
        const color = severityColors[finding.severity] || chalk.white
        console.log(`  ${color(`[${finding.severity.toUpperCase()}]`)} ${finding.message}`)
        console.log(chalk.dim(`    Category: ${finding.category}`))
        if (finding.recommendation) {
          console.log(chalk.dim(`    Fix: ${finding.recommendation}`))
        }
        console.log()
      }
    }

    console.log(chalk.dim(`Audit completed at ${result.timestamp.toLocaleString()}`))
    console.log()
  })

// ─────────────────────────────────────────────────────────────
// Agent Transparency Commands
// ─────────────────────────────────────────────────────────────

program
  .command('agent-info [agent]')
  .description('Show detailed info about installed agents and their configurations')
  .option('-r, --raw', 'Show raw (redacted) config contents')
  .action(async (agent, options) => {
    console.log(chalk.cyan(logo))

    if (agent) {
      // Show specific agent
      const validAgents = ['claude-code', 'moltbot', 'clawdbot', 'aider', 'gemini-cli', 'opencode']
      if (!validAgents.includes(agent)) {
        console.log(chalk.red(`Unknown agent: ${agent}`))
        console.log(chalk.dim(`Valid agents: ${validAgents.join(', ')}`))
        return
      }

      const info = await getAgentConfigInfo(agent as any)
      const { formatAgentInfo } = await import('./transparency/display.js')
      console.log()
      console.log(formatAgentInfo(info))

      // Show raw config if requested
      if (options.raw && info.configExists && info.configPath) {
        const { parseAgentConfig } = await import('./transparency/config-parser.js')
        const parsed = await parseAgentConfig(agent as any, info.configPath)
        if (parsed?.rawRedacted) {
          console.log()
          console.log(chalk.bold('Configuration (sensitive data redacted):'))
          console.log(formatRedactedConfig(parsed.rawRedacted))
        }
      }
    } else {
      // Show all agents
      const agents = await getAllAgentConfigs()
      console.log()
      console.log(formatAllAgentsInfo(agents))
    }
    console.log()
  })

program
  .command('permissions')
  .description('Show combined permissions view across bashbros and agents')
  .action(async () => {
    console.log(chalk.cyan(logo))

    const agents = await getAllAgentConfigs()
    const installed = agents.filter(a => a.installed)

    if (installed.length === 0) {
      console.log(chalk.yellow('No agents installed to compare permissions with.'))
      console.log(chalk.dim('Install an agent (claude, aider, etc.) to see combined permissions.'))
      return
    }

    console.log()
    console.log(formatPermissionsTable(agents))
    console.log()
  })

program
  .command('gate <command>')
  .description('Check if a command should be allowed (used by hooks)')
  .option('-y, --yes', 'Skip interactive prompt and block')
  .action(async (command, options) => {
    const result = await gateCommand(command)

    if (!result.allowed) {
      // If stdin is a TTY and not skipping prompt, ask user
      if (process.stdin.isTTY && !options.yes) {
        const { allowForSession } = await import('./session.js')
        const { readFileSync, writeFileSync } = await import('fs')
        const { parse, stringify } = await import('yaml')
        const { findConfig } = await import('./config.js')

        console.error()
        console.error(chalk.red('🛡️  BashBros blocked a command'))
        console.error()
        console.error(chalk.dim('  Command:'), command)
        console.error(chalk.dim('  Reason:'), result.reason)
        console.error()
        console.error(chalk.yellow('  Allow this command?'))
        console.error(chalk.cyan('    [y]'), 'Allow once')
        console.error(chalk.cyan('    [s]'), 'Allow for session')
        console.error(chalk.cyan('    [p]'), 'Allow permanently')
        console.error(chalk.cyan('    [n]'), 'Block (default)')
        process.stderr.write(chalk.dim('\n  Choice: '))

        // Read single character from stdin
        const choice = await new Promise<string>((resolve) => {
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(true)
          }
          process.stdin.resume()
          process.stdin.once('data', (data) => {
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(false)
            }
            const char = data.toString().toLowerCase()
            console.error(char)
            resolve(char)
          })
        })

        switch (choice) {
          case 'y':
            console.error(chalk.green('  ✓ Allowed once'))
            process.exit(0)
            break

          case 's':
            allowForSession(command)
            console.error(chalk.green('  ✓ Allowed for session'))
            process.exit(0)
            break

          case 'p':
            try {
              const configPath = findConfig()
              if (configPath) {
                const content = readFileSync(configPath, 'utf-8')
                const config = parse(content)
                if (!config.commands) config.commands = { allow: [], block: [] }
                if (!config.commands.allow) config.commands.allow = []
                if (!config.commands.allow.includes(command)) {
                  config.commands.allow.push(command)
                  writeFileSync(configPath, stringify(config))
                }
                console.error(chalk.green('  ✓ Added to allowlist permanently'))
                process.exit(0)
              }
            } catch {
              console.error(chalk.red('  ✗ Failed to update config'))
            }
            process.exit(2)
            break

          default:
            console.error(chalk.yellow('  ✗ Blocked'))
            process.exit(2)
        }
      } else {
        // Clean, minimal output for non-interactive use (hooks)
        console.error(`Blocked: ${result.reason}`)
        process.exit(2)
      }
    }

    // Silently allow
    process.exit(0)
  })

program
  .command('record-tool')
  .description('Record a Claude Code tool execution (used by hooks)')
  .option('--marker <marker>', 'Hook marker (ignored, used for identification)')
  .action(async () => {
    // Read JSON from CLAUDE_HOOK_EVENT environment variable
    const eventJson = process.env.CLAUDE_HOOK_EVENT || ''

    if (!eventJson) {
      // Silent exit - no event data
      return
    }

    try {
      const event = JSON.parse(eventJson)
      const events = Array.isArray(event) ? event : [event]

      const { DashboardWriter } = await import('./dashboard/writer.js')
      const writer = new DashboardWriter()

      for (const evt of events) {
        const toolName = evt.tool_name || evt.tool || 'unknown'
        const toolInput = evt.tool_input || evt.input || {}
        const toolOutput = evt.tool_output || evt.output || ''

        // Extract command/input based on tool type
        let inputStr: string
        if (typeof toolInput === 'string') {
          inputStr = toolInput
        } else if (typeof toolInput === 'object') {
          inputStr = JSON.stringify(toolInput, null, 2)
        } else {
          inputStr = String(toolInput)
        }

        // Extract output
        let outputStr: string
        let exitCode: number | null = null
        let success: boolean | null = null

        if (typeof toolOutput === 'object' && toolOutput !== null) {
          outputStr = (toolOutput.stdout || '') + (toolOutput.stderr || '')
          exitCode = toolOutput.exit_code ?? toolOutput.exitCode ?? null
          if (exitCode !== null) {
            success = exitCode === 0
          }
        } else {
          outputStr = String(toolOutput || '')
        }

        // Get repo info if available
        const repoName = evt.repo?.name ?? null
        const repoPath = evt.repo?.path ?? null

        writer.recordToolUse({
          toolName,
          toolInput: inputStr,
          toolOutput: outputStr,
          exitCode,
          success,
          cwd: evt.cwd || process.cwd(),
          repoName,
          repoPath
        })

        // Minimal output for hook
        const preview = inputStr.substring(0, 40).replace(/\n/g, ' ')
        console.log(`[BashBros] ${toolName}: ${preview}${inputStr.length > 40 ? '...' : ''}`)
      }

      writer.close()
    } catch (e) {
      // Silent fail for hooks
      console.error(`[BashBros] Error recording tool: ${e instanceof Error ? e.message : e}`)
    }
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

// ─────────────────────────────────────────────────────────────
// Dashboard Commands
// ─────────────────────────────────────────────────────────────

let dashboardServer: DashboardServer | null = null

program
  .command('dashboard')
  .description('Start the BashBros dashboard')
  .option('-p, --port <port>', 'Port to run on', '7890')
  .option('-b, --bind <address>', 'Address to bind to', '127.0.0.1')
  .action(async (options) => {
    console.log(chalk.cyan(logo))
    console.log(chalk.dim('  Starting dashboard...\n'))

    dashboardServer = new DashboardServer({
      port: parseInt(options.port),
      bind: options.bind
    })

    await dashboardServer.start()
    console.log(chalk.green('✓'), `Dashboard running at http://${options.bind}:${options.port}`)
    console.log(chalk.dim('  Press Ctrl+C to stop'))

    // Keep process alive
    process.on('SIGINT', async () => {
      console.log(chalk.dim('\n  Stopping dashboard...'))
      await dashboardServer?.stop()
      process.exit(0)
    })
  })

// ─────────────────────────────────────────────────────────────
// Ward Commands
// ─────────────────────────────────────────────────────────────

const wardCmd = program
  .command('ward')
  .description('Network and connector security')

wardCmd
  .command('status')
  .description('Show ward security status')
  .action(async () => {
    console.log(chalk.cyan(logo))
    console.log(chalk.bold('Ward Security Status\n'))

    const scanner = new ExposureScanner()
    const results = await scanner.scan()

    if (results.length === 0) {
      console.log(chalk.green('✓'), 'No exposed agent servers detected')
    } else {
      console.log(chalk.yellow('⚠'), `Found ${results.length} exposure(s):\n`)
      for (const r of results) {
        const color = r.severity === 'critical' ? chalk.bgRed.white :
                      r.severity === 'high' ? chalk.red :
                      r.severity === 'medium' ? chalk.yellow :
                      chalk.dim
        console.log(`  ${color(r.severity.toUpperCase().padEnd(8))} ${r.message}`)
      }
    }
    console.log()
  })

wardCmd
  .command('scan')
  .description('Run exposure scan')
  .action(async () => {
    console.log(chalk.cyan(logo))
    console.log(chalk.dim('  Scanning for exposed agent servers...\n'))

    const scanner = new ExposureScanner()
    const results = await scanner.scan()

    if (results.length === 0) {
      console.log(chalk.green('✓'), 'No exposed agent servers detected')
    } else {
      for (const r of results) {
        const icon = r.severity === 'critical' ? '🚨' :
                     r.severity === 'high' ? '⚠️' :
                     r.severity === 'medium' ? '⚡' : 'ℹ️'

        console.log(`${icon} ${r.agent}`)
        console.log(chalk.dim(`   Port: ${r.port}`))
        console.log(chalk.dim(`   Bind: ${r.bindAddress}`))
        console.log(chalk.dim(`   Auth: ${r.hasAuth}`))
        console.log(chalk.dim(`   Severity: ${r.severity}`))
        console.log(chalk.dim(`   Action: ${r.action}`))
        console.log()
      }
    }
  })

const exposureCmd = wardCmd
  .command('exposure')
  .description('Exposure scanner commands')

exposureCmd
  .command('list')
  .description('List monitored agents')
  .action(() => {
    const scanner = new ExposureScanner()
    const agents = scanner.getAgents()

    console.log(chalk.bold('\nMonitored Agent Signatures:\n'))
    for (const agent of agents) {
      console.log(`  ${chalk.cyan(agent.name)}`)
      console.log(chalk.dim(`    Processes: ${agent.processNames.join(', ')}`))
      console.log(chalk.dim(`    Ports: ${agent.defaultPorts.join(', ')}`))
      console.log()
    }
  })

exposureCmd
  .command('scan')
  .description('Run immediate exposure scan')
  .action(async () => {
    const scanner = new ExposureScanner()
    const results = await scanner.scan()

    console.log(chalk.bold('\nExposure Scan Results:\n'))

    if (results.length === 0) {
      console.log(chalk.green('  ✓ No exposures detected'))
    } else {
      for (const r of results) {
        const color = r.severity === 'critical' ? chalk.bgRed.white :
                      r.severity === 'high' ? chalk.red :
                      r.severity === 'medium' ? chalk.yellow : chalk.green
        console.log(`  ${color(r.severity.toUpperCase().padEnd(10))} ${r.message}`)
      }
    }
    console.log()
  })

wardCmd
  .command('blocked')
  .description('Show pending blocked egress items')
  .action(() => {
    const monitor = new EgressMonitor()
    const pending = monitor.getPendingBlocks()

    console.log(chalk.bold('\nPending Egress Blocks:\n'))

    if (pending.length === 0) {
      console.log(chalk.dim('  No pending blocks'))
    } else {
      for (const block of pending) {
        const severityColor = block.pattern.severity === 'critical' ? chalk.bgRed.white :
                              block.pattern.severity === 'high' ? chalk.red :
                              block.pattern.severity === 'medium' ? chalk.yellow : chalk.dim
        console.log(`  ${chalk.cyan(block.id)} ${severityColor(block.pattern.severity.toUpperCase())}`)
        console.log(chalk.dim(`    Pattern: ${block.pattern.name} (${block.pattern.category})`))
        console.log(chalk.dim(`    Matched: ${block.matchedText.substring(0, 50)}${block.matchedText.length > 50 ? '...' : ''}`))
        if (block.connector) console.log(chalk.dim(`    Connector: ${block.connector}`))
        if (block.destination) console.log(chalk.dim(`    Destination: ${block.destination}`))
        console.log()
      }
      console.log(chalk.dim(`  Use 'bashbros ward approve <id>' or 'bashbros ward deny <id>' to resolve`))
    }
    console.log()
  })

wardCmd
  .command('approve <id>')
  .description('Approve a blocked egress item')
  .option('--by <name>', 'Name of approver', 'user')
  .action((id, options) => {
    const monitor = new EgressMonitor()
    monitor.approveBlock(id, options.by)
    console.log(chalk.green('✓'), `Approved block ${id}`)
  })

wardCmd
  .command('deny <id>')
  .description('Deny a blocked egress item')
  .action((id) => {
    const monitor = new EgressMonitor()
    monitor.denyBlock(id)
    console.log(chalk.green('✓'), `Denied block ${id}`)
  })

const patternsCmd = wardCmd
  .command('patterns')
  .description('Egress pattern detection commands')

patternsCmd
  .command('list')
  .description('List active detection patterns')
  .option('--category <cat>', 'Filter by category (credentials, pii)')
  .action((options) => {
    const matcher = new EgressPatternMatcher()
    let patterns = matcher.getPatterns()

    if (options.category) {
      patterns = patterns.filter(p => p.category === options.category)
    }

    console.log(chalk.bold('\nActive Egress Patterns:\n'))

    const byCategory: Record<string, typeof patterns> = {}
    for (const p of patterns) {
      const cat = p.category
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(p)
    }

    for (const [category, categoryPatterns] of Object.entries(byCategory)) {
      console.log(chalk.cyan(`  ${category.toUpperCase()}`))
      for (const p of categoryPatterns) {
        const severityColor = p.severity === 'critical' ? chalk.red :
                              p.severity === 'high' ? chalk.yellow :
                              p.severity === 'medium' ? chalk.blue : chalk.dim
        const actionColor = p.action === 'block' ? chalk.red :
                           p.action === 'alert' ? chalk.yellow : chalk.dim
        console.log(`    ${chalk.bold(p.name.padEnd(16))} ${severityColor(p.severity.padEnd(10))} ${actionColor(p.action.padEnd(6))} ${p.description}`)
      }
      console.log()
    }
  })

patternsCmd
  .command('test <text>')
  .description('Test if text matches any detection pattern')
  .action((text) => {
    const monitor = new EgressMonitor()
    const result = monitor.test(text)

    console.log(chalk.bold('\nPattern Test Results:\n'))

    if (result.matches.length === 0) {
      console.log(chalk.green('  ✓ No patterns matched'))
    } else {
      console.log(`  ${result.blocked ? chalk.red('WOULD BLOCK') : chalk.yellow('WOULD ALERT')}`)
      console.log()
      console.log(chalk.bold('  Matches:'))
      for (const m of result.matches) {
        const severityColor = m.pattern.severity === 'critical' ? chalk.red :
                              m.pattern.severity === 'high' ? chalk.yellow :
                              m.pattern.severity === 'medium' ? chalk.blue : chalk.dim
        console.log(`    ${chalk.cyan(m.pattern.name)} ${severityColor(`[${m.pattern.severity}]`)} - "${m.matchedText.substring(0, 30)}${m.matchedText.length > 30 ? '...' : ''}"`)
      }
      console.log()
      console.log(chalk.bold('  Redacted output:'))
      console.log(chalk.dim(`    ${result.redacted.substring(0, 100)}${result.redacted.length > 100 ? '...' : ''}`))
    }
    console.log()
  })

program.parse()
