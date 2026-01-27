import { Command } from 'commander'
import chalk from 'chalk'
import { runOnboarding } from './onboarding.js'
import { runDoctor } from './doctor.js'
import { startWatch } from './watch.js'
import { handleAllow } from './allow.js'

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

program.parse()
