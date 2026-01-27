import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AuditPolicy, AuditEntry } from './types.js'

export class AuditLogger {
  private logPath: string

  constructor(private policy: AuditPolicy) {
    const bashbrosDir = join(homedir(), '.bashbros')

    if (!existsSync(bashbrosDir)) {
      mkdirSync(bashbrosDir, { recursive: true })
    }

    this.logPath = join(bashbrosDir, 'audit.log')
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

    return `[${entry.timestamp.toISOString()}] ${status}${violations} (${entry.duration}ms) ${entry.command}\n`
  }

  private writeLocal(logLine: string): void {
    try {
      appendFileSync(this.logPath, logLine)
    } catch (error) {
      console.error('Failed to write audit log:', error)
    }
  }

  private async sendRemote(entry: AuditEntry): Promise<void> {
    if (!this.policy.remotePath) {
      return
    }

    try {
      await fetch(this.policy.remotePath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      })
    } catch (error) {
      console.error('Failed to send audit log to remote:', error)
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

  const numLines = parseInt(options.lines, 10)
  lines = lines.slice(-numLines)

  for (const line of lines) {
    if (line.includes('BLOCKED')) {
      console.log('\x1b[31m' + line + '\x1b[0m') // Red
    } else {
      console.log('\x1b[32m' + line + '\x1b[0m') // Green
    }
  }
}
