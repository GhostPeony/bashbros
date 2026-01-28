# Ward & Unified Dashboard Design

## Overview

This design addresses security concerns around exposed Claude Code servers and unmonitored MCP connectors (iMessage, WhatsApp, Slack, etc.) by adding three new security layers to BashBros, plus a unified dashboard for visibility into all BashBros features.

### Problem Statement

1. **Exposed servers** - Reports of hosted Claude Code servers accessible from the internet without authentication
2. **Unmonitored connectors** - Claude connects to messaging platforms via MCP servers with no visibility into data flow
3. **Data exfiltration risk** - Sensitive data (credentials, PII, code) can leave the system through connectors or network calls
4. **No unified visibility** - BashBros has multiple modules but no central dashboard to monitor them

### Solution

**Ward**: Three new security layers under `src/policy/ward/`:
- Layer 1: Network Exposure Scanner
- Layer 2: Connector Registry & MCP Proxy
- Layer 3: Data Egress Monitor

**Dashboard**: Unified web UI at `src/dashboard/` covering all BashBros features.

---

## Architecture

### Ward Modules (under `src/policy/`)

```
src/policy/
├── engine.ts              # Existing PolicyEngine
├── command-filter.ts      # Existing
├── path-sandbox.ts        # Existing
├── secrets-guard.ts       # Existing
├── rate-limiter.ts        # Existing
├── risk-scorer.ts         # Existing
├── loop-detector.ts       # Existing
├── anomaly-detector.ts    # Existing
├── output-scanner.ts      # Existing
├── index.ts               # Existing
│
├── ward/                  # NEW - Network & connector security
│   ├── index.ts
│   ├── exposure.ts        # Layer 1: Network exposure scanner
│   ├── connectors.ts      # Layer 2: MCP registry & proxy
│   ├── egress.ts          # Layer 3: Data egress monitor
│   └── patterns.ts        # Detection patterns for egress
```

### Dashboard Module

```
src/dashboard/
├── index.ts               # Server setup, routes
├── server.ts              # Express/Fastify server
├── websocket.ts           # Real-time updates
├── db.ts                  # SQLite schema & queries
├── views/
│   ├── overview.ts        # Health summary, alerts
│   ├── ward.ts            # Exposure, connectors, egress
│   ├── policy.ts          # Command blocks, risk scores, violations
│   ├── observability.ts   # Metrics, costs, session history
│   ├── bro.ts             # AI sidekick status, routing stats
│   ├── transparency.ts    # Agent configs, permissions
│   └── safety.ts          # Undo stack, rollback history
└── static/                # Frontend assets
```

### Integration Points

- `PolicyEngine` integrates with Ward modules
- All modules feed events to unified SQLite database
- Dashboard reads from database, receives real-time updates via WebSocket
- CLI commands for headless/SSH access to all dashboard data

---

## Layer 1: Network Exposure Scanner

Detects when agent servers are accessible without proper authentication.

### Detection Pipeline

```
1. Process Discovery     → Find running agent processes (Claude Code, Aider, etc.)
2. Port Analysis         → Check what ports they're bound to (0.0.0.0 vs 127.0.0.1)
3. Config Inspection     → Read agent configs for auth settings, allowed origins
4. External Probe (opt)  → Call out to confirm external reachability
5. Risk Assessment       → Score exposure severity (low/medium/high/critical)
6. Response              → Alert, block, or remediate based on severity config
```

### Severity Levels & Default Responses

| Severity | Condition | Default Action |
|----------|-----------|----------------|
| Low | Bound to 0.0.0.0 but auth enabled | Alert only |
| Medium | Bound to 0.0.0.0, auth unclear | Alert + warn user |
| High | Externally reachable, no auth | Block incoming |
| Critical | Exposed with active sessions | Block + kill listener |

### Pre-configured Agent Signatures

```yaml
agents:
  claude-code:
    process_names: ["claude", "claude-code"]
    default_ports: [3000, 8080]
    config_paths: ["~/.claude/*", ".claude/*"]
    auth_indicators: ["apiKey", "authToken", "password"]
  aider:
    process_names: ["aider"]
    default_ports: [8501]
  continue:
    process_names: ["continue"]
    default_ports: [65432]
  cursor:
    process_names: ["cursor"]
    default_ports: [3000]
```

Users can add custom agents in configuration.

---

## Layer 2: Connector Registry & MCP Proxy

Audits and monitors all MCP server connections with full telemetry.

### MCP Proxy Architecture

When an agent spawns an MCP server, BashBros interposes:

```
Agent  ←→  BashBros MCP Proxy  ←→  Actual MCP Server
              │
              ├── Log all JSON-RPC messages
              ├── Extract capabilities on initialize
              ├── Track resource access (files, contacts, etc.)
              └── Feed telemetry to dashboard
```

### Interception Method

- Hook into agent startup via existing BashBros hooks
- Set `MCP_PROXY=bashbros-mcp-proxy` environment variable
- Proxy spawns the real server, sits in the middle of stdio

