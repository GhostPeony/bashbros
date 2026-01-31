import { execFileSync } from 'child_process'
import { EventEmitter } from 'events'
import type { BashBrosConfig } from '../types.js'
import { SystemProfiler, SystemProfile } from './profiler.js'
import { TaskRouter, RoutingResult } from './router.js'
import { CommandSuggester, Suggestion, SuggestionContext } from './suggester.js'
import { BackgroundWorker, BackgroundTask } from './worker.js'
import { OllamaClient } from './ollama.js'
import { getBashgymIntegration, type ModelManifest } from '../integration/bashgym.js'
import { AdapterRegistry, type AdapterEntry, type AdapterPurpose } from './adapters.js'
import { ProfileManager, type ModelProfile } from './profiles.js'

export interface BroConfig {
  modelEndpoint?: string  // Ollama endpoint (default: http://localhost:11434)
  modelName?: string      // e.g., 'qwen2.5-coder:7b'
  enableSuggestions?: boolean
  enableRouting?: boolean
  enableBackground?: boolean
  enableOllama?: boolean  // Use Ollama for AI features
  enableBashgymIntegration?: boolean  // Enable bashgym integration for model hot-swap
  activeProfile?: string  // Active model profile name
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
  private bashgymModelVersion: string | null = null
  private adapterRegistry: AdapterRegistry
  private profileManager: ProfileManager
  private activeProfile: ModelProfile | null = null

  constructor(config: BroConfig = {}) {
    super()

    this.config = {
      enableSuggestions: true,
      enableRouting: true,
      enableBackground: true,
      enableOllama: true,
      enableBashgymIntegration: true,
      ...config
    }

    this.profiler = new SystemProfiler()
    this.worker = new BackgroundWorker()

    // Initialize Ollama client first so router/suggester can use it
    if (this.config.enableOllama) {
      this.ollama = new OllamaClient({
        host: this.config.modelEndpoint,
        model: this.config.modelName
      })
    }

    // Pass Ollama client to router and suggester for AI-enhanced features
    this.router = new TaskRouter(null, this.ollama)
    this.suggester = new CommandSuggester(null, this.ollama)

    // Forward worker events
    this.worker.on('complete', (data) => this.emit('task:complete', data))
    this.worker.on('output', (data) => this.emit('task:output', data))
    this.worker.on('error', (data) => this.emit('task:error', data))

    // Initialize bashgym integration for model hot-swap
    if (this.config.enableBashgymIntegration) {
      this.initBashgymIntegration()
    }

    // Initialize adapter registry and profile manager
    this.adapterRegistry = new AdapterRegistry()
    this.profileManager = new ProfileManager()
    if (this.config.activeProfile) {
      this.activeProfile = this.profileManager.load(this.config.activeProfile)
    }
  }

  /**
   * Initialize bashgym integration for model hot-swap
   */
  private initBashgymIntegration(): void {
    try {
      const integration = getBashgymIntegration()

      // Listen for model updates
      integration.on('model:updated', (version: string, manifest: ModelManifest) => {
        this.handleModelUpdate(version, manifest)
      })

      // Check if we should use the bashgym sidekick model
      if (integration.isLinked()) {
        const modelName = integration.getOllamaModelName()
        const currentVersion = integration.getCurrentModelVersion()

        if (currentVersion && this.ollama) {
          // Use the bashgym-trained sidekick model
          this.ollama.setModel(`${modelName}:${currentVersion}`)
          this.bashgymModelVersion = currentVersion
          console.log(`🤝 Bash Bro: Using bashgym sidekick model (${currentVersion})`)
        }
      }
    } catch {
      // Integration not available - continue without it
    }
  }

