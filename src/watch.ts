import chalk from 'chalk'
import { BashBros } from './core.js'
import { findConfig } from './config.js'

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

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log()
    console.log(chalk.yellow('Stopping BashBros...'))
    bashbros.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    bashbros.stop()
    process.exit(0)
  })

  bashbros.start()

  // Keep process alive
  await new Promise(() => {})
}
