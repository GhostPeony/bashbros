/**
 * Bashgym Integration for Bashbros
 *
 * Provides integration between bashbros (security middleware + AI sidekick) and
 * bashgym (self-improving agent training) through a shared directory protocol.
 *
 * Key features:
 * - Trace export to shared directory
 * - Settings synchronization
 * - Model update watcher for hot-swap
 *
 * Data Flow:
 *   bashbros captures traces -> bashgym trains -> GGUF to Ollama -> bashbros sidekick improves
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, watch, FSWatcher } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { EventEmitter } from 'events'
import type { CommandResult, PolicyViolation } from '../types.js'

// ============================================================================
// Types
// ============================================================================

export type CaptureMode = 'everything' | 'successful_only' | 'sidekick_curated'
export type TrainingTrigger = 'manual' | 'quality_based' | 'scheduled'

export interface IntegrationSettings {
  version: string
  updated_at: string | null
  updated_by: string | null

  integration: {
    enabled: boolean
    linked_at: string | null
  }

  capture: {
    mode: CaptureMode
    auto_stream: boolean
  }

  training: {
    auto_enabled: boolean
    quality_threshold: number
    trigger: TrainingTrigger
  }

  security: {
    bashbros_primary: boolean
    policy_path: string | null
  }

  model_sync: {
    auto_export_ollama: boolean
    ollama_model_name: string
    notify_on_update: boolean
  }
}

export interface TraceData {
  version: string
  metadata: {
    user_initial_prompt: string
    source_tool: string
    task_id?: string
    verification_passed: boolean
    capture_mode: CaptureMode
    session_id: string
  }
  trace: TraceStep[]
  bashbros_extensions: {
    security_events: SecurityEvent[]
    sidekick_annotations: SidekickAnnotations
  }
}

export interface TraceStep {
  tool_name: string
  command: string
  output: string
  success: boolean
  exit_code?: number
  timestamp: string
  cwd?: string
}

export interface SecurityEvent {
  type: string
  timestamp: string
  command?: string
  violation?: PolicyViolation
}

export interface SidekickAnnotations {
  teachable_moment: boolean
  complexity: 'easy' | 'medium' | 'hard'
  tags?: string[]
}

export interface ModelManifest {
  latest: string
  versions: ModelVersion[]
  rollback_available: boolean
}

export interface ModelVersion {
  version: string
  created: string
  traces_used: number
  quality_avg: number
  gguf_path: string | null
}

export interface BashgymStatus {
  heartbeat: string
  version: string
  pending_traces: number
  processed_traces: number
  model_version: string | null
}

// ============================================================================
// Events
// ============================================================================

export interface BashgymIntegrationEvents {
  'model:updated': (version: string, manifest: ModelManifest) => void
  'settings:changed': (settings: IntegrationSettings) => void
  'trace:exported': (filename: string) => void
  'connected': () => void
  'disconnected': () => void
}

// ============================================================================
// Integration Class
// ============================================================================

const DEFAULT_SETTINGS: IntegrationSettings = {
  version: '1.0',
  updated_at: null,
  updated_by: null,
  integration: {
    enabled: false,
    linked_at: null,
  },
  capture: {
    mode: 'successful_only',
    auto_stream: true,
  },
  training: {
    auto_enabled: false,
    quality_threshold: 50,
    trigger: 'quality_based',
  },
  security: {
    bashbros_primary: true,
    policy_path: null,
  },
  model_sync: {
    auto_export_ollama: true,
    ollama_model_name: 'bashgym-sidekick',
    notify_on_update: true,
  },
}

export class BashgymIntegration extends EventEmitter {
  private integrationDir: string
  private settings: IntegrationSettings | null = null
  private manifest: ModelManifest | null = null
  private settingsWatcher: FSWatcher | null = null
  private modelWatcher: FSWatcher | null = null
  private sessionId: string
  private traceBuffer: TraceStep[] = []
  private securityEvents: SecurityEvent[] = []
  private currentPrompt: string = ''

  // Directory paths
  private tracesDir: string
  private pendingDir: string
  private modelsDir: string
  private configDir: string
  private statusDir: string

  constructor(integrationDir?: string) {
    super()

    this.integrationDir = integrationDir || join(homedir(), '.bashgym', 'integration')
    this.tracesDir = join(this.integrationDir, 'traces')
    this.pendingDir = join(this.tracesDir, 'pending')
    this.modelsDir = join(this.integrationDir, 'models')
    this.configDir = join(this.integrationDir, 'config')
    this.statusDir = join(this.integrationDir, 'status')

    this.sessionId = `bashbros-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Initialize the integration
   */
  async initialize(): Promise<boolean> {
    // Check if bashgym integration directory exists
    if (!existsSync(this.integrationDir)) {
      return false
    }

    // Load settings
    this.settings = this.loadSettings()
    if (!this.settings?.integration.enabled) {
      return false
    }

    // Load model manifest
    this.manifest = this.loadManifest()

    // Start watching for changes
    this.startWatching()

    // Update bashbros status
    this.updateStatus()

    this.emit('connected')
    return true
  }

  /**
   * Check if bashgym is available
   */
  isAvailable(): boolean {
    return existsSync(this.integrationDir) && existsSync(this.configDir)
  }

  /**
   * Check if integration is linked
   */
  isLinked(): boolean {
    const settings = this.getSettings()
    return !!(settings?.integration.enabled && settings.integration.linked_at !== null)
  }

  // =========================================================================
  // Settings Management
  // =========================================================================

  getSettings(): IntegrationSettings | null {
    if (!this.settings) {
      this.settings = this.loadSettings()
    }
    return this.settings
  }

  private loadSettings(): IntegrationSettings | null {
    const settingsPath = join(this.configDir, 'settings.json')

    if (!existsSync(settingsPath)) {
      return null
    }

    try {
      const content = readFileSync(settingsPath, 'utf-8')
      return JSON.parse(content) as IntegrationSettings
    } catch {
      return null
    }
  }

  updateSettings(updates: Partial<IntegrationSettings>): void {
    const current = this.getSettings() || { ...DEFAULT_SETTINGS }

    // Deep merge updates
    const updated: IntegrationSettings = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
      updated_by: 'bashbros',
    }

    // Write to file
    const settingsPath = join(this.configDir, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2))

    this.settings = updated
    this.emit('settings:changed', updated)
  }

  // =========================================================================
  // Trace Export
  // =========================================================================

  /**
   * Start a new trace session
   */
  startSession(prompt: string): void {
    this.currentPrompt = prompt
    this.traceBuffer = []
    this.securityEvents = []
  }

  /**
   * Add a step to the current trace
   */
  addStep(step: Omit<TraceStep, 'timestamp'>): void {
    this.traceBuffer.push({
      ...step,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Add a command result to the trace
   */
  addCommandResult(result: CommandResult): void {
    this.addStep({
      tool_name: 'Bash',
      command: result.command,
      output: result.output || '',
      success: result.allowed && !result.error,
      exit_code: result.exitCode,
      cwd: process.cwd(),
    })

    // Track security events
    if (result.violations.length > 0) {
      this.securityEvents.push({
        type: 'violation',
        timestamp: new Date().toISOString(),
        command: result.command,
        violation: result.violations[0],
      })
    }
  }

  /**
   * Add a file operation to the trace
   */
  addFileOperation(operation: 'Read' | 'Write' | 'Edit', path: string, success: boolean, output?: string): void {
    this.addStep({
      tool_name: operation,
      command: path,
      output: output || '',
      success,
    })
  }

  /**
   * End the session and export the trace
   */
  async endSession(verificationPassed: boolean = false): Promise<string | null> {
    if (!this.currentPrompt || this.traceBuffer.length === 0) {
      return null
    }

    const settings = this.getSettings()
    if (!settings?.integration.enabled) {
      return null
    }

    // Check capture mode
    if (settings.capture.mode === 'successful_only' && !verificationPassed) {
      // Don't export failed traces
      this.clearSession()
      return null
    }

    // Build trace data
    const traceData: TraceData = {
      version: '1.0',
      metadata: {
        user_initial_prompt: this.currentPrompt,
        source_tool: 'bashbros',
        session_id: this.sessionId,
        verification_passed: verificationPassed,
        capture_mode: settings.capture.mode,
      },
      trace: this.traceBuffer,
      bashbros_extensions: {
        security_events: this.securityEvents,
        sidekick_annotations: {
          teachable_moment: this.determineTeachableMoment(),
          complexity: this.determineComplexity(),
        },
      },
    }

    // Export to pending directory
    const filename = `${Date.now()}-${this.sessionId.slice(-8)}.json`
    const filepath = join(this.pendingDir, filename)

    try {
      // Ensure directory exists
      if (!existsSync(this.pendingDir)) {
        mkdirSync(this.pendingDir, { recursive: true })
      }

      writeFileSync(filepath, JSON.stringify(traceData, null, 2))
      this.emit('trace:exported', filename)

      this.clearSession()
      return filename
    } catch (error) {
      console.error('Failed to export trace:', error)
      return null
    }
  }

  private clearSession(): void {
    this.currentPrompt = ''
    this.traceBuffer = []
    this.securityEvents = []
    this.sessionId = `bashbros-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }

  private determineTeachableMoment(): boolean {
    // Heuristics for identifying teachable moments
    // - Session has multiple steps
    // - Includes error recovery
    // - Uses diverse tools
    const hasMultipleSteps = this.traceBuffer.length >= 3
    const hasErrorRecovery = this.traceBuffer.some((s, i) =>
      !s.success && i < this.traceBuffer.length - 1 && this.traceBuffer[i + 1].success
    )
    const toolNames = new Set(this.traceBuffer.map(s => s.tool_name))
    const hasDiverseTools = toolNames.size >= 2

    return hasMultipleSteps && (hasErrorRecovery || hasDiverseTools)
  }

  private determineComplexity(): 'easy' | 'medium' | 'hard' {
    const stepCount = this.traceBuffer.length
    const toolCount = new Set(this.traceBuffer.map(s => s.tool_name)).size
    const hasErrors = this.traceBuffer.some(s => !s.success)

    if (stepCount <= 3 && toolCount <= 2 && !hasErrors) {
      return 'easy'
    }

    if (stepCount >= 10 || toolCount >= 4 || this.securityEvents.length > 0) {
      return 'hard'
    }

    return 'medium'
  }

  // =========================================================================
  // Model Management
  // =========================================================================

  /**
   * Get current model version
   */
  getCurrentModelVersion(): string | null {
    const manifest = this.loadManifest()
    return manifest?.latest || null
  }

  /**
   * Get model manifest
   */
  getModelManifest(): ModelManifest | null {
    return this.manifest || this.loadManifest()
  }

  private loadManifest(): ModelManifest | null {
    const manifestPath = join(this.modelsDir, 'manifest.json')

    if (!existsSync(manifestPath)) {
      return null
    }

    try {
      const content = readFileSync(manifestPath, 'utf-8')
      return JSON.parse(content) as ModelManifest
    } catch {
      return null
    }
  }

  /**
   * Get path to latest GGUF model
   */
  getLatestModelPath(): string | null {
    const latestPath = join(this.modelsDir, 'latest', 'sidekick.gguf')

    if (existsSync(latestPath)) {
      return latestPath
    }

    return null
  }

  /**
   * Get Ollama model name for sidekick
   */
  getOllamaModelName(): string {
    const settings = this.getSettings()
    return settings?.model_sync.ollama_model_name || 'bashgym-sidekick'
  }

  // =========================================================================
  // File Watching
  // =========================================================================

  private startWatching(): void {
    // Watch settings file
    const settingsPath = join(this.configDir, 'settings.json')
    if (existsSync(settingsPath)) {
      try {
        this.settingsWatcher = watch(settingsPath, (eventType) => {
          if (eventType === 'change') {
            const newSettings = this.loadSettings()
            if (newSettings) {
              this.settings = newSettings
              this.emit('settings:changed', newSettings)
            }
          }
        })
      } catch {
        // Watching may not be supported
      }
    }

    // Watch model manifest
    const manifestPath = join(this.modelsDir, 'manifest.json')
    if (existsSync(manifestPath)) {
      try {
        this.modelWatcher = watch(manifestPath, (eventType) => {
          if (eventType === 'change') {
            const oldVersion = this.manifest?.latest
            const newManifest = this.loadManifest()

            if (newManifest && newManifest.latest !== oldVersion) {
              this.manifest = newManifest
              this.emit('model:updated', newManifest.latest, newManifest)
            }
          }
        })
      } catch {
        // Watching may not be supported
      }
    }
  }

  stopWatching(): void {
    if (this.settingsWatcher) {
      this.settingsWatcher.close()
      this.settingsWatcher = null
    }

    if (this.modelWatcher) {
      this.modelWatcher.close()
      this.modelWatcher = null
    }
  }

  // =========================================================================
  // Status Management
  // =========================================================================

  private updateStatus(): void {
    const statusPath = join(this.statusDir, 'bashbros.json')

    const status = {
      heartbeat: new Date().toISOString(),
      version: '1.0',
      session_id: this.sessionId,
      active: true,
    }

    try {
      if (!existsSync(this.statusDir)) {
        mkdirSync(this.statusDir, { recursive: true })
      }
      writeFileSync(statusPath, JSON.stringify(status, null, 2))
    } catch {
      // Status update failed - non-critical
    }
  }

  /**
   * Check if bashgym is actively running
   */
  isBashgymRunning(): boolean {
    const statusPath = join(this.statusDir, 'bashgym.json')

    if (!existsSync(statusPath)) {
      return false
    }

    try {
      const content = readFileSync(statusPath, 'utf-8')
      const status = JSON.parse(content) as BashgymStatus

      // Check if heartbeat is recent (within 5 minutes)
      const heartbeat = new Date(status.heartbeat)
      const age = Date.now() - heartbeat.getTime()

      return age < 5 * 60 * 1000
    } catch {
      return false
    }
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  dispose(): void {
    this.stopWatching()
    this.emit('disconnected')
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let _integration: BashgymIntegration | null = null

export function getBashgymIntegration(): BashgymIntegration {
  if (!_integration) {
    _integration = new BashgymIntegration()
  }
  return _integration
}

export function resetBashgymIntegration(): void {
  if (_integration) {
    _integration.dispose()
  }
  _integration = null
}
