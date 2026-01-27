import { execFileSync } from 'child_process'
import { EventEmitter } from 'events'
import type { BashBrosConfig } from '../types.js'
import { SystemProfiler, SystemProfile } from './profiler.js'
import { TaskRouter, RoutingResult } from './router.js'
import { CommandSuggester, Suggestion, SuggestionContext } from './suggester.js'
import { BackgroundWorker, BackgroundTask } from './worker.js'
import { OllamaClient } from './ollama.js'

export interface BroConfig {
  modelEndpoint?: string  // Ollama endpoint (default: http://localhost:11434)
  modelName?: string      // e.g., 'qwen2.5-coder:7b'
  enableSuggestions?: boolean
  enableRouting?: boolean
  enableBackground?: boolean
  enableOllama?: boolean  // Use Ollama for AI features
}

// Allowlist of commands that can be executed directly
const SAFE_COMMANDS = new Set([
  'ls', 'dir', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
  'pwd', 'cd', 'mkdir', 'touch', 'cp', 'mv', 'rm',
  'git', 'npm', 'npx', 'pnpm', 'yarn', 'node', 'python', 'python3',
  'pip', 'pip3', 'pytest', 'cargo', 'go', 'rustc',
  'docker', 'kubectl', 'echo', 'which', 'where', 'type',
  'date', 'whoami', 'hostname', 'env', 'printenv'
])

/**
 * Parse command into executable and arguments safely
 */
function parseCommandSafe(command: string): { cmd: string; args: string[] } | null {
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

  if (tokens.length === 0) {
    return null
  }

  const cmd = tokens[0]

  // SECURITY: Only allow whitelisted commands
  if (!SAFE_COMMANDS.has(cmd)) {
    return null
  }

  return {
    cmd,
    args: tokens.slice(1)
  }
}

/**
 * Validate command doesn't contain shell injection patterns
 */
function validateCommandSafety(command: string): { safe: boolean; reason?: string } {
  const dangerousPatterns = [
    /[;&|`]/, // Shell operators
    /\$\(/, // Command substitution
    /\$\{/, // Variable expansion
    />\s*>/, // Append redirect
    /[<>]\s*\//, // Redirect to/from absolute path
    /\|\s*\w+/, // Pipe to command
    /\\x[0-9a-f]/i, // Hex escapes
    /\\[0-7]{3}/, // Octal escapes
  ]

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Contains dangerous pattern` }
    }
  }

  return { safe: true }
}

export class BashBro extends EventEmitter {
  private profiler: SystemProfiler
  private router: TaskRouter
  private suggester: CommandSuggester
  private worker: BackgroundWorker
  private ollama: OllamaClient | null = null
  private profile: SystemProfile | null = null
  private config: BroConfig
  private ollamaAvailable: boolean = false

  constructor(config: BroConfig = {}) {
    super()

    this.config = {
      enableSuggestions: true,
      enableRouting: true,
      enableBackground: true,
      enableOllama: true,
      ...config
    }

    this.profiler = new SystemProfiler()
    this.router = new TaskRouter()
    this.suggester = new CommandSuggester()
    this.worker = new BackgroundWorker()

    // Initialize Ollama client if enabled
    if (this.config.enableOllama) {
      this.ollama = new OllamaClient({
        host: this.config.modelEndpoint,
        model: this.config.modelName
      })
    }

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

    // Check Ollama availability
    if (this.ollama) {
      this.ollamaAvailable = await this.ollama.isAvailable()
      if (this.ollamaAvailable) {
        console.log('🤝 Bash Bro: Ollama connected')
      }
    }

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

  /**
   * SECURITY FIX: Safe command execution with validation
   */
  async execute(command: string): Promise<string> {
    // Validate command safety
    const safety = validateCommandSafety(command)
    if (!safety.safe) {
      return `Security: Command blocked - ${safety.reason}`
    }

    // Parse command safely
    const parsed = parseCommandSafe(command)
    if (!parsed) {
      return `Security: Command not in allowlist. Only safe commands can be executed directly.`
    }

    try {
      // SECURITY: Use execFileSync with array args, no shell
      const output = execFileSync(parsed.cmd, parsed.args, {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: process.cwd(),
        windowsHide: true
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

  /**
   * Check if Ollama is available for AI features
   */
  isOllamaAvailable(): boolean {
    return this.ollamaAvailable
  }

  /**
   * Ask Bash Bro (via Ollama) to suggest the next command
   */
  async aiSuggest(context: string): Promise<string | null> {
    if (!this.ollama || !this.ollamaAvailable) {
      return null
    }

    return this.ollama.suggestCommand(context)
  }

  /**
   * Ask Bash Bro to explain a command
   */
  async aiExplain(command: string): Promise<string> {
    if (!this.ollama || !this.ollamaAvailable) {
      return 'Ollama not available for explanations.'
    }

    return this.ollama.explainCommand(command)
  }

  /**
   * Ask Bash Bro to fix a failed command
   */
  async aiFix(command: string, error: string): Promise<string | null> {
    if (!this.ollama || !this.ollamaAvailable) {
      return null
    }

    return this.ollama.fixCommand(command, error)
  }

  /**
   * Set the Ollama model to use
   */
  setModel(model: string): void {
    if (this.ollama) {
      this.ollama.setModel(model)
    }
  }

  /**
   * Generate a shell script from natural language description
   */
  async aiGenerateScript(description: string): Promise<string | null> {
    if (!this.ollama || !this.ollamaAvailable) {
      return null
    }

    const shell = this.profile?.shell || 'bash'
    return this.ollama.generateScript(description, shell)
  }

  /**
   * Analyze command for security risks using AI
   */
  async aiAnalyzeSafety(command: string): Promise<{
    safe: boolean
    risk: 'low' | 'medium' | 'high' | 'critical'
    explanation: string
    suggestions: string[]
  }> {
    if (!this.ollama || !this.ollamaAvailable) {
      return {
        safe: true,
        risk: 'low',
        explanation: 'AI analysis not available.',
        suggestions: []
      }
    }

    return this.ollama.analyzeCommandSafety(command)
  }

  /**
   * Summarize a terminal session
   */
  async aiSummarize(commands: { command: string; output?: string; error?: string }[]): Promise<string> {
    if (!this.ollama || !this.ollamaAvailable) {
      return 'AI not available for summaries.'
    }

    return this.ollama.summarizeSession(commands)
  }

  /**
   * Get AI help for a topic or command
   */
  async aiHelp(topic: string): Promise<string> {
    if (!this.ollama || !this.ollamaAvailable) {
      return 'AI not available for help.'
    }

    return this.ollama.getHelp(topic)
  }

  /**
   * Convert natural language to command
   */
  async aiToCommand(description: string): Promise<string | null> {
    if (!this.ollama || !this.ollamaAvailable) {
      return null
    }

    return this.ollama.naturalToCommand(description)
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

    // Ollama connection status
    lines.push('')
    if (this.ollamaAvailable) {
      lines.push(`AI: Connected (${this.ollama?.getModel() || 'default'})`)
    } else {
      lines.push('AI: Not connected (run Ollama for AI features)')
    }

    lines.push('')
    lines.push(this.worker.formatStatus())

    return lines.join('\n')
  }
}