### Telemetry Capture

```typescript
interface ConnectorEvent {
  timestamp: Date;
  connector: string;           // "mcp-imessage", "mcp-slack", etc.
  method: string;              // "sendMessage", "readFile", etc.
  direction: "inbound" | "outbound";
  payload: RedactedPayload;    // Content with secrets masked
  resourcesAccessed: string[]; // ["/path/to/file", "contact:+1234567890"]
}
```

### Redaction Rules

- API keys, tokens → `[REDACTED:API_KEY]`
- Phone numbers → `+1******7890`
- Email addresses → `u***@domain.com`
- Full content preserved in encrypted local store (user can decrypt for investigation)

### Control Model

Audit-only by default. User gets full visibility but BashBros doesn't block connector activity. Users can enable blocking in configuration if desired.

---

## Layer 3: Data Egress Monitor

Detects and blocks sensitive data before it leaves the system.

### Inspection Points

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Egress Monitor                       │
├─────────────────────────────────────────────────────────────┤
│  MCP Proxy (Layer 2)  ──→  Content Inspection  ──→ Block?   │
│                                    │                         │
│  Process Network Mon  ──→  Destination Check  ──→ Alert?    │
└─────────────────────────────────────────────────────────────┘
```

This approach provides:
- Full content inspection for all MCP connectors (where messaging risk lives)
- Connection-level visibility for direct network calls
- No complex proxy infrastructure or OS-level packet capture
- Cross-platform support (Windows, Mac, Linux)

### Detection Patterns (shipped defaults)

```yaml
patterns:
  credentials:
    - name: api_key
      regex: '(?i)(api[_-]?key|apikey)["\s:=]+["\']?[\w-]{20,}'
      severity: critical
      action: block
    - name: aws_secret
      regex: '(?i)aws[_-]?secret[_-]?access[_-]?key.*[\w/+=]{40}'
      severity: critical
      action: block
    - name: private_key
      regex: '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
      severity: critical
      action: block

  pii:
    - name: ssn
      regex: '\b\d{3}-\d{2}-\d{4}\b'
      severity: high
      action: block
    - name: credit_card
      regex: '\b(?:\d[ -]*?){13,16}\b'
      severity: high
      action: block
    - name: email
      regex: '\b[\w.-]+@[\w.-]+\.\w{2,}\b'
      severity: medium
      action: alert

  custom: []  # User-defined patterns
```

### Blocking Flow

1. Content arrives at inspection point
2. Run through pattern matchers
3. If match found:
   - Log event with context (what, where, which connector)
   - If action=block: hold the message, notify user
   - User can: approve (one-time), approve (always for this pattern), deny
4. Dashboard shows pending blocks for review

### Default Behavior

Block + alert by default, configurable per pattern or data type.

---

## Unified Dashboard

### Technology Stack

- Lightweight local web server (Express or Fastify)
- SQLite for persistent storage
- Simple static frontend (vanilla JS or Preact - minimal dependencies)
- WebSocket for real-time updates

### Dashboard Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  BashBros Dashboard                              localhost:7890   │
├────────────┬─────────────────────────────────────────────────────┤
│            │                                                      │
│  Overview  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │
│            │  │ Ward   │ │ Policy │ │ Session│ │ BashBro│       │
│  Ward      │  │  ✓ OK  │ │ 3 block│ │ $0.42  │ │ ● ready│       │
│  ├ Exposure│  └────────┘ └────────┘ └────────┘ └────────┘       │
│  ├ Connect │                                                      │
│  └ Egress  │  Alerts                                              │
│            │  ─────────────────────────────────────────────       │
│  Policy    │  ⚠ High-risk command blocked (rm -rf)               │
│  ├ Commands│  ⚠ MCP connector sending to unknown destination     │
│  ├ Paths   │  ✓ Exposure scan clean                              │
│  └ Secrets │                                                      │
│            │  Recent Activity                                     │
│  Observe   │  ─────────────────────────────────────────────       │
│  ├ Metrics │  12:34 policy    blocked rm -rf /                   │
│  ├ Costs   │  12:33 ward      mcp-slack sendMessage              │
│  └ History │  12:30 bro       routed task to local model         │
│            │  12:28 safety    checkpoint created                  │
│  BashBro   │                                                      │
│            │                                                      │
│  Agents    │                                                      │
│            │                                                      │
│  Safety    │                                                      │
│            │                                                      │
│  Settings  │                                                      │
└────────────┴─────────────────────────────────────────────────────┘
```

### Dashboard Sections

| Section | Data Shown |
|---------|------------|
| **Overview** | Health cards, active alerts, unified activity stream |
| **Ward** | Exposure status, active connectors, blocked egress queue |
| **Policy** | Blocked commands, path violations, secrets caught, risk distribution |
| **Observe** | Command count, token usage, cost estimate, session timeline |
| **BashBro** | Ollama status, tasks routed, suggestions given, model info |
| **Agents** | Discovered agents, their configs, permissions, MCP servers |
| **Safety** | Undo stack, file snapshots, rollback actions |
| **Settings** | All config in one place, pattern editor, threshold tuning |

