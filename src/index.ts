// /BashBros - Your Friendly Bash Agent Helper
// https://bashbros.ai

export { BashBros } from './core.js'
export { PolicyEngine } from './policy/engine.js'
export { loadConfig, type BashBrosConfig } from './config.js'
export { AuditLogger } from './audit.js'

// Bash Bro - Your trained sidekick
export { BashBro } from './bro/bro.js'
export { SystemProfiler, type SystemProfile } from './bro/profiler.js'
export { TaskRouter, type RoutingResult } from './bro/router.js'
export { CommandSuggester, type Suggestion } from './bro/suggester.js'
export { BackgroundWorker, type BackgroundTask } from './bro/worker.js'

// Re-export types
export type {
  CommandResult,
  PolicyViolation,
  AuditEntry
} from './types.js'
