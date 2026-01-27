# /BashBros

```
  ╱BashBros ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🤝 Your Friendly Bash Agent Helper
```

> "I watch your agent's back so you don't have to."

BashBros is a PTY middleware that protects your CLI agents (Claude Code, Clawdbot, Gemini CLI, Aider, OpenCode, and more) from running dangerous commands.

## Features

- **Command filtering** - Allow/block commands by pattern
- **Path sandboxing** - Restrict filesystem access
- **Secrets protection** - Block access to .env, credentials, SSH keys
- **Audit logging** - Full command history for debugging and compliance
- **Rate limiting** - Prevent runaway agents from going wild

## Quick Start

```bash
# Install
npm install -g bashbros

# Set up for your project
bashbros init

# Start protection
bashbros watch
```

## How It Works

BashBros sits between your agent and the shell as a PTY (pseudo-terminal) layer. Commands flow through BashBros, which validates them against your security policies before execution.

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────┐
│  Any Agent   │────▶│  BashBros PTY Layer │────▶│  Shell   │
│              │◀────│  (validate & log)   │◀────│          │
└──────────────┘     └─────────────────────┘     └──────────┘
```

## Commands

| Command | Description |
|---------|-------------|
| `bashbros init` | Interactive setup wizard |
| `bashbros watch` | Start protection |
| `bashbros doctor` | Check configuration |
| `bashbros allow <cmd>` | Allow a specific command |
| `bashbros audit` | View command history |

## Configuration

BashBros creates a `.bashbros.yml` in your project:

```yaml
agent: claude-code
profile: balanced

commands:
  allow:
    - git *
    - npm *
    - node *
  block:
    - rm -rf /
    - curl * | bash

paths:
  allow:
    - .
  block:
    - ~/.ssh
    - ~/.aws

secrets:
  enabled: true
  mode: block
  patterns:
    - .env*
    - "*.pem"
    - "*.key"

audit:
  enabled: true
  destination: local

rateLimit:
  enabled: true
  maxPerMinute: 100
  maxPerHour: 1000
```

## Security Profiles

| Profile | Description |
|---------|-------------|
| **balanced** | Block dangerous commands, allow common dev tools |
| **strict** | Allowlist only, explicit approval required |
| **permissive** | Log everything, block only critical threats |
| **custom** | Full manual configuration |

## When a Command is Blocked

```
🛡️ BashBros blocked this command

  Reason: Destructive command pattern matched
  Policy: command_filter.block[0]

  To allow this command:
    bashbros allow "rm -rf /" --once
    bashbros allow "rm -rf /" --persist

  Logged to: ~/.bashbros/audit.log
```

## Works With

- [Claude Code](https://claude.ai/claude-code)
- [Clawdbot](https://clawd.bot)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Aider](https://aider.chat)
- [OpenCode](https://github.com/opencode-ai/opencode)
- Any CLI agent that uses bash/shell

## License

MIT - see [LICENSE](LICENSE)

## Links

- Website: [bashbros.ai](https://bashbros.ai)
- GitHub: [github.com/GhostPeony/bashbros](https://github.com/GhostPeony/bashbros)
