export interface BashBrosConfig {
  agent: AgentType
  profile: SecurityProfile
  commands: CommandPolicy
  paths: PathPolicy
  secrets: SecretsPolicy
  audit: AuditPolicy
  rateLimit: RateLimitPolicy
  // New security controls
  riskScoring: RiskScoringPolicy
  loopDetection: LoopDetectionPolicy
  anomalyDetection: AnomalyDetectionPolicy
  outputScanning: OutputScanningPolicy
  undo: UndoPolicy
}

export type AgentType =
  | 'claude-code'
  | 'clawdbot'
  | 'gemini-cli'
  | 'aider'
  | 'opencode'
  | 'custom'

export type SecurityProfile = 'balanced' | 'strict' | 'permissive' | 'custom'

export interface CommandPolicy {
  allow: string[]
  block: string[]
}

export interface PathPolicy {
  allow: string[]
  block: string[]
}

export interface SecretsPolicy {
  enabled: boolean
  mode: 'block' | 'audit'
  patterns: string[]
}

export interface AuditPolicy {
  enabled: boolean
  destination: 'local' | 'remote' | 'both'
  remotePath?: string
}

export interface RateLimitPolicy {
  enabled: boolean
  maxPerMinute: number
  maxPerHour: number
}

export interface RiskScoringPolicy {
  enabled: boolean
  blockThreshold: number       // Block commands at or above this score (1-10)
  warnThreshold: number        // Warn on commands at or above this score
  customPatterns: RiskPattern[]
}

export interface RiskPattern {
  pattern: string              // Regex pattern as string
  score: number                // 1-10
  factor: string               // Description
}

export interface LoopDetectionPolicy {
  enabled: boolean
  maxRepeats: number           // Same command N times triggers alert
  maxTurns: number             // Total commands before hard stop
  similarityThreshold: number  // 0-1, how similar commands must be
  cooldownMs: number           // Min time between identical commands
  windowSize: number           // Commands to look back
  action: 'warn' | 'block'     // What to do on detection
}

export interface AnomalyDetectionPolicy {
  enabled: boolean
  workingHours: [number, number]  // [startHour, endHour] 24h format
  typicalCommandsPerMinute: number
  learningCommands: number        // How many commands before leaving learning mode
  suspiciousPatterns: string[]    // Additional patterns to flag
  action: 'warn' | 'block'
}

export interface OutputScanningPolicy {
  enabled: boolean
  scanForSecrets: boolean         // Check output for leaked secrets
  scanForErrors: boolean          // Detect error patterns
  maxOutputLength: number         // Truncate output above this
  redactPatterns: string[]        // Patterns to redact from logs
}

export interface UndoPolicy {
  enabled: boolean
  maxStackSize: number            // Max operations to track
  maxFileSize: number             // Max file size to backup (bytes)
  ttlMinutes: number              // Auto-cleanup backups older than this
  backupPath: string              // Where to store backups
}

export interface CommandResult {
  command: string
  allowed: boolean
  output?: string
  error?: string
  exitCode?: number
  duration: number
  violations: PolicyViolation[]
}

export interface PolicyViolation {
  type: 'command' | 'path' | 'secrets' | 'rate_limit'
  rule: string
  message: string
}

export interface AuditEntry {
  timestamp: Date
  command: string
  allowed: boolean
  violations: PolicyViolation[]
  exitCode?: number
  duration: number
  agent: AgentType
}
