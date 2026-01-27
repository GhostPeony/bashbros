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

export class BackgroundWorker extends EventEmitter {
  private tasks: Map<string, BackgroundTask> = new Map()
  private processes: Map<string, ChildProcess> = new Map()
  private taskIdCounter = 0

  spawn(command: string, cwd?: string): BackgroundTask {
    const id = `task_${++this.taskIdCounter}`

    const task: BackgroundTask = {
      id,
      command,
      status: 'running',
      startTime: new Date(),
      output: []
    }

    this.tasks.set(id, task)

    // Parse command and args
    const parts = command.split(/\s+/)
    const cmd = parts[0]
    const args = parts.slice(1)

    const proc = spawn(cmd, args, {
      cwd: cwd || process.cwd(),
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe']
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
