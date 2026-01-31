// /BashBros - Your Friendly Bash Agent Helper
// https://bashbros.ai

// Core
export { BashBros } from './core.js'
export { PolicyEngine } from './policy/engine.js'
export { loadConfig } from './config.js'
export { AuditLogger } from './audit.js'

// Session management
export {
  allowForSession,
  isAllowedForSession,
  getSessionAllowlist,
  clearSessionAllowlist
} from './session.js'

// Bash Bro - AI sidekick
export { BashBro } from './bro/bro.js'
export { SystemProfiler } from './bro/profiler.js'
export { TaskRouter } from './bro/router.js'
export { CommandSuggester } from './bro/suggester.js'
export { BackgroundWorker } from './bro/worker.js'
export { OllamaClient } from './bro/ollama.js'

// Policy modules (security)
export { RiskScorer } from './policy/risk-scorer.js'
export { LoopDetector } from './policy/loop-detector.js'
export { AnomalyDetector } from './policy/anomaly-detector.js'
export { CommandFilter } from './policy/command-filter.js'
export { PathSandbox } from './policy/path-sandbox.js'
export { SecretsGuard } from './policy/secrets-guard.js'
export { RateLimiter } from './policy/rate-limiter.js'
export { OutputScanner } from './policy/output-scanner.js'

// Observability
export { MetricsCollector } from './observability/metrics.js'
export { CostEstimator } from './observability/cost.js'
export { ReportGenerator } from './observability/report.js'

// MCP Server
export { startMCPServer } from './mcp/server.js'
export type { CapabilityTier } from './mcp/tools.js'

// Hooks
export { ClaudeCodeHooks, gateCommand } from './hooks/claude-code.js'
export { MoltbotHooks, getMoltbotHooks } from './hooks/moltbot.js'
export {
  detectMoltbotSession,
  isInMoltbotSession,
  getMoltbotSessionId,
  getMoltbotAgentName,
  isSandboxEnabled
} from './hooks/moltbot-runtime.js'

// Safety
export { UndoStack } from './safety/undo-stack.js'

// Integration (bashgym)
export {
  BashgymIntegration,
  getBashgymIntegration,
  resetBashgymIntegration,
} from './integration/bashgym.js'

// Types
export type {
  BashBrosConfig,
  AgentType,
  SecurityProfile,
  CommandPolicy,
  PathPolicy,
  SecretsPolicy,
  AuditPolicy,
  RateLimitPolicy,
  RiskScoringPolicy,
  RiskPattern,
  LoopDetectionPolicy,
  AnomalyDetectionPolicy,
  OutputScanningPolicy,
  UndoPolicy,
  CommandResult,
  PolicyViolation,
  AuditEntry,
  // Moltbot types
  MoltbotGatewayInfo,
  MoltbotSessionContext,
  MoltbotSecurityAuditResult,
  MoltbotSecurityFinding
} from './types.js'

export type { SystemProfile, VersionInfo, OllamaInfo } from './bro/profiler.js'
export type { RoutingResult, RouteDecision } from './bro/router.js'
export type { Suggestion, SuggestionContext } from './bro/suggester.js'
export type { BackgroundTask } from './bro/worker.js'
export type { BroConfig } from './bro/bro.js'

// New module types
export type { RiskScore } from './policy/risk-scorer.js'
export type { LoopConfig, LoopAlert } from './policy/loop-detector.js'
export type { AnomalyConfig, Anomaly } from './policy/anomaly-detector.js'
export type { SessionMetrics, CommandMetric } from './observability/metrics.js'
export type { CostEstimate, ModelPricing } from './observability/cost.js'
export type { ReportOptions } from './observability/report.js'
export type { ClaudeSettings } from './hooks/claude-code.js'
export type { MoltbotSettings, MoltbotStatus, MoltbotGatewayStatus } from './hooks/moltbot.js'
export type { UndoEntry, UndoResult, UndoConfig } from './safety/undo-stack.js'
export type { ScanResult, Finding } from './policy/output-scanner.js'
export type {
  IntegrationSettings,
  TraceData,
  TraceStep,
  ModelManifest,
  ModelVersion,
  CaptureMode,
  TrainingTrigger,
} from './integration/bashgym.js'
