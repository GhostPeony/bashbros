#!/usr/bin/env node
/**
 * CLI for @bashbros/moltbot-sync
 */

import { MoltbotSync, getSyncStatus } from './sync.js'

const args = process.argv.slice(2)
const command = args[0]

function printHelp() {
  console.log(`
@bashbros/moltbot-sync - Sync BashBros policies to Moltbot

Usage:
  bashbros-moltbot-sync <command> [options]

Commands:
  sync              Sync bashbros allow patterns to moltbot exec-approvals
  status            Show current sync status
  add <pattern>     Add a pattern to moltbot allowlist
  remove <pattern>  Remove a pattern from moltbot allowlist
  list              List current moltbot allowlist
  clear             Clear all patterns from allowlist

Options:
  --dry-run         Show what would change without writing
  --no-merge        Replace allowlist instead of merging
  --agent <name>    Target agent (default: main)
  --config <path>   Path to bashbros config
  -h, --help        Show this help

Examples:
  bashbros-moltbot-sync sync
  bashbros-moltbot-sync sync --dry-run
  bashbros-moltbot-sync add "git *"
  bashbros-moltbot-sync remove "rm -rf *"
  bashbros-moltbot-sync status
`)
}

function parseOptions(args: string[]): Record<string, string | boolean> {
  const options: Record<string, string | boolean> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--no-merge') {
      options.merge = false
    } else if (arg === '--agent' && args[i + 1]) {
      options.agent = args[++i]
    } else if (arg === '--config' && args[i + 1]) {
      options.config = args[++i]
    }
  }

  return options
}

async function main() {
  if (!command || command === '-h' || command === '--help') {
    printHelp()
    process.exit(0)
  }

  const options = parseOptions(args.slice(1))
  const sync = new MoltbotSync({
    agent: options.agent as string,
    moltbotDir: undefined // Use default
  })

  switch (command) {
    case 'sync': {
      const result = sync.sync({
        dryRun: options.dryRun as boolean,
        merge: options.merge as boolean,
        bashbrosConfig: options.config as string
      })

      if (result.success) {
        console.log(`✓ ${result.message}`)
        if (result.added.length > 0) {
          console.log(`\nAdded:`)
          result.added.forEach(p => console.log(`  + ${p}`))
        }
        if (result.removed.length > 0) {
          console.log(`\nRemoved:`)
          result.removed.forEach(p => console.log(`  - ${p}`))
        }
        console.log(`\nApprovals file: ${result.approvalsPath}`)
      } else {
        console.error(`✗ ${result.message}`)
        process.exit(1)
      }
      break
    }

    case 'status': {
      const status = getSyncStatus({ agent: options.agent as string })
      console.log(`\nMoltbot Sync Status`)
      console.log(`  Config dir:     ${status.moltbotDir}`)
      console.log(`  Approvals file: ${status.approvalsPath}`)
      console.log(`  Exists:         ${status.approvalsExist ? 'yes' : 'no'}`)
      console.log(`  Allowlist:      ${status.allowlistCount} patterns`)
      console.log()
      break
    }

    case 'list': {
      const status = getSyncStatus({ agent: options.agent as string })
      if (status.allowlist.length === 0) {
        console.log('No patterns in allowlist.')
      } else {
        console.log(`Allowlist (${status.allowlistCount} patterns):`)
        status.allowlist.forEach(p => console.log(`  ${p}`))
      }
      break
    }

    case 'add': {
      const pattern = args[1]
      if (!pattern) {
        console.error('Error: pattern required')
        console.error('Usage: bashbros-moltbot-sync add <pattern>')
        process.exit(1)
      }
      const result = sync.addPattern(pattern)
      console.log(`✓ ${result.message}`)
      break
    }

    case 'remove': {
      const pattern = args[1]
      if (!pattern) {
        console.error('Error: pattern required')
        console.error('Usage: bashbros-moltbot-sync remove <pattern>')
        process.exit(1)
      }
      const result = sync.removePattern(pattern)
      console.log(`✓ ${result.message}`)
      break
    }

    case 'clear': {
      const result = sync.clear()
      console.log(`✓ ${result.message}`)
      break
    }

    default:
      console.error(`Unknown command: ${command}`)
      printHelp()
      process.exit(1)
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
