import chalk from 'chalk'
import { BashBros } from './core.js'
import { findConfig } from './config.js'

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

  bashbros.on('blocked', (command, violations) => {
    console.log()
    console.log(chalk.red('🛡️  BashBros blocked a command'))
    console.log()
    console.log(chalk.dim('  Command:'), command)
    console.log(chalk.dim('  Reason:'), violations[0].message)
    console.log(chalk.dim('  Policy:'), violations[0].rule)
    console.log()
    console.log(chalk.dim('  To allow this command:'))
    console.log(chalk.cyan(`    bashbros allow "${command}" --once`))
    console.log(chalk.cyan(`    bashbros allow "${command}" --persist`))
    console.log()
  })

  bashbros.on('allowed', (result) => {
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
    cleanup()
    process.exit(exitCode ?? 0)
  })

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    cleanup()
    console.log()
    console.log(chalk.yellow('Stopping BashBros...'))
    bashbros.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    cleanup()
    bashbros.stop()
    process.exit(0)
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

      // Enter key - validate and execute command
      if (char === '\r' || char === '\n') {
        const command = commandBuffer.trim()
        commandBuffer = ''

        if (command) {
          // Use execute() which validates then writes to PTY
          bashbros.execute(command)
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
