/**
 * Moltbot Runtime Session Detection
 * Detects when running inside a moltbot session via environment variables
 */

import type { MoltbotSessionContext } from '../types.js'

/**
 * Detect if we're running inside a moltbot session
 * Checks environment variables set by moltbot when spawning commands
 */
export function detectMoltbotSession(): MoltbotSessionContext {
  // Check for moltbot environment variables (new naming)
  const moltbotSessionId = process.env.MOLTBOT_SESSION_ID
  const moltbotAgent = process.env.MOLTBOT_AGENT
  const moltbotSandbox = process.env.MOLTBOT_SANDBOX

  // Check for clawdbot environment variables (legacy naming)
  const clawdbotSessionId = process.env.CLAWDBOT_SESSION_ID
  const clawdbotAgent = process.env.CLAWDBOT_AGENT

  // Check for shared config path (works with both)
  const configPath = process.env.CLAWDBOT_CONFIG_PATH
  const stateDir = process.env.CLAWDBOT_STATE_DIR

  // Determine session ID (prefer moltbot over clawdbot)
  const sessionId = moltbotSessionId || clawdbotSessionId

  // Determine agent name
  const agentName = moltbotAgent || clawdbotAgent

  // Determine sandbox mode
  // MOLTBOT_SANDBOX can be 'strict', 'permissive', or 'off'
  const sandboxMode = moltbotSandbox !== 'off'

  // Determine if we're in a moltbot session
  const inMoltbotSession = !!(sessionId || agentName)

  return {
    inMoltbotSession,
    sessionId,
    agentName,
    sandboxMode,
    customConfigPath: configPath
  }
}

/**
 * Check if we're in a moltbot session (simple boolean check)
 */
export function isInMoltbotSession(): boolean {
  return !!(
    process.env.MOLTBOT_SESSION_ID ||
    process.env.MOLTBOT_AGENT ||
    process.env.CLAWDBOT_SESSION_ID ||
    process.env.CLAWDBOT_AGENT
  )
}

/**
 * Get the moltbot session ID if running in a session
 */
export function getMoltbotSessionId(): string | undefined {
  return process.env.MOLTBOT_SESSION_ID || process.env.CLAWDBOT_SESSION_ID
}

/**
 * Get the moltbot agent name if running in a session
 */
export function getMoltbotAgentName(): string | undefined {
  return process.env.MOLTBOT_AGENT || process.env.CLAWDBOT_AGENT
}

/**
 * Check if sandbox mode is enabled in the current session
 */
export function isSandboxEnabled(): boolean {
  const sandbox = process.env.MOLTBOT_SANDBOX
  return sandbox !== 'off'
}

/**
 * Get the custom config path if set
 */
export function getCustomConfigPath(): string | undefined {
  return process.env.CLAWDBOT_CONFIG_PATH
}

/**
 * Get the state directory if set
 */
export function getStateDir(): string | undefined {
  return process.env.CLAWDBOT_STATE_DIR
}