  /**
   * Handle model update from bashgym (hot-swap)
   */
  private handleModelUpdate(version: string, manifest: ModelManifest): void {
    if (!this.ollama) return

    // Don't update if it's the same version
    if (version === this.bashgymModelVersion) return

    try {
      const integration = getBashgymIntegration()
      const modelName = integration.getOllamaModelName()

      // Hot-swap to the new model
      this.ollama.setModel(`${modelName}:${version}`)
      this.bashgymModelVersion = version

      console.log(`🤝 Bash Bro: Model hot-swapped to ${version}`)
      this.emit('model:updated', version)
    } catch (error) {
      console.error('Failed to hot-swap model:', error)
    }
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
   * AI-enhanced async routing - uses pattern matching first, falls back to Ollama
   */
  async routeAsync(command: string): Promise<RoutingResult> {
    if (!this.config.enableRouting) {
      return { decision: 'main', reason: 'Routing disabled', confidence: 1 }
    }
    return this.router.routeAsync(command)
  }

  /**
   * AI-enhanced async suggestions - pattern matching + Ollama suggestions with caching
   */
  async suggestAsync(context: SuggestionContext): Promise<Suggestion[]> {
    if (!this.config.enableSuggestions) return []
    return this.suggester.suggestAsync(context)
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

    const startTime = Date.now()
    try {
      const result = await this.ollama.suggestCommand(context)
      const latency = Date.now() - startTime

      this.emit('bro:suggestion', {
        input: context,
        output: result ?? '',
        model: this.ollama.getModel(),
        latencyMs: latency,
        success: result !== null
      })

      return result
    } catch (error) {
      const latency = Date.now() - startTime
      this.emit('bro:suggestion', {
        input: context,
        output: '',
        model: this.ollama?.getModel() ?? 'unknown',
        latencyMs: latency,
        success: false
      })
      return null
    }
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

    const startTime = Date.now()
    try {
      const result = await this.ollama.analyzeCommandSafety(command)
      const latency = Date.now() - startTime

      this.emit('bro:safety', {
        input: command,
        output: `Risk: ${result.risk} - ${result.explanation}`,
        model: this.ollama.getModel(),
        latencyMs: latency,
        success: true
      })

      return result
    } catch (error) {
      const latency = Date.now() - startTime
      this.emit('bro:safety', {
        input: command,
        output: 'Analysis failed',
        model: this.ollama?.getModel() ?? 'unknown',
        latencyMs: latency,
        success: false
      })
      return {
        safe: true,
        risk: 'low',
        explanation: 'Analysis unavailable.',
        suggestions: []
      }
    }
  }

  /**
   * Get bashgym sidekick model version (if using)
   */
  getBashgymModelVersion(): string | null {
    return this.bashgymModelVersion
  }

  /**
   * Check if using bashgym-trained sidekick model
   */
  isUsingBashgymModel(): boolean {
    return this.bashgymModelVersion !== null
  }

  /**
   * Force refresh the bashgym model (check for updates)
   */
  refreshBashgymModel(): boolean {
    if (!this.config.enableBashgymIntegration) {
      return false
    }

    try {
      const integration = getBashgymIntegration()
      const currentVersion = integration.getCurrentModelVersion()

      if (currentVersion && currentVersion !== this.bashgymModelVersion) {
        const modelName = integration.getOllamaModelName()
        if (this.ollama) {
          this.ollama.setModel(`${modelName}:${currentVersion}`)
          this.bashgymModelVersion = currentVersion
          this.emit('model:updated', currentVersion)
          return true
        }
      }
    } catch {
      // Ignore errors
    }

    return false
  }

  /**
   * Get model name for a specific purpose (checks active profile for adapter override)
   */
  private getModelForPurpose(purpose: AdapterPurpose): string | null {
    if (!this.activeProfile) return null
    return this.profileManager.getModelForPurpose(this.activeProfile, purpose)
  }

  /**
   * Get discovered LoRA adapters
   */
  getAdapters(): AdapterEntry[] {
    return this.adapterRegistry.discover()
  }

  /**
   * Get available model profiles
   */
  getProfiles(): ModelProfile[] {
    return this.profileManager.list()
  }

  /**
   * Get the active model profile
   */
  getActiveProfile(): ModelProfile | null {
    return this.activeProfile
  }

  /**
   * Set the active model profile by name
   */
  setActiveProfile(name: string): boolean {
    const profile = this.profileManager.load(name)
    if (!profile) return false
    this.activeProfile = profile
    this.emit('profile:changed', profile)
    return true
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
      const model = this.ollama?.getModel() || 'default'
      if (this.bashgymModelVersion) {
        lines.push(`AI: Connected (bashgym sidekick ${this.bashgymModelVersion})`)
      } else {
        lines.push(`AI: Connected (${model})`)
      }
    } else {
      lines.push('AI: Not connected (run Ollama for AI features)')
    }

    // Bashgym integration status
    if (this.config.enableBashgymIntegration) {
      try {
        const integration = getBashgymIntegration()
        if (integration.isLinked()) {
          lines.push(`BashGym: Linked`)
          if (integration.isBashgymRunning()) {
            lines.push(`  Status: Running`)
          }
        }
      } catch {
        // Integration not available
      }
    }

    lines.push('')
    lines.push(this.worker.formatStatus())

    return lines.join('\n')
  }
}
