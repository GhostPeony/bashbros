import { EventEmitter } from 'events'
import type { BashBrosConfig } from '../types.js'
import { SystemProfiler, SystemProfile } from './profiler.js'
import { TaskRouter, RoutingResult } from './router.js'
import { CommandSuggester, Suggestion, SuggestionContext } from './suggester.js'
import { BackgroundWorker, BackgroundTask } from './worker.js'

export interface BroConfig {
  modelEndpoint?: string  // Ollama or other local model
  modelName?: string      // e.g., 'qwen2.5-coder:7b'
  enableSuggestions?: boolean
  enableRouting?: boolean
  enableBackground?: boolean
}

export class BashBro extends EventEmitter {
  private profiler: SystemProfiler
  private router: TaskRouter
  private suggester: CommandSuggester
  private worker: BackgroundWorker
  private profile: SystemProfile | null = null
  private config: BroConfig

  constructor(config: BroConfig = {}) {
    super()

    this.config = {
      enableSuggestions: true,
      enableRouting: true,
      enableBackground: true,
      ...config
    }

    this.profiler = new SystemProfiler()
    this.router = new TaskRouter()
    this.suggester = new CommandSuggester()
    this.worker = new BackgroundWorker()

    // Forward worker events
    this.worker.on('complete', (data) => this.emit('task:complete', data))
    this.worker.on('output', (data) => this.emit('task:output', data))
    this.worker.on('error', (data) => this.emit('task:error', data))
  }

  async initialize(): Promise<void> {
    // Load or scan system profile
    this.profile = this.profiler.load()

    if (!this.profile || this.isProfileStale()) {
      console.log('🤝 Bash Bro: Scanning your system...')
      this.profile = await this.profiler.scan()
      console.log('🤝 Bash Bro: System profile updated!')
    }

    this.router.updateProfile(this.profile)
    this.suggester.updateProfile(this.profile)

    this.emit('ready', this.profile)
  }

  private isProfileStale(): boolean {
    if (!this.profile) return true

    const age = Date.now() - new Date(this.profile.timestamp).getTime()
    const oneDay = 24 * 60 * 60 * 1000

    return age > oneDay
  }

  scanProject(projectPath: string): void {
    this.profiler.scanProject(projectPath)
    this.profile = this.profiler.get()

    if (this.profile) {
      this.router.updateProfile(this.profile)
      this.suggester.updateProfile(this.profile)
    }
  }

  route(command: string): RoutingResult {
    if (!this.config.enableRouting) {
      return { decision: 'main', reason: 'Routing disabled', confidence: 1 }
    }

    return this.router.route(command)
  }

  suggest(context: SuggestionContext): Suggestion[] {
    if (!this.config.enableSuggestions) {
      return []
    }

    return this.suggester.suggest(context)
  }

  async execute(command: string): Promise<string> {
    // This would call the local model (Ollama/Qwen) to execute
    // For now, just execute directly
    const { execSync } = await import('child_process')

    try {
      const output = execSync(command, {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: process.cwd()
      })
      return output
    } catch (error: any) {
      return error.message || 'Command failed'
    }
  }

  runBackground(command: string, cwd?: string): BackgroundTask {
    if (!this.config.enableBackground) {
      throw new Error('Background tasks disabled')
    }

    return this.worker.spawn(command, cwd)
  }

  cancelBackground(taskId: string): boolean {
    return this.worker.cancel(taskId)
  }

  getBackgroundTasks(): BackgroundTask[] {
    return this.worker.getRunningTasks()
  }

  getSystemContext(): string {
    return this.profiler.toContext()
  }

  getProfile(): SystemProfile | null {
    return this.profile
  }

  // Format a nice status message
  status(): string {
    const lines: string[] = [
      '🤝 Bash Bro Status',
      '─'.repeat(40)
    ]

    if (this.profile) {
      lines.push(`Platform: ${this.profile.platform} (${this.profile.arch})`)
      lines.push(`Shell: ${this.profile.shell}`)

      if (this.profile.python) {
        lines.push(`Python: ${this.profile.python.version}`)
      }
      if (this.profile.node) {
        lines.push(`Node: ${this.profile.node.version}`)
      }

      if (this.profile.ollama) {
        lines.push(`Ollama: ${this.profile.ollama.version}`)
        if (this.profile.ollama.models.length > 0) {
          lines.push(`  Models: ${this.profile.ollama.models.join(', ')}`)
        }
      }

      if (this.profile.projectType) {
        lines.push(`Project: ${this.profile.projectType}`)
      }
    }

    lines.push('')
    lines.push(this.worker.formatStatus())

    return lines.join('\n')
  }
}
