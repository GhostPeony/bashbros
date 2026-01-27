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

// Observability
export { MetricsCollector } from './observability/metrics.js'
export { CostEstimator } from './observability/cost.js'
export { ReportGenerator } from './observability/report.js'

// Hooks
export { ClaudeCodeHooks, gateCommand } from './hooks/claude-code.js'

// Safety
export { UndoStack } from './safety/undo-stack.js'

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
  CommandResult,
  PolicyViolation,
  AuditEntry
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
export type { UndoEntry, UndoResult } from './safety/undo-stack.js'
