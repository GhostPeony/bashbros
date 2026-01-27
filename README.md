# /BashBros
![bashbros](https://github.com/user-attachments/assets/6f674f48-cb63-4cb3-9b26-fdad6ac653b8)

```
       /____            _     ____
      /| __ )  __ _ ___| |__ | __ ) _ __ ___  ___
     / |  _ \ / _` / __| '_ \|  _ \| '__/ _ \/ __|
    /  | |_) | (_| \__ \ | | | |_) | | | (_) \__ \
   /   |____/ \__,_|___/_| |_|____/|_|  \___/|___/
  🤝 Your Friendly Bash Agent Helper
```

BashBros protects CLI agents with security middleware AND supercharges them with an AI sidekick that knows your system.

## Install

```bash
npm install -g bashbros
```

## Quick Start

```bash
bashbros init      # Interactive setup
bashbros scan      # Learn your system
bashbros watch     # Start protection
```

## Features

### Security (5 modules)
- **Command filter** - Allow/block by pattern
- **Path sandbox** - Restrict filesystem access
- **Secrets guard** - Block .env, keys, credentials
- **Audit log** - Full command history
- **Rate limiter** - Prevent runaway agents

### AI Sidekick (Ollama)
- **System awareness** - Knows your tools, versions, project type
- **Task routing** - Simple → local model, complex → main agent
- **Suggestions** - Context-aware next commands
- **Background tasks** - Tests/builds run in parallel

## Commands

### Security

| Command | Description |
|---------|-------------|
| `init` | Setup wizard |
| `watch` | Start protection |
| `doctor` | Check config |
| `allow <cmd>` | Allow command (`--once` for session only) |
| `audit` | View history (`--violations` for blocked only) |

### Bash Bro

| Command | Description |
|---------|-------------|
| `scan` | Scan system and project |
| `status` | Show system info |
| `suggest` | Get command suggestions |
| `route <cmd>` | Check routing decision |
| `run <cmd>` | Execute via Bash Bro (`-b` for background) |
| `tasks` | List background tasks |

### AI (requires Ollama)

| Command | Description |
|---------|-------------|
| `explain <cmd>` | Explain what a command does |
| `fix <cmd>` | Fix a failed command (`-e` for error message) |
| `ai <prompt>` | Ask anything |
| `script <desc>` | Generate shell script (`-o` to save) |
| `safety <cmd>` | Analyze security risks |
| `help-ai <topic>` | Get help on any topic |
| `do <desc>` | Natural language → command (`-x` to execute) |
| `models` | List available Ollama models |

## Examples

```bash
# Route a command
$ bashbros route "git status"
🤝 Route: Bash Bro (90% confidence)

# Generate a script
$ bashbros script "backup all .env files"
#!/bin/bash
find . -name "*.env" -exec cp {} {}.backup \;

# Natural language to command
$ bashbros do "find large files over 100mb"
$ find . -size +100M -type f

# Explain a command
$ bashbros explain "tar -czvf archive.tar.gz dir/"
Creates a compressed gzip archive of dir/

# Check command safety
$ bashbros safety "rm -rf /"
⚠ Risk Level: CRITICAL
  This command will delete all files...
```

## Configuration

`.bashbros.yml`:

```yaml
agent: claude-code  # or clawdbot, aider, opencode, custom
profile: balanced   # strict, permissive, or custom

commands:
  allow: [git *, npm *, node *]
  block: [rm -rf /, curl * | bash]

paths:
  allow: [.]
  block: [~/.ssh, ~/.aws]

secrets:
  enabled: true
  mode: block
  patterns: [.env*, "*.pem", "*.key"]

audit:
  enabled: true
  destination: local

rateLimit:
  enabled: true
  maxPerMinute: 100
  maxPerHour: 1000
```

## Security Profiles

| Profile | Behavior |
|---------|----------|
| `balanced` | Block dangerous, allow common dev tools |
| `strict` | Allowlist only, explicit approval |
| `permissive` | Log all, block critical threats only |

## Works With

- [Claude Code](https://claude.ai/claude-code)
- [Clawdbot](https://clawd.bot)
- [Aider](https://aider.chat)
- [OpenCode](https://github.com/opencode-ai/opencode)
- [Ollama](https://ollama.ai) (local AI)
- Any CLI agent using bash/shell

## API Usage

```typescript
import { BashBros, PolicyEngine, BashBro } from 'bashbros'

// Security middleware
const bros = new BashBros(config)
bros.on('command', (cmd, result) => console.log(cmd, result.allowed))
bros.start()

// AI features
const bro = new BashBro()
await bro.initialize()
const suggestions = bro.suggest({ lastCommand: 'git status' })
const explanation = await bro.aiExplain('tar -xzf file.tar.gz')
```

## Development

```bash
npm install
npm run build
npm test        # 165 tests
```

## License

MIT

## Links

- [bashbros.ai](https://bashbros.ai)
- [GitHub](https://github.com/GhostPeony/bashbros)
