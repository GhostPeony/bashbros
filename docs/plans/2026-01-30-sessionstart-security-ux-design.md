# SessionStart Hook & Security UX Design

## Overview

Two related improvements to BashBros:

1. **SessionStart hook** -- Create sessions in the DB immediately when Claude Code starts, collect metadata, and pre-load the shared context store.
2. **Security UX** -- Standardize violation messages with actionable remediation, and add self-healing overrides so Claude can unblock itself mid-session.

---

## Part 1: SessionStart Hook

### Problem

BashBros lazily creates sessions on the first `PreToolUse` or `PostToolUse` event. This means:
- The dashboard doesn't show the session until the first tool use
- No metadata is captured at session start (git branch, config profile)
- The context store isn't pre-loaded, adding latency to the first tool use

### Architecture

New CLI command: `bashbros session-start`

When Claude Code fires the `SessionStart` hook, BashBros:

1. Extracts session ID (same logic as existing hooks: `session_id` field > `CLAUDE_SESSION_ID` env > `ppid-${process.ppid}`)
2. Creates the session record in the DB via `ensureHookSession()`
3. Collects optional metadata (git branch, repo info, config profile)
4. Pre-loads the shared context store
5. Exits with code 0, **no stdout output**

### Configuration

```yaml
sessionStart:
  enabled: true              # Master toggle for the hook
  collectMetadata: true      # Collect git branch, repo info, config profile
  ollamaStatus: false        # Check Ollama availability (adds latency)
  preloadContext: true        # Warm up the shared context store
```

Each sub-feature is independently toggleable. If `enabled: false`, the hook still runs but only creates the bare session record.

### Hook Installation

Adds to `~/.claude/settings.json`:

```json
"SessionStart": [{
  "hooks": [{
    "type": "command",
    "command": "bashbros session-start # bashbros-managed"
  }]
}]
```

### Metadata Collected

When `collectMetadata: true`:

| Field | Source | Example |
|-------|--------|---------|
| `git_branch` | `git rev-parse --abbrev-ref HEAD` | `main` |
| `git_dirty` | `git status --porcelain` | `true` |
| `repo_name` | basename of git root | `bashbros` |
| `config_profile` | Parsed from `.bashbros.yml` | `permissive` |
| `agent` | From stdin event or detection | `claude-code` |
| `working_dir` | From stdin `cwd` field | `/Users/Cade/projects/bashbros` |
| `node_version` | `process.version` | `v22.1.0` |

When `ollamaStatus: true` (opt-in):

| Field | Source | Example |
|-------|--------|---------|
| `ollama_available` | HTTP ping to Ollama | `true` |
| `ollama_model` | Active model from config | `llama3.2` |

### DB Storage

New JSON column on `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN metadata TEXT DEFAULT '{}';
```

New method: `updateSessionMetadata(sessionId, metadata)` on `DashboardDB`.

### Context Pre-loading

When `preloadContext: true`:
- Reads `.bashbros/context/` memory files into the context store cache
- No DB write, just ensures the file-based store is warm
- If the directory doesn't exist, silently skips

### Error Handling

Fail-open. Same philosophy as all existing hooks:
- If git commands fail, metadata is partial
- If DB write fails, session still works
- If context store doesn't exist, skip silently
- All errors go to stderr, never stdout
- Exit 0 always

---

## Part 2: Security UX -- Self-Healing Overrides

### Problem

When BashBros blocks a command mid-session, users are stuck. They'd have to open a separate terminal and edit `.bashbros.yml`. Error messages say what happened but not how to fix it.

### Self-Healing Flow

When a command is blocked, the stderr message includes the exact `bashbros allow` command to run:

```
[BashBros] Blocked: 'curl https://api.example.com' not in allowlist (risk: 3/10)
To allow for this session: bashbros allow "curl *" --session
To allow permanently: add "curl *" to .bashbros.yml commands.allow
```

Claude sees the stderr and can:
1. Run `bashbros allow "curl *" --session`
2. Retry the original command
3. The command now succeeds

### Pattern Generation

