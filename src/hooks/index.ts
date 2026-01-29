// Hook integrations
export { ClaudeCodeHooks, gateCommand } from './claude-code.js'
export type { ClaudeSettings } from './claude-code.js'

// Moltbot integration
export { MoltbotHooks, getMoltbotHooks } from './moltbot.js'
export type { MoltbotSettings, MoltbotStatus, MoltbotGatewayStatus } from './moltbot.js'

// Gemini CLI integration
export { GeminiCLIHooks } from './gemini-cli.js'
export type { GeminiSettings } from './gemini-cli.js'

// Copilot CLI integration
export { CopilotCLIHooks } from './copilot-cli.js'
export type { CopilotHookConfig } from './copilot-cli.js'

// OpenCode integration
export { OpenCodeHooks } from './opencode.js'

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
