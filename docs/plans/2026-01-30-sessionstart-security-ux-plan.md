# SessionStart Hook & Security UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a SessionStart hook that creates sessions immediately with rich metadata, and enhance all security violation messages with actionable remediation so Claude can self-heal blocked commands.

**Architecture:** New `session-start` CLI command triggered by Claude Code's SessionStart hook. Enhanced `PolicyViolation` type with `remediation` and `severity` fields. Gate command stderr output includes `bashbros allow` hints so Claude can unblock itself. All features configurable via `.bashbros.yml`.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Commander.js

---

### Task 1: Add EnhancedViolation type and SessionStartConfig to types.ts

**Files:**
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Create test file `src/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import type { PolicyViolation, SessionStartConfig } from './types.js'

describe('PolicyViolation type', () => {
  it('accepts remediation and severity fields', () => {
    const v: PolicyViolation = {
      type: 'command',
      rule: 'test',
      message: 'blocked',
      remediation: ['bashbros allow "curl *" --once'],
      severity: 'medium'
    }
    expect(v.remediation).toHaveLength(1)
    expect(v.severity).toBe('medium')
  })

  it('works without optional fields (backward compat)', () => {
    const v: PolicyViolation = {
      type: 'command',
      rule: 'test',
      message: 'blocked'
    }
    expect(v.remediation).toBeUndefined()
    expect(v.severity).toBeUndefined()
  })
})

describe('SessionStartConfig type', () => {
  it('has all required fields', () => {
    const config: SessionStartConfig = {
      enabled: true,
      collectMetadata: true,
      ollamaStatus: false,
      preloadContext: true
    }
    expect(config.enabled).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/types.test.ts`
Expected: FAIL - `SessionStartConfig` does not exist, `remediation` and `severity` not on `PolicyViolation`

**Step 3: Add the types**

In `src/types.ts`, add to `PolicyViolation` interface (around line 147):
```typescript
export interface PolicyViolation {
  type: 'command' | 'path' | 'secrets' | 'rate_limit' | 'risk_score' | 'loop' | 'anomaly' | 'output'
  rule: string
  message: string
  remediation?: string[]
  severity?: 'low' | 'medium' | 'high' | 'critical'
}
```

Add new interface after `DashboardPolicy` (around line 219):
```typescript
export interface SessionStartConfig {
  enabled: boolean
  collectMetadata: boolean
  ollamaStatus: boolean
  preloadContext: boolean
}
```

Add `sessionStart` to `BashBrosConfig` (around line 17):
```typescript
export interface BashBrosConfig {
  // ... existing fields ...
  dashboard: DashboardPolicy
  sessionStart: SessionStartConfig
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: add EnhancedViolation fields and SessionStartConfig type"
```

---

### Task 2: Add sessionStart config defaults and validation to config.ts

**Files:**
- Modify: `src/config.ts`

**Step 1: Write the failing test**

Create test file `src/config.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { getDefaultConfig, loadConfig } from './config.js'

describe('sessionStart config', () => {
  it('has sessionStart defaults', () => {
    const config = getDefaultConfig()
    expect(config.sessionStart).toBeDefined()
    expect(config.sessionStart.enabled).toBe(true)
    expect(config.sessionStart.collectMetadata).toBe(true)
    expect(config.sessionStart.ollamaStatus).toBe(false)
    expect(config.sessionStart.preloadContext).toBe(true)
  })

  it('merges sessionStart from parsed config', () => {
    // When no config file, defaults should apply
    const config = getDefaultConfig()
    expect(config.sessionStart.enabled).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL - `config.sessionStart` is undefined

**Step 3: Add sessionStart config**

In `src/config.ts`, update the import to include `SessionStartConfig`:
```typescript
import type {
  BashBrosConfig,
  SecurityProfile,
  // ... existing imports ...
  DashboardPolicy,
  SessionStartConfig
} from './types.js'
```

Add default function (after `getDefaultDashboard` around line 473):
```typescript
function getDefaultSessionStart(): SessionStartConfig {
  return {
    enabled: true,
    collectMetadata: true,
    ollamaStatus: false,
    preloadContext: true
  }
}
```

Add to `getDefaultConfig()` return (around line 367):
```typescript
  return {
    // ... existing fields ...
    dashboard: getDefaultDashboard(),
    sessionStart: getDefaultSessionStart()
  }
