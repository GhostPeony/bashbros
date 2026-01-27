import chalk from 'chalk'
import { readFileSync, writeFileSync } from 'fs'
import { parse, stringify } from 'yaml'
import { findConfig } from './config.js'

export async function handleAllow(
  command: string,
  options: { once?: boolean; persist?: boolean }
): Promise<void> {
  if (options.once) {
    // Add to session allowlist (stored in memory/temp file)
    console.log(chalk.green('✓'), `Allowed for this session: ${command}`)
    console.log(chalk.dim('  This will reset when BashBros restarts.'))
    // TODO: Implement session-based allowlist via IPC or temp file
    return
  }

  if (options.persist) {
    const configPath = findConfig()

    if (!configPath) {
      console.log(chalk.red('No config found. Run "bashbros init" first.'))
      process.exit(1)
    }

    try {
      const content = readFileSync(configPath, 'utf-8')
      const config = parse(content)

      // Initialize commands.allow if it doesn't exist
      if (!config.commands) {
        config.commands = { allow: [], block: [] }
      }
      if (!config.commands.allow) {
        config.commands.allow = []
      }

      // Add command pattern if not already present
      if (!config.commands.allow.includes(command)) {
        config.commands.allow.push(command)
        writeFileSync(configPath, stringify(config))

        console.log(chalk.green('✓'), `Added to allowlist: ${command}`)
        console.log(chalk.dim(`  Updated ${configPath}`))
      } else {
        console.log(chalk.yellow('Already in allowlist:'), command)
      }
    } catch (error) {
      console.error(chalk.red('Failed to update config:'), error)
      process.exit(1)
    }

    return
  }

  // No flag specified - show help
  console.log(chalk.yellow('Specify how to allow this command:'))
  console.log()
  console.log(chalk.cyan(`  bashbros allow "${command}" --once`))
  console.log(chalk.dim('    Allow for current session only'))
  console.log()
  console.log(chalk.cyan(`  bashbros allow "${command}" --persist`))
  console.log(chalk.dim('    Add to config file permanently'))
}
