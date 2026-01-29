# BashBros
![bashbros](https://github.com/user-attachments/assets/766502da-f31d-4304-a4dc-7f0a1845335f)

```
       /____            _     ____
      /| __ )  __ _ ___| |__ | __ ) _ __ ___  ___
     / |  _ \ / _` / __| '_ \|  _ \| '__/ _ \/ __|
    /  | |_) | (_| \__ \ | | | |_) | | | (_) \__ \
   /   |____/ \__,_|___/_| |_|____/|_|  \___/|___/
   Security middleware + AI sidekick for CLI agents
```

**BashBros** sits between AI coding agents and your terminal. It intercepts commands, applies security policies, and provides an AI sidekick powered by [Ollama](https://ollama.com). Think of it as a firewall + AI companion for your AI agents.

Supports **Claude Code**, **Copilot CLI**, **Gemini CLI**, **OpenCode**, **Aider**, and **Moltbot** out of the box.

[Website](https://bashbros.ai) | [GitHub](https://github.com/GhostPeony/bashbros) | [Issues](https://github.com/GhostPeony/bashbros/issues)

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Features](#features)
  - [Security Policies](#security-policies)
  - [AI Sidekick (Ollama-powered)](#ai-sidekick-ollama-powered)
  - [Ollama Model Management](#ollama-model-management)
  - [LoRA Adapter Management](#lora-adapter-management)
  - [Model Profiles](#model-profiles)
  - [Shared Context Store](#shared-context-store)
  - [Dashboard](#dashboard)
    - [Live Tab](#live-tab)
    - [Sessions Tab](#sessions-tab)
    - [Security Tab](#security-tab)
    - [Bash Bro Tab](#bash-bro-tab)
    - [Models Tab](#models-tab)
    - [Context Tab](#context-tab)
    - [Settings Tab](#settings-tab)
    - [WebSocket Events](#websocket-events)
  - [Agent Integrations](#agent-integrations)
  - [Ward (Network Security)](#ward-network-security)
  - [Observability](#observability)
- [CLI Reference](#cli-reference)
  - [Core Commands](#core-commands)
  - [AI Sidekick Commands](#ai-sidekick-commands)
  - [Bash Bro Commands](#bash-bro-commands)
  - [Dashboard](#dashboard-command)
  - [Agent Hook Commands](#agent-hook-commands)
  - [Ward Commands](#ward-commands)
  - [Undo Commands](#undo-commands)
  - [Reporting Commands](#reporting-commands)
- [Examples](#examples)
- [Configuration](#configuration)
  - [Config File Reference](#config-file-reference)
  - [Security Profiles](#security-profiles)
  - [Risk Levels](#risk-levels)
- [Shared Context Store Layout](#shared-context-store-layout)
- [Programmatic API](#programmatic-api)
- [Dashboard REST API](#dashboard-rest-api)
- [Supported Agents](#supported-agents)
- [BashGym Integration](#bashgym-integration)
- [Requirements](#requirements)
- [Development](#development)
- [License](#license)

---

## Installation

Install globally:

```bash
npm install -g bashbros
```

Or as a project dev dependency:

```bash
npm install --save-dev bashbros
```

Requires **Node.js >= 18**.

---

## Quick Start

```bash
# 1. Initialize in your project
bashbros init

# 2. Install hooks for your agent(s)
bashbros hook install          # Claude Code
bashbros gemini install        # Gemini CLI
bashbros copilot install       # Copilot CLI
bashbros setup                 # Or use the multi-agent wizard

# 3. Start protection
bashbros watch

# 4. (Optional) Start the dashboard
bashbros dashboard
```

The dashboard opens at `http://localhost:7890` by default and gives you real-time visibility into every command your agents run.

---

## Features

### Security Policies

BashBros provides nine security modules that work together to protect your system from unintended or dangerous agent behavior.

