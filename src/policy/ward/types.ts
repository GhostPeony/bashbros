/**
 * Ward - Network & Connector Security Types
 */

// ─────────────────────────────────────────────────────────────
// Exposure Scanner (Layer 1)
// ─────────────────────────────────────────────────────────────

export type ExposureSeverity = 'low' | 'medium' | 'high' | 'critical'
export type ExposureAction = 'alert' | 'block' | 'block_and_kill'

export interface AgentSignature {
  name: string
  processNames: string[]
  defaultPorts: number[]
  configPaths: string[]
  authIndicators: string[]
}

export interface ExposureResult {
  agent: string
  pid?: number
  port: number
  bindAddress: string
  hasAuth: boolean | 'unknown'
  severity: ExposureSeverity
  action: ExposureAction
  message: string
  timestamp: Date
}

export interface ExposureConfig {
  enabled: boolean
  scanInterval: number
  externalProbe: boolean
  severityActions: Record<ExposureSeverity, ExposureAction>
  agents: AgentSignature[]
}

// ─────────────────────────────────────────────────────────────
// Connector Registry (Layer 2)
// ─────────────────────────────────────────────────────────────

export interface ConnectorInfo {
  name: string
  pid: number
  command: string
  capabilities: string[]
  startTime: Date
  status: 'active' | 'inactive' | 'error'
}

export interface ConnectorEvent {
  id: string
  timestamp: Date
  connector: string
  method: string
  direction: 'inbound' | 'outbound'
  payload: RedactedPayload
  resourcesAccessed: string[]
}

export interface RedactedPayload {
  original?: string
  redacted: string
  redactions: RedactionInfo[]
}

export interface RedactionInfo {
  type: 'api_key' | 'phone' | 'email' | 'ssn' | 'credit_card' | 'custom'
  original?: string
  replacement: string
}

export interface ConnectorConfig {
  proxyAllMcp: boolean
  telemetryRetention: string
  redaction: {
    encryptFullPayloads: boolean
    encryptionKeyPath: string
  }
}

// ─────────────────────────────────────────────────────────────
// Egress Monitor (Layer 3)
// ─────────────────────────────────────────────────────────────

export type EgressAction = 'block' | 'alert' | 'log'
export type PatternSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface EgressPattern {
  name: string
  regex: string
  severity: PatternSeverity
  action: EgressAction
  description?: string
  category: 'credentials' | 'pii' | 'custom'
}

export interface EgressMatch {
  id: string
  timestamp: Date
  pattern: EgressPattern
  matchedText: string
  redactedText: string
  connector?: string
  destination?: string
  status: 'pending' | 'approved' | 'denied'
  approvedBy?: string
  approvedAt?: Date
}

export interface EgressConfig {
  enabled: boolean
  defaultAction: EgressAction
  patternsFile?: string
  allowlist: EgressAllowlistEntry[]
}

export interface EgressAllowlistEntry {
  connector?: string
  destination?: string
  pattern?: string
  action: 'allow'
}

// ─────────────────────────────────────────────────────────────
// Ward Config (top-level)
// ─────────────────────────────────────────────────────────────

export interface WardConfig {
  enabled: boolean
  exposure: ExposureConfig
  connectors: ConnectorConfig
  egress: EgressConfig
}

// ─────────────────────────────────────────────────────────────
// Dashboard Config
// ─────────────────────────────────────────────────────────────

export interface DashboardConfig {
  enabled: boolean
  port: number
  bind: string
}

// ─────────────────────────────────────────────────────────────
// Unified Event (for dashboard)
// ─────────────────────────────────────────────────────────────

export type EventSource = 'ward' | 'policy' | 'bro' | 'safety' | 'observability'
export type EventLevel = 'info' | 'warn' | 'error' | 'critical'

export interface UnifiedEvent {
  id: string
  timestamp: Date
  source: EventSource
  level: EventLevel
  category: string
  message: string
  data?: Record<string, unknown>
}
