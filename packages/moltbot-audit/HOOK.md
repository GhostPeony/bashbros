---
name: bashbros-audit
description: "BashBros audit logging and output scanning for Moltbot"
homepage: https://github.com/GhostPeony/bashbros/tree/main/packages/moltbot-audit
metadata:
  {
    "clawdbot":
      {
        "emoji": "🛡️",
        "events": ["tool_result_persist"],
        "install": [{ "id": "npm", "kind": "npm", "label": "npm install @bashbros/moltbot-audit" }],
      },
  }
---

# BashBros Audit Hook

Integrates [BashBros](https://github.com/GhostPeony/bashbros) security features with Moltbot for post-execution auditing and output scanning.

## What It Does

After each tool execution:

1. **Records command** - Logs the command to BashBros audit trail
2. **Scans output** - Checks for leaked secrets in command output
3. **Risk assessment** - Calculates risk score for the executed command
4. **Metrics collection** - Tracks session metrics for reporting

## Events

This hook listens to `tool_result_persist` events, which fire after tool execution completes but before results are persisted.

## Capabilities

| Feature | Description |
|---------|-------------|
| Audit logging | Records all commands to `~/.bashbros/audit.log` |
| Secret scanning | Detects API keys, tokens, passwords in output |
| Output redaction | Redacts sensitive data before logging |
| Risk scoring | Assigns 1-10 risk score to each command |
| Session metrics | Tracks command counts, risk distribution |

## Requirements

- [bashbros](https://www.npmjs.com/package/bashbros) must be installed
- BashBros config (`.bashbros.yml`) should exist

## Installation

```bash
# Install the hook
moltbot hooks install @bashbros/moltbot-audit

# Or link locally during development
moltbot hooks install --link ./packages/moltbot-audit
```

## Configuration

The hook uses your existing BashBros configuration:

```yaml
# .bashbros.yml
outputScanning:
  enabled: true
  scanForSecrets: true
  scanForErrors: true
  redactPatterns: []

audit:
  enabled: true
  destination: local
```

## Output

Audit entries are written to `~/.bashbros/audit.log` in JSONL format:

```json
{"timestamp":"2026-01-28T10:30:00.000Z","command":"git status","riskScore":1,"allowed":true,"agent":"moltbot","secretsFound":false}
{"timestamp":"2026-01-28T10:30:05.000Z","command":"cat .env","riskScore":7,"allowed":true,"agent":"moltbot","secretsFound":true,"redacted":true}
```

## Limitations

This hook runs **after** command execution (via `tool_result_persist`), so it cannot:

- Block commands before execution (use moltbot's exec-approvals for that)
- Prevent dangerous commands from running

For pre-execution gating, use:
- [@bashbros/moltbot-sync](https://github.com/GhostPeony/bashbros/tree/main/packages/moltbot-sync) to sync allowlists
- Moltbot's built-in `exec-approvals` system

## Disabling

```bash
moltbot hooks disable bashbros-audit
```

Or via config:

```json
{
  "hooks": {
    "internal": {
      "entries": {
        "bashbros-audit": { "enabled": false }
      }
    }
  }
}
```

## Related

- [bashbros](https://github.com/GhostPeony/bashbros) - Security middleware for CLI agents
- [@bashbros/moltbot-sync](https://github.com/GhostPeony/bashbros/tree/main/packages/moltbot-sync) - Sync policies to moltbot allowlists
