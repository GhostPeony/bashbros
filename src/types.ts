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
  // Ward & Dashboard
  ward: WardPolicy
  dashboard: DashboardPolicy
  sessionStart: SessionStartConfig
}

export type AgentType =
  | 'claude-code'
  | 'clawdbot'    // Keep for backward compatibility
  | 'moltbot'     // New canonical name for clawd.bot
  | 'gemini-cli'
  | 'copilot-cli'
  | 'aider'
  | 'opencode'
  | 'custom'

// Moltbot-specific types
export interface MoltbotGatewayInfo {
  port: number
  host: string
  sandboxMode: boolean
  authToken?: boolean  // Indicate presence, never expose actual token
}

export interface MoltbotSessionContext {
  inMoltbotSession: boolean
  sessionId?: string
  agentName?: string
  sandboxMode: boolean
  customConfigPath?: string
}

export interface MoltbotSecurityAuditResult {
  passed: boolean
  findings: MoltbotSecurityFinding[]
  timestamp: Date
}

export interface MoltbotSecurityFinding {
  severity: 'info' | 'warning' | 'critical'
  category: string
  message: string
  recommendation?: string
}

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
  type: 'command' | 'path' | 'secrets' | 'rate_limit' | 'risk_score' | 'loop' | 'anomaly' | 'output'
  rule: string
  message: string
  remediation?: string[]
  severity?: 'low' | 'medium' | 'high' | 'critical'
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

// Agent Transparency Types

export interface AgentConfigInfo {
  agent: AgentType
  installed: boolean
  version?: string
  configPath?: string
  configExists: boolean
  permissions?: AgentPermissions
  hooks?: string[]
  lastModified?: Date
  bashbrosIntegrated: boolean
}

export interface AgentPermissions {
  allowedPaths?: string[]
  blockedCommands?: string[]
  rateLimit?: number
  securityProfile?: string
  customPolicies?: Record<string, unknown>
}

export interface EffectivePermissions {
  allowedPaths: { bashbros: string[]; agent: string[]; effective: string[] }
  riskThreshold: { bashbros: number; agent: number | null; effective: number }
  rateLimit: { bashbros: number; agent: number | null; effective: number }
  blockedCommands: { bashbros: string[]; agent: string[]; effective: string[] }
}

// Ward & Dashboard configuration
export interface WardPolicy {
  enabled: boolean
  exposure: {
    scanInterval: number
    externalProbe: boolean
    severityActions: {
      low: 'alert' | 'block' | 'block_and_kill'
      medium: 'alert' | 'block' | 'block_and_kill'
      high: 'alert' | 'block' | 'block_and_kill'
      critical: 'alert' | 'block' | 'block_and_kill'
    }
  }
  connectors: {
    proxyAllMcp: boolean
    telemetryRetention: string
  }
  egress: {
    defaultAction: 'block' | 'alert' | 'log'
    patternsFile?: string
  }
}

export interface DashboardPolicy {
  enabled: boolean
  port: number
  bind: string
}

export interface SessionStartConfig {
  enabled: boolean
  collectMetadata: boolean
  ollamaStatus: boolean
  preloadContext: boolean
}
