import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'

export interface BackgroundTask {
  id: string
  command: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startTime: Date
  endTime?: Date
  output: string[]
  exitCode?: number
}

// Maximum tasks to keep in history
const MAX_TASK_HISTORY = 100

/**
 * Safely parse a command string into executable parts.
 * Prevents shell injection by NOT using shell: true
 */
function parseCommand(command: string): { cmd: string; args: string[] } {
  // Handle quoted strings properly
  const tokens: string[] = []
  let current = ''
  let inQuote: string | null = null

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (inQuote) {
      if (char === inQuote) {
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      inQuote = char
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    tokens.push(current)
  }

  return {
    cmd: tokens[0] || '',
    args: tokens.slice(1)
  }
}

/**
 * Validate command doesn't contain dangerous shell metacharacters
 */
function validateCommand(command: string): { valid: boolean; reason?: string } {
  // Block shell metacharacters that could enable injection
  const dangerousPatterns = [
    /[;&|`$]/, // Shell operators and command substitution
    /\$\(/, // Command substitution
    />\s*>/, // Append redirect
    />\s*\//, // Redirect to absolute path
    /<\s*\//, // Input from absolute path
    /\|\s*\w+/, // Pipe to command
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return {
        valid: false,
        reason: `Command contains potentially dangerous pattern: ${pattern.source}`
      }
    }
  }

  return { valid: true }
}

export class BackgroundWorker extends EventEmitter {
  private tasks: Map<string, BackgroundTask> = new Map()
  private processes: Map<string, ChildProcess> = new Map()
  private taskIdCounter = 0

  spawn(command: string, cwd?: string): BackgroundTask {
    // Validate command first
    const validation = validateCommand(command)
    if (!validation.valid) {
      throw new Error(`Security: ${validation.reason}`)
    }

    const id = `task_${++this.taskIdCounter}`

    const task: BackgroundTask = {
      id,
      command,
      status: 'running',
      startTime: new Date(),
      output: []
    }

    this.tasks.set(id, task)

    // Parse command safely
    const { cmd, args } = parseCommand(command)

    if (!cmd) {
      task.status = 'failed'
      task.endTime = new Date()
      task.output.push('Error: Empty command')
      return task
    }

    // SECURITY FIX: Use shell: false to prevent injection
    const proc = spawn(cmd, args, {
      cwd: cwd || process.cwd(),
      shell: false, // CRITICAL: Never use shell: true
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    })

    this.processes.set(id, proc)

    proc.stdout?.on('data', (data: Buffer) => {
      const line = data.toString()
      task.output.push(line)
      this.emit('output', { taskId: id, data: line, stream: 'stdout' })
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const line = data.toString()
      task.output.push(line)
      this.emit('output', { taskId: id, data: line, stream: 'stderr' })
    })

    proc.on('close', (code: number | null) => {
      task.status = code === 0 ? 'completed' : 'failed'
      task.endTime = new Date()
      task.exitCode = code ?? undefined
      this.processes.delete(id)

      this.emit('complete', {
        taskId: id,
        exitCode: code,
        duration: task.endTime.getTime() - task.startTime.getTime()
      })

      // Notify user
      this.notifyCompletion(task)

      // Cleanup old tasks
      this.cleanupOldTasks()
    })

    proc.on('error', (error: Error) => {
      task.status = 'failed'
      task.endTime = new Date()
      task.output.push(`Error: ${error.message}`)
      this.processes.delete(id)

      this.emit('error', { taskId: id, error })
    })

    this.emit('started', { taskId: id, command })

    return task
  }

  cancel(taskId: string): boolean {
    const proc = this.processes.get(taskId)
    const task = this.tasks.get(taskId)

    if (proc && task) {
      proc.kill('SIGTERM')
      task.status = 'cancelled'
      task.endTime = new Date()
      this.processes.delete(taskId)
      return true
    }

    return false
  }

  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId)
  }

  getRunningTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'running')
  }

  getAllTasks(): BackgroundTask[] {
    return Array.from(this.tasks.values())
  }

  getRecentTasks(limit: number = 10): BackgroundTask[] {
    return Array.from(this.tasks.values())
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
      .slice(0, limit)
  }

  private cleanupOldTasks(): void {
    // Remove completed tasks beyond limit
    const tasks = Array.from(this.tasks.entries())
      .filter(([_, t]) => t.status !== 'running')
      .sort((a, b) => b[1].startTime.getTime() - a[1].startTime.getTime())

    if (tasks.length > MAX_TASK_HISTORY) {
      const toRemove = tasks.slice(MAX_TASK_HISTORY)
      for (const [id] of toRemove) {
        this.tasks.delete(id)
      }
    }
  }

  private notifyCompletion(task: BackgroundTask): void {
    const duration = task.endTime
      ? Math.round((task.endTime.getTime() - task.startTime.getTime()) / 1000)
      : 0

    const icon = task.status === 'completed' ? '✓' : '✗'
    const status = task.status === 'completed' ? 'completed' : 'failed'

    console.log(`\n🤝 Bash Bro: Background task ${icon} ${status}`)
    console.log(`   Command: ${task.command}`)
    console.log(`   Duration: ${duration}s`)

    if (task.status === 'failed' && task.output.length > 0) {
      const lastLines = task.output.slice(-3).join('').trim()
      if (lastLines) {
        console.log(`   Last output: ${lastLines.slice(0, 100)}`)
      }
    }

    console.log()
  }

  formatStatus(): string {
    const running = this.getRunningTasks()

    if (running.length === 0) {
      return 'No background tasks running.'
    }

    const lines = ['Background tasks:']
    for (const task of running) {
      const elapsed = Math.round((Date.now() - task.startTime.getTime()) / 1000)
      lines.push(`  [${task.id}] ${task.command} (${elapsed}s)`)
    }

    return lines.join('\n')
  }
}