- **Command allow/block lists** -- Glob patterns to explicitly allow or block commands.
- **Path access control** -- Block dangerous paths like `/etc/passwd`, `~/.ssh`, `~/.aws`.
- **Secret detection and redaction** -- Detect and redact secrets in command output before they leak.
- **Risk scoring engine** -- Score every command from 1-10. Configurable block and warn thresholds.
- **Loop detection** -- Detect and break runaway agent loops (repeated commands, excessive turns).
- **Anomaly detection** -- Flag unusual command patterns and off-hours activity.
- **Rate limiting** -- Per-minute and per-hour rate limits to prevent runaway agents.
- **Output scanning** -- Scan command output for leaked secrets, API keys, and credentials.
- **Undo stack** -- Rollback file operations with automatic backups.

### AI Sidekick (Ollama-powered)

BashBros includes a local AI sidekick powered by Ollama. It can explain commands, fix errors, suggest next steps, generate scripts, and perform security analysis -- all running locally on your machine.

| Command | What it does |
|---------|--------------|
| `bashbros explain <command>` | Explain what a command does in plain language |
| `bashbros fix <command> -e "error"` | Suggest fixes for failed commands |
| `bashbros suggest` | Context-aware next command suggestions |
| `bashbros script <description>` | Generate shell scripts from natural language |
| `bashbros do <description>` | Convert natural language to executable commands |
| `bashbros safety <command>` | AI-powered security risk analysis |
| `bashbros ai <prompt>` | Free-form AI Q&A about your system |

Under the hood, the AI sidekick uses a hybrid routing system: pattern matching handles well-known commands instantly, while Ollama provides fallback analysis for ambiguous inputs. Suggestions are cached with a 5-minute TTL for fast repeated access.

### Ollama Model Management

Full Ollama control plane accessible from the web dashboard:

- Pull, delete, and inspect models without leaving the dashboard.
- View running models with real-time VRAM/RAM usage bars.
- Inspect model details: parameter count, quantization level, model family.

### LoRA Adapter Management

Integrate fine-tuned LoRA adapters into your AI sidekick workflow:

