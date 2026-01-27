# /BashBros

```
  ╱BashBros ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🤝 Your Friendly Bash Agent Helper
```

> "I watch your agent's back so you don't have to."

BashBros is a PTY middleware that protects your CLI agents AND supercharges them with a trained AI sidekick that knows your system inside-out.

## Features

### Security Layer
- **Command filtering** - Allow/block commands by pattern
- **Path sandboxing** - Restrict filesystem access
- **Secrets protection** - Block access to .env, credentials, SSH keys
- **Audit logging** - Full command history for debugging and compliance
- **Rate limiting** - Prevent runaway agents from going wild

### Bash Bro (AI Sidekick)
- **System awareness** - Knows your Python version, installed tools, project type
- **Task routing** - Routes simple commands to your local model, saves API $$$
- **Command suggestions** - Suggests next commands based on context and history
- **Background tasks** - Run tests, builds in parallel while you keep coding
- **Works with Ollama** - Use your fine-tuned Qwen or other local models

## Quick Start

```bash
# Install
npm install -g bashbros

# Set up for your project
bashbros init

# Scan your system (Bash Bro learns your environment)
bashbros scan

# Start protection + AI assistance
bashbros watch
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BashBros Layer                              │
│  ┌─────────────────┐                     ┌─────────────────────┐   │
│  │  Security       │                     │  Bash Bro           │   │
│  │  (5 modules)    │                     │  (Your trained SLM) │   │
│  └─────────────────┘                     └─────────────────────┘   │
│           │                                        │                │
│           ▼                                        ▼                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Command Router                            │   │
│  │   "Should Claude handle this, or can my Bash Bro do it?"    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Commands

### Security Commands

| Command | Description |
|---------|-------------|
| `bashbros init` | Interactive setup wizard |
| `bashbros watch` | Start protection |
| `bashbros doctor` | Check configuration |
| `bashbros allow <cmd>` | Allow a specific command |
| `bashbros audit` | View command history |

### Bash Bro Commands

| Command | Description |
|---------|-------------|
| `bashbros scan` | Scan system & project environment |
| `bashbros status` | Show Bash Bro status and system info |
| `bashbros suggest` | Get command suggestions |
| `bashbros route <cmd>` | Check how a command would be routed |
| `bashbros run <cmd>` | Execute through Bash Bro |
| `bashbros tasks` | List background tasks |

## System Awareness

Bash Bro scans and remembers your environment:

```bash
$ bashbros scan

## System Context
- Platform: win32 (x64)
- Shell: C:\Windows\System32\cmd.exe
- CPU: 16 cores, RAM: 32GB

- Python: 3.12.0
- Node: 20.10.0
- Git: 2.43.0
- Docker: 24.0.7
- Ollama: 0.1.27
  Models: qwen2.5-coder:7b, llama3.2:3b

## Project: node
Dependencies: react, typescript, vite...
```

## Task Routing

Bash Bro intelligently routes commands:

```bash
$ bashbros route "git status"
🤝 Route: Bash Bro
   Reason: Git status
   Confidence: 90%

$ bashbros route "refactor this authentication system"
🤖 Route: Main Agent
   Reason: Refactoring requires reasoning
   Confidence: 90%

$ bashbros route "npm test"
⚡ Route: Both (parallel)
   Reason: Tests can run in background
   Confidence: 90%
```

## Background Tasks

Run long tasks in parallel:

```bash
$ bashbros run "npm test" --background
✓ Started background task: task_1
  Command: npm test
  Run 'bashbros tasks' to check status

# Keep working... Bash Bro notifies you when done:
🤝 Bash Bro: Background task ✓ completed
   Command: npm test
   Duration: 45s
```

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

## Integration with Ghost Gym

BashBros works seamlessly with [Ghost Gym](https://github.com/GhostPeony/ghostwork) for training your own Bash Bro:

1. **Capture** - BashBros logs all commands (training data)
2. **Train** - Ghost Gym trains your local model on your patterns
3. **Deploy** - Your trained model becomes your Bash Bro
4. **Improve** - The more you use it, the smarter it gets

## Works With

- [Claude Code](https://claude.ai/claude-code)
- [Clawdbot](https://clawd.bot)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [Aider](https://aider.chat)
- [OpenCode](https://github.com/opencode-ai/opencode)
- [Ollama](https://ollama.ai) (for local models)
- Any CLI agent that uses bash/shell

## License

MIT - see [LICENSE](LICENSE)

## Links

- Website: [bashbros.ai](https://bashbros.ai)
- GitHub: [github.com/GhostPeony/bashbros](https://github.com/GhostPeony/bashbros)