```

Add validation block in `validateConfig()` (after outputScanning validation, around line 223):
```typescript
  // Validate sessionStart
  if (config.sessionStart && typeof config.sessionStart === 'object') {
    const ss = config.sessionStart as Record<string, unknown>
    validated.sessionStart = {
      enabled: typeof ss.enabled === 'boolean' ? ss.enabled : true,
      collectMetadata: typeof ss.collectMetadata === 'boolean' ? ss.collectMetadata : true,
      ollamaStatus: typeof ss.ollamaStatus === 'boolean' ? ss.ollamaStatus : false,
      preloadContext: typeof ss.preloadContext === 'boolean' ? ss.preloadContext : true
    }
  }
```

Add to `mergeWithDefaults()` (around line 636):
```typescript
    sessionStart: { ...defaults.sessionStart, ...parsed.sessionStart },
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: add sessionStart config section with defaults"
```

---

### Task 3: Add metadata column to sessions table in db.ts

**Files:**
- Modify: `src/dashboard/db.ts`

**Step 1: Write the failing test**

Create `src/dashboard/db-metadata.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DashboardDB } from './db.js'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = join(import.meta.dirname, '..', '..', 'test-metadata.db')

describe('session metadata', () => {
  let db: DashboardDB

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    db = new DashboardDB(TEST_DB)
  })

  afterEach(() => {
    db.close()
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
  })

  it('stores and retrieves session metadata', () => {
    const id = db.insertSessionWithId('test-session', {
      agent: 'claude-code',
      pid: 1234,
      workingDir: '/tmp',
      repoName: null,
      mode: 'hook'
    })

    db.updateSessionMetadata(id, {
      git_branch: 'main',
      git_dirty: false,
      config_profile: 'permissive'
    })

    const session = db.getSession(id)
    expect(session).not.toBeNull()
    expect(session!.metadata).toEqual({
      git_branch: 'main',
      git_dirty: false,
      config_profile: 'permissive'
    })
  })

  it('returns empty metadata by default', () => {
    const id = db.insertSessionWithId('test-session-2', {
      agent: 'claude-code',
      pid: 1234,
      workingDir: '/tmp',
      repoName: null,
      mode: 'hook'
    })

    const session = db.getSession(id)
    expect(session).not.toBeNull()
    expect(session!.metadata).toEqual({})
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/dashboard/db-metadata.test.ts`
Expected: FAIL - `updateSessionMetadata` does not exist, `metadata` not on session

**Step 3: Add metadata column migration and methods**

In `src/dashboard/db.ts`:

1. Add metadata migration in the `runMigrations()` method (after the repo_name migration, around line 1930):
```typescript
    // Add metadata column to sessions
    try {
      const tableInfo = this.db.pragma('table_info(sessions)') as Array<{ name: string }>
      const hasMetadata = tableInfo.some(col => col.name === 'metadata')
      if (!hasMetadata) {
        this.db.exec("ALTER TABLE sessions ADD COLUMN metadata TEXT DEFAULT '{}'")
      }
    } catch {
      // Table doesn't exist yet or already migrated
    }
```

2. Add `updateSessionMetadata` method (after `incrementSessionCommand`, around line 1018):
```typescript
  /**
   * Update session metadata (JSON merge).
   */
  updateSessionMetadata(id: string, metadata: Record<string, unknown>): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET metadata = ? WHERE id = ?
    `)
    stmt.run(JSON.stringify(metadata), id)
  }
```

3. Update `getSession()` to parse metadata (around line 876). Add `metadata` to the row type and to the return mapping:
```typescript
  getSession(id: string): SessionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?')
    const row = stmt.get(id) as {
      // ... existing fields ...
      metadata?: string
    } | undefined

    if (!row) return null
    const session = this.rowToSession(row)
    return session
  }
```

4. Update `SessionRecord` type (or `rowToSession`) to include `metadata: Record<string, unknown>`. Parse the JSON string: `metadata: JSON.parse(row.metadata || '{}')`.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/dashboard/db-metadata.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/dashboard/db.ts src/dashboard/db-metadata.test.ts
git commit -m "feat: add metadata column to sessions table"
```

---

### Task 4: Add updateSessionMetadata to DashboardWriter

**Files:**
- Modify: `src/dashboard/writer.ts`

**Step 1: Add the method**

In `src/dashboard/writer.ts`, add after `endHookSession` (around line 123):
```typescript
  /**
   * Update session metadata (e.g., git branch, config profile)
   */
  updateSessionMetadata(metadata: Record<string, unknown>): void {
    if (!this.sessionId) return
    this.db.updateSessionMetadata(this.sessionId, metadata)
  }
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/dashboard/writer.ts
git commit -m "feat: add updateSessionMetadata to DashboardWriter"
```

---

### Task 5: Add SessionStart to ClaudeCodeHooks install/uninstall

**Files:**
- Modify: `src/hooks/claude-code.ts`
- Test: `src/hooks/claude-code.test.ts`

**Step 1: Write the failing test**

Add to `src/hooks/claude-code.test.ts`:
```typescript
describe('SessionStart hook', () => {
  it('install adds SessionStart hook', () => {
    // After ClaudeCodeHooks.install(), settings.hooks.SessionStart should exist
    // This test depends on the install method adding SessionStart
    const settings: ClaudeSettings = { hooks: {} }
    // Check that install would add SessionStart
    // (test the settings object after install modifies it)
  })
})
```

Note: The exact test structure depends on the existing test patterns in `claude-code.test.ts`. The key assertion is that after `install()`, `settings.hooks.SessionStart` contains a hook with `bashbros session-start # bashbros-managed`.

**Step 2: Update install() method**

In `src/hooks/claude-code.ts`, add a SessionStart hook in the `install()` method (around line 120, after SessionEnd):
```typescript
    // Add SessionStart hook for session initialization
    const sessionStartHook: HookConfig = {
      hooks: [{
        type: 'command',
        command: `bashbros session-start ${BASHBROS_HOOK_MARKER}`
      }]
    }

    settings.hooks.SessionStart = [
      ...(settings.hooks.SessionStart || []),
      sessionStartHook
    ]
```

Update the `ClaudeSettings` interface to include `SessionStart`:
```typescript
export interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookConfig[]
    PostToolUse?: HookConfig[]
    SessionEnd?: HookConfig[]
    SessionStart?: HookConfig[]
    UserPromptSubmit?: HookConfig[]
  }
  [key: string]: unknown
}
```

Update `uninstall()` to also remove SessionStart hooks (around line 178):
```typescript
    settings.hooks.SessionStart = filterHooks(settings.hooks.SessionStart)
    // ... in cleanup section:
    if (settings.hooks.SessionStart?.length === 0) delete settings.hooks.SessionStart
```

Update `isInstalled()` to check SessionStart:
```typescript
    return hasMarker(s.hooks.PreToolUse) ||
           hasMarker(s.hooks.PostToolUse) ||
           hasMarker(s.hooks.SessionEnd) ||
           hasMarker(s.hooks.SessionStart)
```

Update `getStatus()` to report SessionStart:
```typescript
    if (settings.hooks?.SessionStart) hooks.push('SessionStart (session-start)')
```

**Step 3: Run tests**

Run: `npx vitest run src/hooks/claude-code.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/hooks/claude-code.ts src/hooks/claude-code.test.ts
git commit -m "feat: add SessionStart hook to install/uninstall"
```

---

### Task 6: Add session-start CLI command

**Files:**
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

Create `src/cli-session-start.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { execSync } from 'child_process'

describe('session-start command', () => {
  it('exits 0 with empty stdin', () => {
    // session-start should always exit 0 (fail-open)
    const result = execSync('echo "{}" | node dist/cli.js session-start', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000
    })
    // No stdout output (critical for hooks)
    expect(result.trim()).toBe('')
  })
})
```

Note: This test requires a build first (`npm run build`). Alternatively, test the internal logic as a unit test.

**Step 2: Add the session-start command**

In `src/cli.ts`, add after the `record-prompt` command (around line 1109):
```typescript
program
  .command('session-start')
  .description('Initialize a session (used by SessionStart hook)')
  .option('--marker <marker>', 'Hook marker (ignored, used for identification)')
  .action(async () => {
    // CRITICAL: No stdout output. SessionStart stdout gets injected into Claude's context.
    // All errors go to stderr only.
    try {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(chunk)
      }
      const stdinData = Buffer.concat(chunks).toString('utf-8').trim()
      const event: Record<string, unknown> = stdinData ? JSON.parse(stdinData) : {}

      const hookSessionId = extractHookSessionId(event)
      const workingDir = (event.cwd as string) || process.cwd()
      const repoName = extractRepoName(event)

      const { DashboardWriter } = await import('./dashboard/writer.js')
      const writer = new DashboardWriter()

      // Create session record immediately
      writer.ensureHookSession(hookSessionId, workingDir, repoName)

      // Collect metadata if configured
      const cfg = loadConfig()
      if (cfg.sessionStart.enabled && cfg.sessionStart.collectMetadata) {
        const metadata: Record<string, unknown> = {
          node_version: process.version,
          agent: 'claude-code'
        }

        // Git info (fail silently)
        try {
          const { execSync } = await import('child_process')
          const opts = { encoding: 'utf-8' as const, timeout: 3000, cwd: workingDir, stdio: ['pipe', 'pipe', 'pipe'] as const }
          metadata.git_branch = execSync('git rev-parse --abbrev-ref HEAD', opts).trim()
          metadata.git_dirty = execSync('git status --porcelain', opts).trim().length > 0
        } catch {
          // Not a git repo or git not available
        }

        // Config profile
        metadata.config_profile = cfg.profile

        // Ollama status (opt-in, adds latency)
        if (cfg.sessionStart.ollamaStatus) {
          try {
            const resp = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) })
            metadata.ollama_available = resp.ok
          } catch {
            metadata.ollama_available = false
          }
        }

        writer.updateSessionMetadata(metadata)
      }

      // Pre-load context store (warm up)
      if (cfg.sessionStart.enabled && cfg.sessionStart.preloadContext) {
        try {
          const { ContextStore } = await import('./context/store.js')
          const store = new ContextStore(workingDir)
          store.listMemoryFiles() // Trigger directory reads to warm FS cache
        } catch {
          // Context store not initialized, skip silently
        }
      }

      writer.close()
    } catch (e) {
      // Errors to stderr only -- never stdout, never exit non-zero
      process.stderr.write(`[BashBros] Error in session-start: ${e instanceof Error ? e.message : e}\n`)
    }
  })
```

**Step 3: Build and verify**

Run: `npm run build && echo '{"session_id":"test-123","cwd":"."}' | node dist/cli.js session-start`
Expected: No stdout, exit 0

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add session-start CLI command for SessionStart hook"
```

---

### Task 7: Enhance CommandFilter violation messages

**Files:**
- Modify: `src/policy/command-filter.ts`
- Test: `src/policy/command-filter.test.ts`

**Step 1: Write the failing test**

Add to existing `src/policy/command-filter.test.ts`:
```typescript
describe('enhanced violation messages', () => {
  it('includes remediation for blocked pattern', () => {
    const filter = new CommandFilter({ allow: ['git *'], block: ['rm -rf *'] })
    const result = filter.check('rm -rf /')
    expect(result).not.toBeNull()
    expect(result!.remediation).toBeDefined()
    expect(result!.remediation!.length).toBeGreaterThan(0)
    expect(result!.severity).toBe('high')
  })

  it('includes remediation for not-in-allowlist', () => {
    const filter = new CommandFilter({ allow: ['git *'], block: [] })
    const result = filter.check('curl http://example.com')
    expect(result).not.toBeNull()
    expect(result!.remediation).toBeDefined()
    expect(result!.remediation!.some(r => r.includes('bashbros allow'))).toBe(true)
    expect(result!.severity).toBe('medium')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/policy/command-filter.test.ts`
Expected: FAIL - `remediation` and `severity` are undefined

**Step 3: Update CommandFilter**

In `src/policy/command-filter.ts`, update the `check` method:

For blocked pattern match (around line 16):
```typescript
        return {
          type: 'command',
          rule: `block[${i}]: ${this.policy.block[i]}`,
          message: `Blocked: '${command.slice(0, 60)}' matches dangerous pattern: ${this.policy.block[i]}`,
          remediation: [
            `If safe, run: bashbros allow "${this.extractBase(command)} *" --once`
          ],
          severity: 'high'
        }
```

For not-in-allowlist (around line 32):
```typescript
      return {
        type: 'command',
        rule: 'allow (no match)',
        message: `Blocked: '${command.slice(0, 60)}' not in allowlist`,
        remediation: [
          `To allow for this session: bashbros allow "${this.extractBase(command)} *" --once`,
          `To allow permanently: add "${this.extractBase(command)} *" to .bashbros.yml commands.allow`
        ],
        severity: 'medium'
      }
```

Add helper method:
```typescript
  private extractBase(command: string): string {
    return command.split(/\s+/)[0] || command
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/policy/command-filter.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/policy/command-filter.ts src/policy/command-filter.test.ts
git commit -m "feat: enhanced violation messages for command filter"
```

---

### Task 8: Enhance PathSandbox violation messages

**Files:**
- Modify: `src/policy/path-sandbox.ts`
- Test: `src/policy/path-sandbox.test.ts`

**Step 1: Write the failing test**

Add to existing `src/policy/path-sandbox.test.ts`:
```typescript
describe('enhanced violation messages', () => {
  it('includes remediation for blocked path', () => {
    const sandbox = new PathSandbox({ allow: ['.'], block: ['~/.ssh'] })
    const result = sandbox.check('~/.ssh/id_rsa')
    expect(result).not.toBeNull()
    expect(result!.remediation).toBeDefined()
    expect(result!.severity).toBe('high')
  })

  it('includes allowed dirs in outside-sandbox message', () => {
    const sandbox = new PathSandbox({ allow: ['.'], block: [] })
    const result = sandbox.check('/etc/passwd')
    if (result) {
      expect(result.message).toContain('outside')
      expect(result.remediation).toBeDefined()
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/policy/path-sandbox.test.ts`
Expected: FAIL

**Step 3: Update PathSandbox**

In `src/policy/path-sandbox.ts`:

For blocked path (around line 35):
```typescript
        return {
          type: 'path',
          rule: `block: ${blocked}`,
          message: `Blocked: ${path} is a protected path`,
          remediation: [
            `To allow for this session: bashbros allow-path "${path}" --once`
          ],
          severity: 'high'
        }
```

For symlink escape (around line 24):
```typescript
        return {
          type: 'path',
          rule: 'symlink_escape',
          message: `Blocked: symlink escape detected: ${path} -> ${realPath}`,
          remediation: [
            'Use the real path directly instead of the symlink'
          ],
          severity: 'critical'
        }
```

For outside sandbox (around line 54):
```typescript
      return {
        type: 'path',
        rule: 'allow (outside sandbox)',
        message: `Blocked: ${path} is outside allowed directories`,
        remediation: [
          `Allowed dirs: ${this.policy.allow.join(', ')}`,
          `To allow: add the path to .bashbros.yml paths.allow`
        ],
        severity: 'medium'
      }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/policy/path-sandbox.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/policy/path-sandbox.ts src/policy/path-sandbox.test.ts
git commit -m "feat: enhanced violation messages for path sandbox"
```

---

### Task 9: Enhance SecretsGuard violation messages

**Files:**
- Modify: `src/policy/secrets-guard.ts`
- Test: `src/policy/secrets-guard.test.ts`

**Step 1: Write the failing test**

Add to existing `src/policy/secrets-guard.test.ts`:
```typescript
describe('enhanced violation messages', () => {
  it('includes remediation for sensitive file access', () => {
    const guard = new SecretsGuard({
      enabled: true,
      mode: 'block',
      patterns: ['.env*', '*.pem']
    })
    const result = guard.check('cat .env', ['.env'])
    expect(result).not.toBeNull()
    expect(result!.remediation).toBeDefined()
    expect(result!.severity).toBe('critical')
  })

  it('includes what kind of secret was detected', () => {
    const guard = new SecretsGuard({
      enabled: true,
      mode: 'block',
      patterns: ['.env*']
    })
    const result = guard.check('cat .env.local', ['.env.local'])
    expect(result).not.toBeNull()
    expect(result!.message).toContain('.env')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/policy/secrets-guard.test.ts`
Expected: FAIL

**Step 3: Update SecretsGuard**

In `src/policy/secrets-guard.ts`:

For sensitive file access (around line 19):
```typescript
        return {
          type: 'secrets',
          rule: `pattern match: ${path}`,
          message: `Blocked: command accesses ${path} (sensitive file)`,
          remediation: [
            `Risk: credential or secret exposure`,
            `To allow: bashbros allow "${command.split(/\\s+/)[0]} ${path}" --once`
          ],
          severity: 'critical'
        }
```

For dangerous patterns (around line 119):
```typescript
        return {
          type: 'secrets',
          rule: 'dangerous pattern',
          message: `Blocked: command may expose secrets`,
          remediation: [
            `Risk: credential exposure via command pattern`,
            `Review the command carefully before allowing`
          ],
          severity: 'high'
        }
```

For encoded access (around line 130):
```typescript
        return {
          type: 'secrets',
          rule: 'encoded command',
          message: `Blocked: command contains encoded secret access attempt`,
          remediation: [
            `Risk: obfuscated credential access detected`,
            `This command appears to use encoding to bypass secret detection`
          ],
          severity: 'critical'
        }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/policy/secrets-guard.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/policy/secrets-guard.ts src/policy/secrets-guard.test.ts
git commit -m "feat: enhanced violation messages for secrets guard"
```

---

### Task 10: Enhance RateLimiter violation messages

**Files:**
- Modify: `src/policy/rate-limiter.ts`

**Step 1: Update RateLimiter**

In `src/policy/rate-limiter.ts`:

For per-minute limit (around line 18):
```typescript
      return {
        type: 'rate_limit',
        rule: `maxPerMinute: ${this.policy.maxPerMinute}`,
        message: `Rate limited: ${this.minuteWindow.length}/${this.policy.maxPerMinute} commands per minute`,
        remediation: [
          `Wait a few seconds before the next command`,
          `Or adjust: set rateLimit.maxPerMinute in .bashbros.yml`
        ],
        severity: 'medium'
      }
```

For per-hour limit (around line 27):
```typescript
      return {
        type: 'rate_limit',
        rule: `maxPerHour: ${this.policy.maxPerHour}`,
        message: `Rate limited: ${this.hourWindow.length}/${this.policy.maxPerHour} commands per hour`,
        remediation: [
          `Command throughput limit reached for this hour`,
          `Or adjust: set rateLimit.maxPerHour in .bashbros.yml`
        ],
        severity: 'medium'
      }
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/policy/rate-limiter.ts
git commit -m "feat: enhanced violation messages for rate limiter"
```

---

### Task 11: Enhance gate command stderr with self-healing hints

**Files:**
- Modify: `src/cli.ts`

**Step 1: Write the failing test**

This is best tested as an integration test or manually. The key change is in the non-interactive gate output (around line 951-954 in `cli.ts`).

**Step 2: Update the gate command's non-interactive block output**

In `src/cli.ts`, find the non-interactive block path (around line 951):

Replace:
```typescript
        console.error(`Blocked: ${result.reason}`)
```

With:
```typescript
        // Self-healing: include remediation hints Claude can act on
        const cfg = loadConfig()
        const baseCmd = command.split(/\s+/)[0]
        process.stderr.write(`[BashBros] Blocked: '${command.slice(0, 80)}' (risk: ${result.riskScore ?? '?'}/10)\n`)
        process.stderr.write(`[BashBros] Reason: ${result.reason}\n`)
        if (cfg.sessionStart?.enabled !== false) {
          process.stderr.write(`[BashBros] To allow for this session: bashbros allow "${baseCmd} *" --once\n`)
          process.stderr.write(`[BashBros] To allow permanently: add "${baseCmd} *" to .bashbros.yml commands.allow\n`)
        }
```

**Step 3: Build and test manually**

Run: `npm run build`
Then test with a command that would be blocked.

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add self-healing remediation hints to gate block messages"
```

---

### Task 12: Add --session flag to allow command

**Files:**
- Modify: `src/cli.ts` (the `allow` command registration)
- Modify: `src/allow.ts`

The current `allow` command uses `--once` which calls `allowForSession()`. The design doc specifies `--session`. We should add `--session` as an alias for `--once` for discoverability, since the gate hints will reference `--session`.

**Step 1: Update the allow command**

In `src/cli.ts`, update the allow command (around line 121):
```typescript
program
  .command('allow <command>')
  .description('Allow a specific command')
  .option('--once', 'Allow only for current session')
  .option('--session', 'Allow only for current session (alias for --once)')
  .option('--persist', 'Add to config permanently')
  .action(async (command, options) => {
    // Treat --session same as --once
    if (options.session) options.once = true
    await handleAllow(command, options)
  })
```

**Step 2: Update gate hints to use --once (matching existing flag)**

Actually, since `--once` already exists and works, update the gate stderr hints from Task 11 to say `--once` instead of `--session`:
```typescript
process.stderr.write(`[BashBros] To allow for this session: bashbros allow "${baseCmd} *" --once\n`)
```

**Step 3: Verify**

Run: `npm run build && bashbros allow "test *" --session`
Expected: `Allowed for this session: test *`

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --session alias for allow --once"
```

---

### Task 13: Run full test suite and fix regressions

**Files:**
- All modified files

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass. If any existing tests fail because they assert on old violation message strings, update them to match the new enhanced format.

**Step 2: Fix any failing tests**

Common fixes:
- Tests that check `result.message === 'Command not in allowlist'` need updating to match the new format
- Tests that check `result.message === 'Access to path is blocked: ...'` need updating
- Tests that check `result.message === 'Command may expose secrets'` need updating

**Step 3: Build check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit fixes**

```bash
git add -A
git commit -m "fix: update test assertions for enhanced violation messages"
```

---

### Task 14: Final integration test

**Step 1: Rebuild**

Run: `npm run build`

**Step 2: Test session-start hook end-to-end**

```bash
echo '{"session_id":"integration-test","cwd":"C:\\Users\\Cade\\projects\\bashbros"}' | node dist/cli.js session-start
```
Expected: No stdout, exit 0

**Step 3: Test hook install includes SessionStart**

```bash
# Check current settings (don't actually install to avoid clobbering existing hooks)
node -e "const {ClaudeCodeHooks} = require('./dist/hooks/claude-code.js'); console.log(ClaudeCodeHooks.getStatus())"
```

**Step 4: Test gate self-healing output**

```bash
echo '{"tool_input":{"command":"dangerous_unknown_cmd"}}' | node dist/cli.js gate 2>&1 >/dev/null
```
Expected: stderr shows `[BashBros] Blocked: ...` with remediation hints

**Step 5: Commit**

No code changes needed -- this is verification only. If everything passes, done.
