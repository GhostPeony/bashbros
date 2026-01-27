export interface BashBrosConfig {
  agent: AgentType
  profile: SecurityProfile
  commands: CommandPolicy
  paths: PathPolicy
  secrets: SecretsPolicy
  audit: AuditPolicy
  rateLimit: RateLimitPolicy
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