- Auto-discover GGUF LoRA adapters from `~/.bashgym/integration/models/adapters/`.
- Activate adapters with one click (auto-generates Ollama Modelfile, registers with Ollama).
- Per-function adapter routing -- assign different adapters to `suggest`, `safety`, `route`, `explain`, `fix`, and `script` functions.
- Connects to the [BashGym](https://github.com/GhostPeony/bashgym) training pipeline for continuous improvement.

### Model Profiles

Named profiles that combine a base model with adapter assignments:

- Save, load, and delete profiles from `~/.bashbros/models/profiles/`.
- Quick-switch between profiles from the dashboard.
- Each profile stores the base model name and per-function adapter mappings.

### Shared Context Store

BashBros maintains a per-project context store at `.bashbros/context/` that any CLI agent can read. No proprietary format -- memory files are plain markdown (like `CLAUDE.md`), and artifacts are standard JSONL.

- **Memory files** (persistent, human-readable markdown): `decisions.md`, `conventions.md`, `issues.md`, plus custom files.
- **Session artifacts** (machine-readable JSONL): command history, error logs, session summaries.
- **Index manifest** tracking agents seen, session counts, and file counts.
- Auto-writes during watch mode sessions.
- Configurable retention with auto-pruning (default: 30 days).

See [Shared Context Store Layout](#shared-context-store-layout) for the full directory structure.

### Dashboard

Real-time web dashboard for monitoring everything BashBros does. Start it with `bashbros dashboard` and open `http://localhost:7890`.

The dashboard uses WebSocket for real-time updates and REST polling as a fallback. All data is stored in a local SQLite database and persists across sessions.

#### Live Tab

The default view. Shows a real-time command feed as agents execute commands.

- **Multi-session support** -- When multiple agents run simultaneously, each session gets a color-coded pill in the session bar. Click a pill to filter the feed to that session, or "Show All" to see everything.
- **Risk badges** -- Every command displays a risk badge (safe/caution/dangerous/critical) based on the risk scoring engine.
- **Command details** -- Each entry shows the command text, execution time, exit code, and which repository/project it ran in.
- **Cached feed** -- The live feed persists in localStorage so refreshing the page doesn't lose your view.

#### Sessions Tab

Browse completed and active sessions. Each session shows:

- Agent type, start time, duration
- Total commands executed and violations triggered
- Click to inspect individual session details

#### Security Tab

Security-focused monitoring across all sessions:

- **Risk distribution** -- Visual bars showing the proportion of safe/caution/dangerous/critical commands.
- **Violation breakdown** -- Counts by violation type (command, path, secrets, rate_limit, risk_score, loop, anomaly, output).
- **Blocked commands** -- Full list of blocked commands with the violation rule that triggered the block.
- **Security event feed** -- Chronological log of all security events with severity badges.
- **Exposure scans** -- Results from Ward's agent server exposure scanning.

#### Bash Bro Tab

Monitoring for the AI sidekick and Ollama integration:

- **Status panel** -- Shows Ollama connection status, current model, platform, shell, project type, active profile, and adapter count.
- **Model selector** -- Dropdown to switch the active Ollama model and trigger system scans.
- **AI activity log** -- Every AI request (suggestion, explanation, fix, script, safety analysis) with the model used, latency, and success/failure status. Requests under 50ms show a "CACHED" badge.
- **Router stats** -- Pattern-matched vs AI-routed decision counts, and average response latency. This tells you how often the AI fallback kicks in for ambiguous commands.
- **Adapter events** -- Table of adapter activations with timestamp, adapter name, base model, purpose, action, and success status.

#### Models Tab

Full Ollama control plane:

- **Pull model** -- Type a model name (e.g., `deepseek-coder:6.7b`) and pull it directly from the dashboard. A progress bar shows download status, and WebSocket events (`model:pull:complete`, `model:pull:error`) update the UI in real time.
- **Running models** -- Shows every model currently loaded in Ollama's memory. Each entry displays the model name, parameter size, quantization level, and a VRAM usage bar showing the proportion of the model loaded into GPU memory vs system RAM.
- **Installed models** -- Card grid of all models installed in Ollama. Each card shows the model name, parameter count, family (llama, qwen, etc.), quantization level (Q4_K_M, Q5_K_S, etc.), and format. Cards have a delete button with confirmation.
- **LoRA adapters** -- Card grid of adapters discovered from `~/.bashgym/integration/models/adapters/`. Each card shows the adapter name, base model, purpose tag (suggest/safety/route/etc.), quality score, trace count, and training date. Click "Activate" to auto-generate an Ollama Modelfile and register the adapter as a usable Ollama model.
- **Profile editor** -- List of saved profiles with edit/delete buttons. The editor form lets you set a profile name, base model, and assign adapters to six function slots (suggest, safety, route, explain, fix, script).

#### Context Tab

View and edit the shared context store:

- **Stats** -- Cards showing last update time, number of agents seen, total sessions, command files, and error files from the context index.
- **Memory file editor** -- Inline editors for each markdown memory file (`decisions.md`, `conventions.md`, `issues.md`, and any custom files). Edit the markdown directly in the browser and save with one click. WebSocket `context:updated` events refresh the view when files change externally.
- **Session browser** -- Placeholder for future search/filter over session artifacts.

#### Settings Tab

- **Agent integrations** -- Status cards for each supported agent showing installation state.
- **Security profile** -- Edit the active security profile, command allowlists/blocklists, and all policy settings.

#### WebSocket Events

The dashboard listens for real-time events over WebSocket:

| Event | Trigger |
|-------|---------|
| `command` | A command was executed (refreshes live feed) |
| `model:pull:start` | Model pull initiated |
| `model:pull:complete` | Model pull finished successfully |
| `model:pull:error` | Model pull failed |
| `adapter:activated` | LoRA adapter activated in Ollama |
| `context:updated` | A memory file was modified |

### Agent Integrations

BashBros hooks into six CLI agents with a single command per agent:

- **Claude Code** -- Pre/post command hooks (gate + record all tool types).
- **Moltbot/Clawdbot** -- Hook integration + gateway monitoring + security audit.
- **Gemini CLI** -- Pre/post hooks via `settings.json`.
- **Copilot CLI** -- Pre/post hooks.
- **OpenCode** -- Plugin integration.
- **Aider** -- Configuration support.

Use `bashbros setup` for a guided multi-agent setup wizard.

### Ward (Network Security)

Network-level security scanning and egress monitoring:

- **Exposure scanning** -- Detect agent servers with open ports.
- **Egress pattern detection** -- Catch credentials, API keys, and PII leaving your machine.
- **Configurable actions** -- Block, alert, or log suspicious egress.
- **Severity-based response** -- Graduated handling for low/medium/high/critical threats.

### Observability

- **Command audit logging** -- Full history of every command executed.
- **Session metrics and reporting** -- Generate reports in text, markdown, or JSON format.
- **Cost estimation** -- Track estimated token usage and API costs.
- **Undo stack** -- Track and revert file operations.

---

## CLI Reference

### Core Commands

```
bashbros init                    Set up BashBros for your project
bashbros watch [-v]              Start protecting your agent (verbose mode with -v)
bashbros doctor                  Check your configuration
bashbros allow <command>         Allow a specific command (--once | --persist)
bashbros audit [-n lines]        View recent command history
```

### AI Sidekick Commands

Requires [Ollama](https://ollama.com) running locally.

```
bashbros explain <command>       Explain what a command does
bashbros fix <command> -e "err"  Fix a failed command
bashbros suggest                 Get next command suggestions
bashbros ai <prompt>             Ask Bash Bro anything
bashbros script <desc> [-o file] Generate a shell script (optionally save to file)
bashbros do <desc> [-x]          Natural language to command (-x to execute)
bashbros safety <command>        AI security risk analysis
bashbros help-ai <topic>         Get AI help on a topic
bashbros models                  List available Ollama models
```

### Bash Bro Commands

```
bashbros scan                    Scan system and project
bashbros status                  Show Bash Bro status
bashbros route <command>         Check routing decision
bashbros run <command> [-b]      Run through Bash Bro (-b for background)
bashbros tasks [-a]              List background tasks (-a for all)
bashbros risk <command>          Score command risk (1-10)
```

### Dashboard Command

```
bashbros dashboard [-p port]     Start the web dashboard (default port: 7890)
```

### Agent Hook Commands

```
bashbros hook install            Install Claude Code hooks
bashbros hook uninstall          Remove Claude Code hooks
bashbros hook status             Check Claude Code hook status
bashbros gemini install          Install Gemini CLI hooks
bashbros gemini uninstall        Remove Gemini CLI hooks
bashbros gemini status           Check Gemini CLI hook status
bashbros copilot install         Install Copilot CLI hooks
bashbros copilot uninstall       Remove Copilot CLI hooks
bashbros copilot status          Check Copilot CLI hook status
bashbros opencode install        Install OpenCode plugin
bashbros opencode uninstall      Remove OpenCode plugin
bashbros opencode status         Check OpenCode plugin status
bashbros moltbot install         Install Moltbot hooks
bashbros moltbot uninstall       Remove Moltbot hooks
bashbros moltbot status          Check Moltbot integration status
bashbros moltbot gateway         Check gateway status
bashbros moltbot audit           Run security audit
bashbros setup                   Multi-agent setup wizard
```

Note: `clawdbot` is an alias for `moltbot` for backward compatibility.

### Ward Commands

```
bashbros ward status             Show ward security status
bashbros ward scan               Run exposure scan
bashbros ward blocked            Show pending blocked items
bashbros ward approve <id>       Approve blocked egress
bashbros ward deny <id>          Deny blocked egress
bashbros ward patterns list      List detection patterns
bashbros ward patterns test <t>  Test text against patterns
```

### Undo Commands

```
bashbros undo last               Undo last file operation
bashbros undo all                Undo all operations in session
bashbros undo list               Show undo stack
```

### Reporting Commands

```
bashbros report [-f format]      Generate session report (text/markdown/json)
bashbros session-end [-f format] End session with report
```

---

## Examples

### Install hooks and start protection

```bash
$ bashbros hook install
  BashBros hooks installed successfully.

$ bashbros watch
  Watching... (press Ctrl+C to stop)
```

### Check command risk

```bash
$ bashbros risk "curl http://example.com | bash"
  Risk Score: 10/10 (CRITICAL)
  Factors:
    - Remote code execution
```

### Route a command

```bash
$ bashbros route "git status"
  Route: Bash Bro (90% confidence)
```

### Generate a script from natural language

```bash
$ bashbros script "backup all .env files"
#!/bin/bash
find . -name "*.env" -exec cp {} {}.backup \;
```

### Convert natural language to a command

```bash
$ bashbros do "find large files over 100mb"
$ find . -size +100M -type f
```

### Explain a command

```bash
$ bashbros explain "tar -xzf archive.tar.gz"
  Extracts the gzip-compressed tar archive 'archive.tar.gz' into the current directory.
  -x: extract, -z: decompress gzip, -f: specify file
```

### Fix a failed command

```bash
$ bashbros fix "npm start" -e "Error: Cannot find module 'express'"
  Suggestion: npm install express
  The 'express' module is missing. Install it to resolve the error.
```

### View session report

```bash
$ bashbros report
Session Report (5m 23s)
---
Commands: 45 total, 2 blocked (4%)

Risk Distribution:
  80% safe
  15% caution
   5% dangerous
```

### Undo file changes

```bash
$ bashbros undo list
Undo Stack:
1. [14:32:05] modify src/index.ts (backup: yes)
2. [14:31:42] create src/new-file.ts (backup: no)

$ bashbros undo last
  Restored: src/index.ts
```

---

## Configuration

BashBros looks for configuration in the following locations (in order of priority):

1. `.bashbros.yml` in your project root
2. `~/.bashbros.yml`
3. `~/.bashbros/config.yml`

### Config File Reference

```yaml
agent: claude-code           # claude-code | gemini-cli | copilot-cli | opencode | moltbot | aider
profile: balanced            # balanced | strict | permissive | custom

commands:
  allow:
    - "git *"
    - "npm *"
    - "node *"
  block:
    - "rm -rf /"
    - "curl * | bash"

paths:
  allow:
    - "."
  block:
    - "~/.ssh/*"
    - "/etc/shadow"

secrets:
  enabled: true
  mode: block                # block | audit

rateLimit:
  enabled: true
  maxPerMinute: 100
  maxPerHour: 1000

riskScoring:
  enabled: true
  blockThreshold: 9          # Block commands at or above this score
  warnThreshold: 6           # Warn for commands at or above this score
  customPatterns:
    - pattern: "my-custom-danger-cmd"
      score: 8
      factor: "Custom dangerous pattern"

loopDetection:
  enabled: true
  maxRepeats: 3              # Same command N times triggers alert
  maxTurns: 100              # Hard stop after N total commands
  similarityThreshold: 0.85
  cooldownMs: 1000
  windowSize: 20
  action: warn               # warn | block

anomalyDetection:
  enabled: true
  workingHours: [6, 22]      # 6am - 10pm
  typicalCommandsPerMinute: 30
  learningCommands: 50
  action: warn               # warn | block

outputScanning:
  enabled: true
  scanForSecrets: true
  scanForErrors: true
  maxOutputLength: 100000
  redactPatterns: []          # Additional regex patterns to redact

undo:
  enabled: true
  maxStackSize: 100
  maxFileSize: 10485760       # 10MB
  ttlMinutes: 60
  backupPath: ~/.bashbros/undo

ward:
  enabled: true

dashboard:
  enabled: true
  port: 7890
  bind: 127.0.0.1
```

### Security Profiles

Three built-in profiles control how aggressively BashBros enforces security:

| Profile | Risk Block | Risk Warn | Loop Max | Anomaly | Behavior |
|---------|------------|-----------|----------|---------|----------|
| `strict` | 6 | 3 | 2 repeats, block | enabled | Allowlist only, explicit approval required |
| `balanced` | 9 | 6 | 3 repeats, warn | enabled | Block dangerous, allow common dev tools |
| `permissive` | 10 | 8 | 5 repeats, warn | disabled | Log everything, block only critical threats |

### Risk Levels

| Level | Score | Examples |
|-------|-------|----------|
| Safe | 1-2 | `ls`, `git status`, `npm test` |
| Caution | 3-5 | `ps aux`, `netstat`, encoded content |
| Dangerous | 6-8 | `crontab`, `chmod 777`, `sudo` |
| Critical | 9-10 | `rm -rf /`, `curl \| bash`, fork bombs |

---

## Shared Context Store Layout

```
.bashbros/context/
├── memory/                     # Persistent markdown files
│   ├── decisions.md            # Architectural decisions
│   ├── conventions.md          # Coding patterns & style
│   ├── issues.md               # Known issues & workarounds
│   └── custom/                 # User-created files
├── artifacts/                  # Machine-readable session data
│   ├── sessions/               # One JSON per session
│   ├── commands/               # Daily JSONL command logs
│   └── errors/                 # Daily JSONL error logs
└── index.json                  # Manifest with stats
```

Memory files are human-readable markdown. Any agent can read them the same way it reads `CLAUDE.md` or any other project documentation file. Artifacts are auto-pruned after 30 days by default (configurable via retention settings).

---

## Programmatic API

BashBros exports its core components for use as a library:

```typescript
import { BashBro, OllamaClient, PolicyEngine } from 'bashbros'
```

### AI Sidekick

```typescript
const bro = new BashBro({
  enableOllama: true,
  modelName: 'qwen2.5-coder:7b',
  activeProfile: 'balanced'
})
await bro.initialize()

const suggestion = await bro.aiSuggest('npm test failed with module error')
const explanation = await bro.aiExplain('find . -name "*.ts" -exec wc -l {} +')
const route = await bro.routeAsync('git diff --stat')
const suggestions = await bro.suggestAsync({ lastCommand: 'npm test', lastOutput: 'PASS' })
```

### Security Policy Engine

```typescript
const engine = new PolicyEngine(config)
const result = engine.evaluate('rm -rf /tmp/*')
// result.allowed: boolean
// result.reason: string
// result.riskScore: number
```

### Risk Scoring

```typescript
import { RiskScorer } from 'bashbros'

const scorer = new RiskScorer()
const risk = scorer.score('rm -rf /')
console.log(risk.level)   // 'critical'
console.log(risk.score)   // 10
```

### Loop Detection

```typescript
import { LoopDetector } from 'bashbros'

const detector = new LoopDetector({ maxRepeats: 3 })
const alert = detector.check('git status')
if (alert) console.log('Loop detected:', alert.message)
```

### Output Scanning

```typescript
import { OutputScanner } from 'bashbros'

const scanner = new OutputScanner({ enabled: true, scanForSecrets: true })
const result = scanner.scan('API_KEY=sk-secret123')
console.log(result.hasSecrets)      // true
console.log(result.redactedOutput)  // 'API_KEY=[REDACTED API Key]'
```

### Ollama Client

```typescript
const ollama = new OllamaClient({ host: 'http://localhost:11434' })
const models = await ollama.listModels()
const running = await ollama.listRunning()
const info = await ollama.showModel('qwen2.5-coder:7b')
```

### Session Metrics and Reporting

```typescript
import { MetricsCollector, ReportGenerator, CostEstimator } from 'bashbros'

const metrics = new MetricsCollector()
metrics.record({ command: 'ls', exitCode: 0 })
const report = ReportGenerator.generate(metrics.getMetrics())

const cost = new CostEstimator('claude-sonnet-4')
cost.recordToolCall('command', 'output')
console.log(cost.getEstimate())  // { estimatedCost: 0.05, ... }
```

### Undo Stack

```typescript
import { UndoStack } from 'bashbros'

const undo = new UndoStack({ maxStackSize: 50, ttlMinutes: 30 })
undo.recordModify('/path/to/file')
undo.undo()  // Restores from backup
```

### Claude Code Hooks

```typescript
import { ClaudeCodeHooks } from 'bashbros'

ClaudeCodeHooks.install()
ClaudeCodeHooks.getStatus()
```

---

## Dashboard REST API

When running `bashbros dashboard`, the following REST endpoints are available at `http://localhost:7890`. All endpoints return JSON.

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/stats` | Global stats (total commands, sessions, violations) |
| `GET` | `/api/events` | Event log with optional `?limit=` |

### Sessions and Commands

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sessions` | All sessions with optional `?limit=` and `?status=` |
| `GET` | `/api/sessions/active` | Current active session |
| `GET` | `/api/sessions/active-all` | All active sessions (multi-agent) |
| `GET` | `/api/sessions/:id` | Single session details |
| `GET` | `/api/sessions/:id/commands` | Commands for a session |
| `GET` | `/api/sessions/:id/metrics` | Metrics for a session |
| `GET` | `/api/commands/live` | Live command feed with `?limit=` and `?sessionId=` |
| `GET` | `/api/commands` | Command history with `?limit=`, `?offset=`, `?allowed=` |

### Tool Recording

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tools/live` | Live tool execution feed |
| `GET` | `/api/tools` | Tool execution history with `?limit=`, `?offset=`, `?tool_name=` |
| `GET` | `/api/tools/stats` | Tool usage statistics |

### Bash Bro (AI Sidekick)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bro/status` | Ollama connection, model, platform, shell, project type |
| `GET` | `/api/bro/events` | AI activity log with `?limit=` |
| `GET` | `/api/bro/models` | List installed Ollama models |
| `POST` | `/api/bro/model` | Switch active model (body: `{ model }`) |
| `POST` | `/api/bro/scan` | Trigger system profile scan |

### Model Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bro/models/running` | Running models with VRAM/RAM usage |
| `GET` | `/api/bro/models/:name` | Model details (params, quantization, family) |
| `POST` | `/api/bro/models/pull` | Pull a model (body: `{ name }`) |
| `DELETE` | `/api/bro/models/:name` | Delete a model from Ollama |

### Adapters

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bro/adapters` | List discovered LoRA adapters |
| `GET` | `/api/bro/adapters/events` | Adapter activation history |
| `POST` | `/api/bro/adapters/:name/activate` | Activate adapter (creates Ollama model) |

### Profiles

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bro/profiles` | List model profiles |
| `POST` | `/api/bro/profiles` | Save a profile (body: full profile JSON) |
| `DELETE` | `/api/bro/profiles/:name` | Delete a profile |

### Context Store

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/context/index` | Context store manifest and stats |
| `GET` | `/api/context/memory` | All memory files (key = filename, value = content) |
| `PUT` | `/api/context/memory/:name` | Update a memory file (body: `{ content }`) |

### Security

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/security/summary` | Risk distribution, violation counts |
| `GET` | `/api/security/blocked-commands` | Blocked commands with `?limit=` |
| `GET` | `/api/exposures` | Ward exposure scan results |
| `GET` | `/api/blocked` | Pending blocked egress items |
| `POST` | `/api/blocked/:id/approve` | Approve a blocked egress item |
| `POST` | `/api/blocked/:id/deny` | Deny a blocked egress item |
| `GET` | `/api/connectors` | Monitored connectors |
| `GET` | `/api/connectors/:name/events` | Events for a specific connector |

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Current BashBros configuration |
| `POST` | `/api/config` | Update configuration |
| `GET` | `/api/agents/status` | Installed agent integration status |

---

## Supported Agents

| Agent | Integration Type | Gate | Record | Status |
|-------|------------------|------|--------|--------|
| Claude Code | Pre/Post command hooks | Yes | Yes | Full support |
| Gemini CLI | Pre/Post command hooks | Yes | Yes | Full support |
| Copilot CLI | Pre/Post command hooks | Yes | Yes | Full support |
| OpenCode | Plugin | Yes | Yes | Full support |
| Moltbot | Hook + Gateway | Yes | Yes | Full support |
| Aider | Config | -- | -- | Basic support |

---

## BashGym Integration

> **Note**: BashGym is releasing after BashBros. This section describes the planned integration interface and may be updated in future versions.

BashBros integrates with [BashGym](https://github.com/GhostPeony/bashgym), a self-improving agent training system. When linked, BashBros exports execution traces that BashGym uses to train better AI sidekick models.

### Training Loop

```
BashBros captures traces --> BashGym trains --> GGUF to Ollama --> BashBros sidekick improves
```

1. **Trace Export** -- BashBros captures command sessions and exports them to `~/.bashgym/integration/traces/pending/`.
2. **Training** -- BashGym processes traces, classifies quality, and trains models.
3. **Model Delivery** -- Trained models are exported to GGUF format and registered with Ollama.
4. **Hot-Swap** -- BashBros detects new models and hot-swaps the sidekick without restart.

### Linking to BashGym

During `bashbros init`, you will be prompted:

```
? Link to BashGym? (enables self-improving AI sidekick)
  > Yes (recommended) - Export traces for training, get smarter sidekick
    No - Use bashbros standalone
```

### Shared Directory Structure

```
~/.bashgym/integration/
├── traces/pending/         # BashBros --> BashGym (new traces)
├── traces/processed/       # Ingested traces
├── models/latest/          # BashGym --> BashBros (current model)
├── models/manifest.json
├── models/adapters/        # LoRA adapters (GGUF)
├── config/settings.json
└── status/                 # Heartbeat files
```

### Capture Modes

| Mode | Description |
|------|-------------|
| `everything` | Capture all sessions |
| `successful_only` | Only verified/successful traces (default) |
| `sidekick_curated` | AI picks teachable moments |

### Programmatic Usage

```typescript
import { BashBro } from 'bashbros'

const bro = new BashBro({ enableBashgymIntegration: true })
await bro.initialize()

if (bro.isUsingBashgymModel()) {
  console.log(`Using model: ${bro.getBashgymModelVersion()}`)
}
```

When linked, BashBros acts as the primary security layer -- BashGym defers all security checks to BashBros policies.

---

## Requirements

- **Node.js** >= 18
- **Ollama** (optional, required for AI sidekick features) -- [https://ollama.com](https://ollama.com)
- **BashGym** (optional, for LoRA adapter management and training pipeline) -- [https://github.com/GhostPeony/bashgym](https://github.com/GhostPeony/bashgym)

---

## Development

```bash
git clone https://github.com/GhostPeony/bashbros.git
cd bashbros
npm install
npm run build
npm test
```

---

## License

MIT -- see [LICENSE](./LICENSE) for details.

---

Built by [GhostPeony](https://github.com/GhostPeony) | [bashbros.ai](https://bashbros.ai)
