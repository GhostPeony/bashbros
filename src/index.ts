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
