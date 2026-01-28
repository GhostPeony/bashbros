/**
 * Agent Transparency Module
 * Provides visibility into agent configurations and permissions
 */

export {
  AGENT_CONFIG_PATHS,
  getAgentConfigInfo,
  getAllAgentConfigs,
  getInstalledAgents,
  getConfiguredAgents,
  detectMoltbotNaming
} from './agent-config.js'

export {
  redactSensitiveData,
  parseAgentConfig,
  formatRedactedConfig
} from './config-parser.js'

export {
  getEffectivePermissions,
  formatAgentInfo,
  formatPermissionsTable
} from './display.js'
