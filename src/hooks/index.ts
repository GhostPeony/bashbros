// Hook integrations
export { ClaudeCodeHooks, gateCommand } from './claude-code.js'
export type { ClaudeSettings } from './claude-code.js'

// Moltbot integration
export { MoltbotHooks, getMoltbotHooks } from './moltbot.js'
export type { MoltbotSettings, MoltbotStatus, MoltbotGatewayStatus } from './moltbot.js'

// Moltbot runtime detection
export {
  detectMoltbotSession,
  isInMoltbotSession,
  getMoltbotSessionId,
  getMoltbotAgentName,
  isSandboxEnabled,
  getCustomConfigPath,
  getStateDir
} from './moltbot-runtime.js'
