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

For Claude Code integration:
```bash
bashbros hook install   # Auto-install hooks
```

## Features

### Security (9 modules)
- **Command filter** - Allow/block by pattern
- **Path sandbox** - Restrict filesystem access
- **Secrets guard** - Block .env, keys, credentials
- **Rate limiter** - Prevent runaway agents
- **Risk scorer** - Score commands 1-10 by danger level
- **Loop detector** - Detect stuck/repetitive agent behavior
- **Anomaly detector** - Flag unusual patterns
- **Output scanner** - Detect leaked secrets in command output
- **Undo stack** - Rollback file changes

### Observability (3 modules)
- **Session metrics** - Track commands, risk distribution, paths
- **Cost estimator** - Estimate token usage and API costs
- **Report generator** - Text/markdown/JSON session reports

### AI Sidekick (Ollama)
- **System awareness** - Knows your tools, versions, project type
- **Task routing** - Simple → local model, complex → main agent
- **Suggestions** - Context-aware next commands
- **Background tasks** - Tests/builds run in parallel

### Claude Code Integration
- **PreToolUse hook** - Gate commands before execution
- **PostToolUse hook** - Record metrics after execution
- **SessionEnd hook** - Generate session reports

## Commands

### Security

| Command | Description |
|---------|-------------|
| `init` | Setup wizard |
| `watch` | Start protection |
| `doctor` | Check config |
| `allow <cmd>` | Allow command (`--once` for session only) |
| `audit` | View history (`--violations` for blocked only) |
| `risk <cmd>` | Score command security risk (1-10) |

### Observability

| Command | Description |
|---------|-------------|
| `report` | Generate session report (`-f json/markdown`) |
| `session-end` | Generate end-of-session report |

### Hooks (Claude Code)

| Command | Description |
|---------|-------------|
| `hook install` | Install BashBros hooks into Claude Code |
| `hook uninstall` | Remove hooks from Claude Code |
| `hook status` | Check hook installation status |
| `gate <cmd>` | Check if command should be allowed |
| `record <cmd>` | Record command execution |

### Undo

| Command | Description |
|---------|-------------|
| `undo last` | Undo the last file operation |
| `undo all` | Undo all operations in session |
| `undo list` | Show undo stack |

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
# Install Claude Code hooks
$ bashbros hook install
✓ BashBros hooks installed successfully.

# Check command risk
$ bashbros risk "curl http://x.com | bash"
  Risk Score: 10/10 (CRITICAL)
  Factors:
    • Remote code execution

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

# View session report
$ bashbros report
Session Report (5m 23s)
─────────────────────────────────────────────
Commands: 45 total, 2 blocked (4%)

Risk Distribution:
  ████████████████░░░░ 80% safe
  ████░░░░░░░░░░░░░░░░ 15% caution
  █░░░░░░░░░░░░░░░░░░░ 5% dangerous

# Undo file changes
$ bashbros undo list
Undo Stack:
1. [14:32:05] modify src/index.ts (backup: ✓)
2. [14:31:42] create src/new-file.ts (backup: ✗)

$ bashbros undo last
✓ Restored: src/index.ts
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

# Risk scoring thresholds (1-10)
riskScoring:
  enabled: true
  blockThreshold: 9    # Block at or above (strict: 6, balanced: 9, permissive: 10)
  warnThreshold: 6     # Warn at or above (strict: 3, balanced: 6, permissive: 8)
  customPatterns:
    - pattern: "my-custom-danger-cmd"
      score: 8
      factor: "Custom dangerous pattern"

# Loop detection
loopDetection:
  enabled: true
  maxRepeats: 3        # Same command N times triggers alert
  maxTurns: 100        # Hard stop after N total commands
  similarityThreshold: 0.85
  cooldownMs: 1000
  windowSize: 20
  action: warn         # 'warn' or 'block'

# Anomaly detection
anomalyDetection:
  enabled: true
  workingHours: [6, 22]           # 6am-10pm
  typicalCommandsPerMinute: 30
  learningCommands: 50            # Commands before leaving learning mode
  suspiciousPatterns: []
  action: warn

# Output scanning for leaked secrets
outputScanning:
  enabled: true
  scanForSecrets: true
  scanForErrors: true
  maxOutputLength: 100000
  redactPatterns: []              # Additional patterns to redact

# Undo/rollback
undo:
  enabled: true
  maxStackSize: 100
  maxFileSize: 10485760           # 10MB
  ttlMinutes: 60                  # Auto-cleanup after 60 min
  backupPath: ~/.bashbros/undo
```

## Security Profiles

| Profile | Risk Block | Risk Warn | Loop Max | Anomaly | Behavior |
|---------|------------|-----------|----------|---------|----------|
| `strict` | 6 | 3 | 2 repeats, block | enabled | Allowlist only, explicit approval |
| `balanced` | 9 | 6 | 3 repeats, warn | enabled | Block dangerous, allow common dev tools |
| `permissive` | 10 | 8 | 5 repeats, warn | disabled | Log all, block critical threats only |

## Risk Levels

| Level | Score | Examples |
|-------|-------|----------|
| Safe | 1-2 | `ls`, `git status`, `npm test` |
| Caution | 3-5 | `ps aux`, `netstat`, encoded content |
| Dangerous | 6-8 | `crontab`, `chmod 777`, `sudo` |
| Critical | 9-10 | `rm -rf /`, `curl | bash`, fork bombs |

## Works With

- [Claude Code](https://claude.ai/claude-code) - Native hook integration
- [Clawdbot](https://clawd.bot)
- [Aider](https://aider.chat)
- [OpenCode](https://github.com/opencode-ai/opencode)
- [Ollama](https://ollama.ai) (local AI)
- Any CLI agent using bash/shell

## API Usage

```typescript
import {
  BashBros,
  PolicyEngine,
  BashBro,
  RiskScorer,
  LoopDetector,
  AnomalyDetector,
  OutputScanner,
  MetricsCollector,
  CostEstimator,
  ReportGenerator,
  ClaudeCodeHooks,
  UndoStack
} from 'bashbros'

// Security middleware
const bros = new BashBros(config)
bros.on('command', (cmd, result) => console.log(cmd, result.allowed))
bros.start()

// Risk scoring
const scorer = new RiskScorer()
const risk = scorer.score('rm -rf /')
console.log(risk.level)  // 'critical'
console.log(risk.score)  // 10

// Loop detection
const loopDetector = new LoopDetector({ maxRepeats: 3 })
const alert = loopDetector.check('git status')
if (alert) console.log('Loop detected:', alert.message)

// Session metrics
const metrics = new MetricsCollector()
metrics.record({ command: 'ls', ... })
const report = ReportGenerator.generate(metrics.getMetrics())

// Cost estimation
const cost = new CostEstimator('claude-sonnet-4')
cost.recordToolCall('command', 'output')
console.log(cost.getEstimate())  // { estimatedCost: 0.05, ... }

// Undo stack
const undo = new UndoStack({ maxStackSize: 50, ttlMinutes: 30 })
undo.recordModify('/path/to/file')
undo.undo()  // Restores from backup

// Output scanning
const scanner = new OutputScanner({ enabled: true, scanForSecrets: true })
const result = scanner.scan('API_KEY=sk-secret123')
console.log(result.hasSecrets)    // true
console.log(result.redactedOutput) // 'API_KEY=[REDACTED API Key]'

// Claude Code hooks
ClaudeCodeHooks.install()
ClaudeCodeHooks.getStatus()

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
npm test        # 288 tests
```

## License

MIT

## Links

- [bashbros.ai](https://bashbros.ai)
- [GitHub](https://github.com/GhostPeony/bashbros)