---

## CLI Commands

### Ward Commands

```bash
# Overall status
bashbros ward status           # Summary of all three layers
bashbros ward scan             # Run exposure scan now

# Exposure (Layer 1)
bashbros ward exposure list    # Show detected agents and their status
bashbros ward exposure scan    # Force immediate scan
bashbros ward exposure fix     # Attempt auto-remediation of issues

# Connectors (Layer 2)
bashbros ward connectors       # List active MCP servers
bashbros ward connectors log   # Recent connector activity
bashbros ward connectors inspect <name>  # Detail on specific connector

# Egress (Layer 3)
bashbros ward blocked          # Show pending blocked items
bashbros ward approve <id>     # Approve a blocked item
bashbros ward deny <id>        # Deny and drop a blocked item
bashbros ward patterns list    # Show active detection patterns
bashbros ward patterns test "string"  # Test if string matches any pattern
```

### Dashboard Commands

```bash
bashbros dashboard             # Start dashboard (if not running)
bashbros dashboard stop        # Stop dashboard
```

### Integration with Existing Commands

```bash
bashbros doctor    # Now includes ward health checks
bashbros status    # Shows ward summary alongside other info
bashbros watch     # Ward monitoring included in watch mode
```

---

## Configuration

### Extension to `bashbros.yaml`

```yaml
ward:
  enabled: true

  exposure:
    scan_interval: 60          # seconds between scans
    external_probe: false      # opt-in external reachability check
    severity_actions:
      low: alert
      medium: alert
      high: block
      critical: block_and_kill
    agents:
      # Custom agents beyond built-in list
      - name: my-internal-tool
        process_names: ["my-tool"]
        default_ports: [9000]
        config_paths: ["~/.my-tool/config.json"]

  connectors:
    proxy_all_mcp: true        # wrap all MCP servers
    telemetry_retention: 7d    # how long to keep logs
    redaction:
      encrypt_full_payloads: true
      encryption_key_path: ~/.bashbros/ward.key

  egress:
    default_action: block      # block | alert | log
    patterns_file: ~/.bashbros/egress-patterns.yaml  # custom patterns
    allowlist:
      - connector: mcp-github
        pattern: email         # allow emails to flow to GitHub
      - destination: api.anthropic.com
        action: allow          # trusted destination

dashboard:
  enabled: true
  port: 7890
  bind: 127.0.0.1              # localhost only by default
```

### Custom Patterns File (`egress-patterns.yaml`)

```yaml
custom:
  - name: internal_project_id
    regex: 'PROJ-[A-Z]{2}-\d{6}'
    severity: high
    action: block
    description: "Internal project identifiers"

  - name: customer_id
    regex: 'CUST-\d{8}'
    severity: medium
    action: alert
    description: "Customer identifiers"
```

---

## Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| MCP proxy can't start | Fall back to audit-only mode, alert user, log connector activity without interception |
| Dashboard port in use | Try next port (7891, 7892...), notify user of actual port |
| External probe fails | Mark as "unknown exposure", don't assume safe or unsafe |
| Pattern match is ambiguous | Block and ask user rather than guess |
| Agent process crashes while blocked | Release block, log the event, don't hold orphaned data |
| SQLite database locked | Queue events in memory, retry writes, warn if queue grows |
| User approves something dangerous | Log the override with full context for audit trail |

### Graceful Degradation

If any layer fails, the others continue independently. Ward never takes down the agent it's protecting.

---

## Implementation Phases

### Phase 1: Foundation
- SQLite schema for unified event store
- `src/dashboard/` scaffolding (server, db, websocket)
- Basic CLI: `bashbros dashboard` to start/stop
- Configuration schema updates

### Phase 2: Dashboard Core
- Overview page with health cards
- Policy view (pulling from existing PolicyEngine)
- Observability view (pulling from existing metrics/cost)
- BashBro view (pulling from existing bro module)
- Safety view (pulling from existing undo-stack)
- Agents view (pulling from existing transparency module)

### Phase 3: Ward - Exposure Scanner
- `src/policy/ward/exposure.ts`
- Process discovery, port analysis, config inspection
- Exposure view in dashboard
- CLI: `bashbros ward exposure`

### Phase 4: Ward - Connector Registry
- `src/policy/ward/connectors.ts`
- MCP stdio proxy
- Telemetry capture with redaction
- Connectors view in dashboard
- CLI: `bashbros ward connectors`

### Phase 5: Ward - Egress Monitor
- `src/policy/ward/egress.ts` and `patterns.ts`
- Content inspection, process network monitoring
- Block queue with approve/deny
- Egress view in dashboard
- CLI: `bashbros ward blocked`, `approve`, `deny`

---

## Open Questions

1. Should the dashboard require authentication for local access?
2. Should we support remote dashboard access (with auth)?
3. What's the retention policy for telemetry data?
4. Should we integrate with external alerting (PagerDuty, Slack webhooks)?
