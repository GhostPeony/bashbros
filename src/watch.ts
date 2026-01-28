import chalk from 'chalk'
import { readFileSync, writeFileSync } from 'fs'
import { parse, stringify } from 'yaml'
import { BashBros } from './core.js'
import { findConfig } from './config.js'
import { allowForSession } from './session.js'
import { DashboardWriter } from './dashboard/writer.js'
import { RiskScorer, type RiskScore } from './policy/risk-scorer.js'

// Dashboard writer and risk scorer for monitoring
let dashboardWriter: DashboardWriter | null = null
let riskScorer: RiskScorer | null = null

function cleanup(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false)
  }
}

export async function startWatch(options: { verbose?: boolean }): Promise<void> {
  const configPath = findConfig()

  if (!configPath) {
    console.log(chalk.red('No config found. Run "bashbros init" first.'))
    process.exit(1)
  }

  console.log(chalk.dim('  "I watch your agent\'s back so you don\'t have to."'))
  console.log()
  console.log(chalk.green('✓'), 'Protection active')
  console.log(chalk.dim(`  Config: ${configPath}`))
  console.log(chalk.dim('  Press Ctrl+C to stop'))
  console.log()

  const bashbros = new BashBros(configPath)
  const config = bashbros.getConfig()

  // Initialize dashboard writer and risk scorer
  try {
    dashboardWriter = new DashboardWriter()
    riskScorer = new RiskScorer()

    // Start a new session
    const sessionId = dashboardWriter.startSession(config.agent, process.cwd())
    if (options.verbose) {
      console.log(chalk.dim(`  Session: ${sessionId}`))
    }
  } catch (error) {
    // Dashboard writing is non-critical, continue without it
    if (options.verbose) {
      console.log(chalk.yellow('  Dashboard recording disabled'))
    }
  }

  // State for interactive prompt when command is blocked
  let pendingCommand: string | null = null
  let awaitingPromptResponse = false

  function showBlockedPrompt(command: string, violations: { message: string; rule: string }[]): void {
    pendingCommand = command
    awaitingPromptResponse = true

    console.log()
    console.log(chalk.red('🛡️  BashBros blocked a command'))
    console.log()
    console.log(chalk.dim('  Command:'), command)
    console.log(chalk.dim('  Reason:'), violations[0].message)
    console.log(chalk.dim('  Policy:'), violations[0].rule)
    console.log()
    console.log(chalk.yellow('  Allow this command?'))
    console.log(chalk.cyan('    [y]'), 'Allow once')
    console.log(chalk.cyan('    [s]'), 'Allow for session')
    console.log(chalk.cyan('    [p]'), 'Allow permanently')
    console.log(chalk.cyan('    [n]'), 'Block (default)')
    process.stdout.write(chalk.dim('\n  Choice: '))
  }

  function handlePromptResponse(choice: string): void {
    if (!pendingCommand) return

    const command = pendingCommand
    pendingCommand = null
    awaitingPromptResponse = false

    console.log(choice) // Echo the choice

    switch (choice.toLowerCase()) {
      case 'y':
        // Allow once - just execute, no persistence
        console.log(chalk.green('  ✓ Allowed once'))
        console.log()
        bashbros.write(command + '\r')
        break

      case 's':
        // Allow for session
        allowForSession(command)
        console.log(chalk.green('  ✓ Allowed for session'))
        console.log()
        bashbros.write(command + '\r')
        break

      case 'p':
        // Allow permanently - update config file
        try {
          const content = readFileSync(configPath, 'utf-8')
          const config = parse(content)

          if (!config.commands) {
            config.commands = { allow: [], block: [] }
          }
          if (!config.commands.allow) {
            config.commands.allow = []
          }

          if (!config.commands.allow.includes(command)) {
            config.commands.allow.push(command)
            writeFileSync(configPath, stringify(config))
          }

          console.log(chalk.green('  ✓ Added to allowlist permanently'))
          console.log()
          bashbros.write(command + '\r')
        } catch (error) {
          console.log(chalk.red('  ✗ Failed to update config'))
          console.log()
        }
        break

      case 'n':
      default:
        // Keep blocked
        console.log(chalk.yellow('  ✗ Blocked'))
        console.log()
        break
    }
  }

  bashbros.on('blocked', (command, violations) => {
    // Record blocked command to dashboard
    if (dashboardWriter && riskScorer) {
      const risk = riskScorer.score(command)
      dashboardWriter.recordCommand(command, false, risk, violations, 0)
    }
    showBlockedPrompt(command, violations)
  })

  bashbros.on('allowed', (result) => {
    // Record allowed command to dashboard
    if (dashboardWriter && riskScorer) {
      const risk = riskScorer.score(result.command)
      dashboardWriter.recordCommand(result.command, true, risk, [], result.duration)
    }
    if (options.verbose) {
      console.log(chalk.green('✓'), chalk.dim(result.command))
    }
  })

  bashbros.on('output', (data) => {
    process.stdout.write(data)
  })

  bashbros.on('error', (error) => {
    console.error(chalk.red('Error:'), error.message)
  })

  // Handle PTY exit
  bashbros.on('exit', (exitCode) => {
    // End dashboard session
    if (dashboardWriter) {
      dashboardWriter.endSession()
      dashboardWriter.close()
    }
    cleanup()
    process.exit(exitCode ?? 0)
  })

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    cleanup()
    console.log()
    console.log(chalk.yellow('Stopping BashBros...'))

    // End dashboard session
    if (dashboardWriter) {
      dashboardWriter.endSession()
      dashboardWriter.close()
    }

    bashbros.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    cleanup()

    // End dashboard session
    if (dashboardWriter) {
      dashboardWriter.endSession()
      dashboardWriter.close()
    }

    bashbros.stop()
    process.exit(0)
  })

  // Handle unexpected crashes
  process.on('uncaughtException', (error) => {
    console.error(chalk.red('Unexpected error:'), error.message)

    // Mark session as crashed
    if (dashboardWriter) {
      dashboardWriter.crashSession()
      dashboardWriter.close()
    }

    cleanup()
    bashbros.stop()
    process.exit(1)
  })

  bashbros.start()

  // Command buffer for validation
  let commandBuffer = ''

  // Set initial PTY size to match terminal
  if (process.stdout.isTTY) {
    bashbros.resize(process.stdout.columns, process.stdout.rows)
  }

  // Handle terminal resize
  process.stdout.on('resize', () => {
    if (process.stdout.isTTY) {
      bashbros.resize(process.stdout.columns, process.stdout.rows)
    }
  })

  // Enable raw mode for character-by-character input
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }
  process.stdin.resume()

  // Handle stdin with command interception
  process.stdin.on('data', (data) => {
    const str = data.toString()

    for (const char of str) {
      const code = char.charCodeAt(0)

      // If awaiting prompt response, handle it separately
      if (awaitingPromptResponse) {
        if (code === 3) {
          // Ctrl+C cancels the prompt
          pendingCommand = null
          awaitingPromptResponse = false
          console.log(chalk.yellow('Cancelled'))
          console.log()
        } else if (char === '\r' || char === '\n') {
          // Enter with no choice = block (default)
          handlePromptResponse('n')
        } else if (code >= 32) {
          // Letter response
          handlePromptResponse(char)
        }
        continue
      }

      // Enter key - validate command before allowing execution
      if (char === '\r' || char === '\n') {
        const command = commandBuffer.trim()
        commandBuffer = ''

        if (command) {
          // Validate the command (don't use execute() - command is already in PTY buffer)
          const violations = bashbros.validateOnly(command)

          if (violations.length > 0) {
            // Blocked - clear the line and emit blocked event
            bashbros.write('\x15')  // Ctrl+U to clear line
            bashbros.write('\r')    // New line
            bashbros.emit('blocked', command, violations)
          } else {
            // Allowed - just send Enter to execute the already-typed command
            bashbros.write('\r')
          }
        } else {
          // Empty command (just Enter) - pass through
          bashbros.write('\r')
        }
      }
      // Backspace/Delete - remove from buffer
      else if (code === 127 || code === 8) {
        if (commandBuffer.length > 0) {
          commandBuffer = commandBuffer.slice(0, -1)
        }
        bashbros.write(char)
      }
      // Escape sequence start
      else if (code === 27) {
        // Pass through escape sequences
        bashbros.write(char)
      }
      // Ctrl+C - clear buffer
      else if (code === 3) {
        commandBuffer = ''
        bashbros.write(char)
      }
      // Ctrl+U (clear line)
      else if (code === 21) {
        commandBuffer = ''
        bashbros.write(char)
      }
      // Regular character - add to buffer and forward
      else if (code >= 32 || char === '\t') {
        commandBuffer += char
        bashbros.write(char)
      }
      // Other control characters - pass through
      else {
        bashbros.write(char)
      }
    }
  })

  // Keep process alive
  await new Promise(() => {})
}