When generating suggested allow patterns from blocked commands:
- Extract the base command (first word): `curl`, `docker`, `npm`
- Suggest `<base> *` as the pattern (broad but safe)
- For known safe commands (git, npm, node), suggest the specific subcommand pattern

### Configuration

```yaml
security:
  showRemediation: true    # Show allow hints in block messages
  autoSuggestPattern: true # Auto-generate allow patterns
```

Both toggleable. If `showRemediation: false`, block messages stay terse.

---

## Part 3: Enhanced Violation Messages

### Standardized Format

All security modules return violations with this structure:

```typescript
interface EnhancedViolation {
  type: string           // 'command' | 'path' | 'secret' | 'rate' | 'loop' | 'anomaly'
  message: string        // Human-readable description
  remediation: string[]  // Actionable steps to resolve
  severity: 'low' | 'medium' | 'high' | 'critical'
}
```

### Module-by-Module Messages

**Command Filter:**
```
Before: "Command not in allowlist"
After:  "Blocked: 'docker compose up' not in allowlist (risk: 2/10)
         To allow: bashbros allow "docker *" --session"
```

**Path Sandbox:**
```
Before: "Path is outside allowed directories: /etc/hosts"
After:  "Blocked: /etc/hosts is outside your sandbox [~/projects]
         Allowed dirs: ~/projects, ~/Documents
         To allow: bashbros allow-path "/etc/hosts" --session"
```

**Secrets Guard:**
```
Before: "Command may expose secrets"
After:  "Blocked: command accesses .env (environment secrets)
         Risk: credential exposure
         To allow: bashbros allow "cat .env" --session --acknowledge-secret"
```

**Rate Limiter:**
```
Before: "Rate limit exceeded: 101/100 commands per minute"
After:  "Rate limited: 101/100 commands per minute. Cooling off.
         Retry in ~12s, or adjust: bashbros config set rateLimit.maxPerMinute 200"
```

**Loop Detector:**
```
Before: "Command repeated 4 times: 'npm test...'"
After:  "Loop detected: 'npm test' repeated 4 times
         The agent may be stuck. Consider intervening manually."
```

**Anomaly Detector:**
```
Before: "Activity outside normal hours (3:00)"
After:  "Unusual: activity at 3:00 AM (outside your baseline pattern)
         Info only - command was still allowed"
```

### Principle

Every block message includes at least one actionable remediation step. Warnings (non-blocking) explain why the alert fired but don't suggest overrides.

---

## Files to Modify

### SessionStart Hook

1. **`src/cli.ts`** -- Add `session-start` subcommand
2. **`src/hooks/claude-code.ts`** -- Add SessionStart to install/uninstall/status
3. **`src/dashboard/db.ts`** -- Add metadata column and methods
4. **`src/dashboard/writer.ts`** -- Add `updateSessionMetadata()` method
5. **`src/config.ts`** -- Add `sessionStart` config section with defaults
6. **`src/types.ts`** -- Add `SessionStartConfig` type

### Security UX

7. **`src/cli.ts`** (gate command) -- Enhanced stderr output with remediation hints
8. **`src/policy/engine.ts`** -- Return `EnhancedViolation` type
9. **`src/policy/command-filter.ts`** -- Enhanced violation messages
10. **`src/policy/path-sandbox.ts`** -- Enhanced violation messages
11. **`src/policy/secrets-guard.ts`** -- Enhanced violation messages
12. **`src/policy/rate-limiter.ts`** -- Enhanced violation messages with cooldown info
13. **`src/policy/loop-detector.ts`** -- Enhanced violation messages
14. **`src/policy/anomaly-detector.ts`** -- Enhanced violation messages
15. **`src/types.ts`** -- Add `EnhancedViolation` interface
16. **`src/allow.ts`** -- Verify `--session` flag works in hook mode

### Tests

17. **`src/hooks/claude-code.test.ts`** -- SessionStart install/uninstall tests
18. **`src/cli.test.ts`** or new test file -- session-start command tests
19. **`src/policy/*.test.ts`** -- Update violation message assertions
