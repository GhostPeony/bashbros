import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AuditPolicy, AuditEntry } from './types.js'

// Maximum log file size before rotation (10MB)
const MAX_LOG_SIZE = 10 * 1024 * 1024
// Number of rotated logs to keep
const MAX_ROTATED_LOGS = 5

export class AuditLogger {
  private logPath: string
  private lockPath: string

  constructor(private policy: AuditPolicy) {
    const bashbrosDir = join(homedir(), '.bashbros')

    if (!existsSync(bashbrosDir)) {
      mkdirSync(bashbrosDir, { recursive: true, mode: 0o700 })
    }

    this.logPath = join(bashbrosDir, 'audit.log')
    this.lockPath = join(bashbrosDir, 'audit.lock')
  }

  log(entry: AuditEntry): void {
    if (!this.policy.enabled) {
      return
    }

    const logLine = this.formatEntry(entry)

    if (this.policy.destination === 'local' || this.policy.destination === 'both') {
      this.writeLocal(logLine)
    }

    if (this.policy.destination === 'remote' || this.policy.destination === 'both') {
      this.sendRemote(entry)
    }
  }

  private formatEntry(entry: AuditEntry): string {
    const status = entry.allowed ? 'ALLOWED' : 'BLOCKED'
    const violations = entry.violations.length > 0
      ? ` [${entry.violations.map(v => v.type).join(', ')}]`
      : ''

    // SECURITY: Sanitize command output (remove control characters)
    const sanitizedCommand = entry.command
      .replace(/[\x00-\x1f\x7f]/g, '')
      .slice(0, 1000) // Limit command length in logs

    return `[${entry.timestamp.toISOString()}] ${status}${violations} (${entry.duration}ms) ${sanitizedCommand}\n`
  }

  /**
   * SECURITY FIX: Write with file locking and rotation
   */
  private writeLocal(logLine: string): void {
    try {
      // Simple file-based locking
      this.acquireLock()

      try {
        // Check if rotation needed
        this.rotateIfNeeded()

        // Append to log
        appendFileSync(this.logPath, logLine, { mode: 0o600 })
      } finally {
        this.releaseLock()
      }
    } catch (error) {
      console.error('Failed to write audit log:', error)
    }
  }

  /**
   * Simple file-based locking
   */
  private acquireLock(): void {
    const maxAttempts = 10
    const waitMs = 50

    for (let i = 0; i < maxAttempts; i++) {
      try {
        // Try to create lock file exclusively
        writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' })
        return
      } catch (error: any) {
        if (error.code === 'EEXIST') {
          // Lock exists, check if stale (older than 5 seconds)
          try {
            const stats = statSync(this.lockPath)
            if (Date.now() - stats.mtimeMs > 5000) {
              // Stale lock, remove it
              try {
                require('fs').unlinkSync(this.lockPath)
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }

          // Wait and retry
          this.sleep(waitMs)
        } else {
          throw error
        }
      }
    }

    // Fallback: proceed without lock (better than failing)
    console.warn('Could not acquire audit log lock, proceeding without')
  }

  private releaseLock(): void {
    try {
      require('fs').unlinkSync(this.lockPath)
    } catch { /* ignore */ }
  }

  private sleep(ms: number): void {
    const end = Date.now() + ms
    while (Date.now() < end) {
      // Busy wait (synchronous)
    }
  }

  /**
   * Rotate log if it exceeds max size
   */
  private rotateIfNeeded(): void {
    try {
      if (!existsSync(this.logPath)) return

      const stats = statSync(this.logPath)
      if (stats.size < MAX_LOG_SIZE) return

      // Rotate logs
      for (let i = MAX_ROTATED_LOGS - 1; i >= 0; i--) {
        const oldPath = i === 0 ? this.logPath : `${this.logPath}.${i}`
        const newPath = `${this.logPath}.${i + 1}`

        if (existsSync(oldPath)) {
          if (i === MAX_ROTATED_LOGS - 1) {
            // Delete oldest
            require('fs').unlinkSync(oldPath)
          } else {
            renameSync(oldPath, newPath)
          }
        }
      }
    } catch (error) {
      console.error('Failed to rotate audit log:', error)
    }
  }

  /**
   * SECURITY FIX: Secure remote transmission with HTTPS enforcement
   */
  private async sendRemote(entry: AuditEntry): Promise<void> {
    if (!this.policy.remotePath) {
      return
    }

    // SECURITY: Validate URL
    let url: URL
    try {
      url = new URL(this.policy.remotePath)
    } catch {
      console.error('Invalid remote audit URL')
      return
    }

    // SECURITY: Only allow HTTPS
    if (url.protocol !== 'https:') {
      console.error('Remote audit path must use HTTPS')
      return
    }

    // SECURITY: Sanitize entry before sending
    const sanitizedEntry = {
      timestamp: entry.timestamp.toISOString(),
      command: entry.command.slice(0, 1000), // Limit size
      allowed: entry.allowed,
      violations: entry.violations.map(v => ({
        type: v.type,
        rule: v.rule.slice(0, 200),
        message: v.message.slice(0, 500)
      })),
      duration: entry.duration,
      agent: entry.agent
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000) // 5s timeout

      await fetch(this.policy.remotePath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'BashBros/0.1.0'
        },
        body: JSON.stringify(sanitizedEntry),
        signal: controller.signal
      })

      clearTimeout(timeout)
    } catch (error) {
      // Silently fail for remote - don't block main operation
      // Could implement retry queue here
    }
  }

  getLogPath(): string {
    return this.logPath
  }
}

export async function viewAudit(options: { lines: string; violations: boolean }): Promise<void> {
  const logPath = join(homedir(), '.bashbros', 'audit.log')

  if (!existsSync(logPath)) {
    console.log('No audit log found. Run some commands first.')
    return
  }

  const content = readFileSync(logPath, 'utf-8')
  let lines = content.trim().split('\n')

  if (options.violations) {
    lines = lines.filter(line => line.includes('BLOCKED'))
  }

  const numLines = parseInt(options.lines, 10) || 50
  lines = lines.slice(-numLines)

  for (const line of lines) {
    if (line.includes('BLOCKED')) {
      console.log('\x1b[31m' + line + '\x1b[0m') // Red
    } else {
      console.log('\x1b[32m' + line + '\x1b[0m') // Green
    }
  }
}
