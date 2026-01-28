# @bashbros/moltbot-audit

[Moltbot](https://molt.bot) hook plugin for [BashBros](https://github.com/GhostPeony/bashbros) audit logging and output scanning.

## What It Does

After each tool execution in Moltbot:

- **Audit logging** - Records commands to `~/.bashbros/audit.log`
- **Secret scanning** - Detects API keys, tokens, passwords in output
- **Risk scoring** - Assigns 1-10 risk score to each command
- **Warnings** - Alerts on high-risk commands and leaked secrets

## Install

```bash
# Install via moltbot
moltbot hooks install @bashbros/moltbot-audit

# Or link locally during development
moltbot hooks install --link ./path/to/moltbot-audit
```

## Usage

Once installed, the hook runs automatically on every tool execution. No configuration needed.

### Check hook status

```bash
moltbot hooks list
```

### View audit log

```bash
# Recent entries
tail -20 ~/.bashbros/audit.log

# Pretty print with jq
cat ~/.bashbros/audit.log | jq .

# Filter high-risk commands
grep '"riskScore":[789]' ~/.bashbros/audit.log | jq .

# Filter commands with secrets
grep '"secretsFound":true' ~/.bashbros/audit.log | jq .
```

## Audit Log Format

Entries are written in JSONL format:

```json
{
  "timestamp": "2026-01-28T10:30:00.000Z",
  "command": "git status",
  "toolName": "Bash",
  "riskScore": 1,
  "allowed": true,
  "agent": "moltbot",
  "sessionKey": "agent:main:main",
  "secretsFound": false,
  "redacted": false,
  "outputLength": 245
}
```

### Fields

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 timestamp |
| `command` | The executed command |
| `toolName` | Moltbot tool name (Bash, exec) |
| `riskScore` | 1-10 risk assessment |
| `allowed` | Always `true` (post-execution) |
| `agent` | Always `moltbot` |
| `sessionKey` | Moltbot session identifier |
| `secretsFound` | Whether output contained secrets |
| `redacted` | Whether secrets were redacted |
| `outputLength` | Length of command output |

## Risk Scoring

| Score | Level | Examples |
|-------|-------|----------|
| 1-2 | Safe | `ls`, `git status`, `npm test` |
| 3-5 | Caution | `cat .env`, `.ssh/` access |
| 6-8 | Dangerous | `sudo`, `chmod 777`, `eval` |
| 9-10 | Critical | `rm -rf /`, `curl | bash`, fork bombs |

## Secret Detection

Detects patterns including:
- OpenAI API keys (`sk-...`)
- GitHub tokens (`ghp_...`, `gho_...`)
- GitLab tokens (`glpat-...`)
- Slack tokens (`xox...`)
- AWS access keys (`AKIA...`)
- Private keys (`-----BEGIN...PRIVATE KEY-----`)
- Bearer tokens
- Generic API keys and passwords

## Limitations

This hook runs **after** command execution via `tool_result_persist`, so it:

- Cannot block commands before they run
- Cannot prevent dangerous commands from executing

For pre-execution gating, use:
- [@bashbros/moltbot-sync](https://github.com/GhostPeony/bashbros/tree/main/packages/moltbot-sync) to sync allowlists
- Moltbot's built-in `exec-approvals` system

## Disabling

```bash
moltbot hooks disable bashbros-audit
```

## Related

- [bashbros](https://github.com/GhostPeony/bashbros) - Security middleware for CLI agents
- [@bashbros/moltbot-sync](https://github.com/GhostPeony/bashbros/tree/main/packages/moltbot-sync) - Sync policies to moltbot allowlists
- [Moltbot](https://molt.bot) - Multi-platform AI gateway

## License

MIT
