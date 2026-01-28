# @bashbros/moltbot-sync

Sync [BashBros](https://github.com/GhostPeony/bashbros) security policies to [Moltbot](https://molt.bot) exec-approvals.

## Why?

Moltbot has its own exec-approvals system with allowlists. This package syncs your BashBros `commands.allow` patterns to Moltbot's `exec-approvals.json`, so you can manage security policies in one place.

## Install

```bash
npm install -g @bashbros/moltbot-sync
```

## Usage

### CLI

```bash
# Sync bashbros allow patterns to moltbot
bashbros-moltbot-sync sync

# Preview what would change
bashbros-moltbot-sync sync --dry-run

# Check current status
bashbros-moltbot-sync status

# List moltbot allowlist
bashbros-moltbot-sync list

# Add a single pattern
bashbros-moltbot-sync add "git *"

# Remove a pattern
bashbros-moltbot-sync remove "rm -rf *"

# Clear all patterns
bashbros-moltbot-sync clear
```

### API

```typescript
import { MoltbotSync, syncPolicies, getSyncStatus } from '@bashbros/moltbot-sync'

// Quick sync
const result = syncPolicies()
console.log(result.added)    // Patterns added
console.log(result.removed)  // Patterns removed

// With options
const result2 = syncPolicies({
  bashbrosConfig: './.bashbros.yml',
  agent: 'main',
  dryRun: true,
  merge: true  // Merge with existing (default) vs replace
})

// Class-based usage
const sync = new MoltbotSync({ agent: 'main' })
sync.addPattern('docker *')
sync.removePattern('sudo *')
sync.sync()

// Check status
const status = getSyncStatus()
console.log(status.allowlist)
```

## How It Works

1. Reads your `.bashbros.yml` config
2. Extracts `commands.allow` patterns
3. Converts them to Moltbot glob format
4. Writes to `~/.clawdbot/exec-approvals.json`

### Pattern Conversion

| BashBros | Moltbot |
|----------|---------|
| `git *` | `git *` |
| `npm *` | `npm *` |
| `/usr/bin/node` | `/usr/bin/node` |

Most patterns work as-is since both support glob syntax.

## Configuration

### BashBros Config

```yaml
# .bashbros.yml
commands:
  allow:
    - git *
    - npm *
    - node *
    - docker *
```

### Moltbot Output

```json
// ~/.clawdbot/exec-approvals.json
{
  "version": 1,
  "agents": {
    "main": {
      "allowlist": ["docker *", "git *", "node *", "npm *"]
    }
  }
}
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--dry-run` | Preview changes without writing | `false` |
| `--no-merge` | Replace allowlist instead of merging | `false` |
| `--agent <name>` | Target moltbot agent | `main` |
| `--config <path>` | Path to bashbros config | auto-detect |

## Related

- [bashbros](https://github.com/GhostPeony/bashbros) - Security middleware for CLI agents
- [@bashbros/moltbot-audit](https://github.com/GhostPeony/bashbros/tree/main/packages/moltbot-audit) - Post-execution audit hook for Moltbot
- [Moltbot](https://molt.bot) - Multi-platform AI gateway

## License

MIT
