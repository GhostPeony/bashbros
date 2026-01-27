import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import type { BashBrosConfig, CommandResult, PolicyViolation } from './types.js'
import { PolicyEngine } from './policy/engine.js'
import { AuditLogger } from './audit.js'
import { loadConfig } from './config.js'

export interface BashBrosEvents {
  command: (command: string) => void
  allowed: (result: CommandResult) => void
  blocked: (command: string, violations: PolicyViolation[]) => void
  output: (data: string) => void
  error: (error: Error) => void
}

export class BashBros extends EventEmitter {
  private config: BashBrosConfig
  private policy: PolicyEngine
  private audit: AuditLogger
  private ptyProcess: pty.IPty | null = null
  private shell: string
  private pendingCommand: string = ''
  private commandStartTime: number = 0

  constructor(configPath?: string) {
    super()
    this.config = loadConfig(configPath)
    this.policy = new PolicyEngine(this.config)
    this.audit = new AuditLogger(this.config.audit)
    this.shell = process.platform === 'win32' ? 'powershell.exe' : 'bash'
  }

  start(): void {
    this.ptyProcess = pty.spawn(this.shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string }
    })

    this.ptyProcess.onData((data: string) => {
      this.emit('output', data)
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', exitCode)
    })
  }

  execute(command: string): CommandResult {
    const startTime = Date.now()
    const violations = this.policy.validate(command)

    if (violations.length > 0) {
      const result: CommandResult = {
        command,
        allowed: false,
        duration: Date.now() - startTime,
        violations
      }

      this.audit.log({
        timestamp: new Date(),
        command,
        allowed: false,
        violations,
        duration: result.duration,
        agent: this.config.agent
      })

      this.emit('blocked', command, violations)
      return result
    }

    // Command is allowed - execute it
    this.commandStartTime = startTime
    this.pendingCommand = command

    if (this.ptyProcess) {
      this.ptyProcess.write(command + '\r')
    }

    const result: CommandResult = {
      command,
      allowed: true,
      duration: Date.now() - startTime,
      violations: []
    }

    this.audit.log({
      timestamp: new Date(),
      command,
      allowed: true,
      violations: [],
      duration: result.duration,
      agent: this.config.agent
    })

    this.emit('allowed', result)
    return result
  }

  validateOnly(command: string): PolicyViolation[] {
    return this.policy.validate(command)
  }

  isAllowed(command: string): boolean {
    return this.policy.isAllowed(command)
  }

  resize(cols: number, rows: number): void {
    if (this.ptyProcess) {
      this.ptyProcess.resize(cols, rows)
    }
  }

  write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data)
    }
  }

  stop(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill()
      this.ptyProcess = null
    }
  }

  getConfig(): BashBrosConfig {
    return this.config
  }
}
