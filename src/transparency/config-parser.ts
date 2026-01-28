/**
 * Agent Config Parser with Sensitive Data Redaction
 * Parses YAML/JSON configs and redacts sensitive fields
 */

import { readFileSync } from 'fs'
import { parse as parseYaml } from 'yaml'
import type { AgentType, AgentPermissions } from '../types.js'

// Patterns for sensitive field names that should be redacted
const SENSITIVE_FIELD_PATTERNS = [
  /^api[_-]?key$/i,
  /^apikey$/i,
  /^secret$/i,
  /^password$/i,
  /^credential[s]?$/i,
  /^token$/i,
  /^bearer$/i,
  /^auth$/i,
  /^private[_-]?key$/i,
  /_key$/i,
  /_token$/i,
  /_secret$/i,
  /_password$/i,
  /^access[_-]?token$/i,
  /^refresh[_-]?token$/i,
  /^client[_-]?secret$/i,
  /^encryption[_-]?key$/i
]

// Value patterns that look like secrets (even if field name doesn't match)
const SENSITIVE_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}$/,           // OpenAI API key
  /^ghp_[a-zA-Z0-9]{36}$/,           // GitHub personal access token
  /^gho_[a-zA-Z0-9]{36}$/,           // GitHub OAuth token
  /^glpat-[a-zA-Z0-9\-]{20,}$/,      // GitLab personal access token
  /^xoxb-[a-zA-Z0-9\-]+$/,           // Slack bot token
  /^xoxp-[a-zA-Z0-9\-]+$/,           // Slack user token
  /^AKIA[A-Z0-9]{16}$/,              // AWS access key
  /^-----BEGIN.*PRIVATE KEY-----/,   // PEM private key
  /^Bearer\s+[a-zA-Z0-9\-._~+\/]+=*$/i  // Bearer token
]

const REDACTED_MARKER = '[REDACTED]'

interface ParsedAgentConfig {
  permissions?: AgentPermissions
  hooks?: string[]
  rawRedacted?: Record<string, unknown>
}

/**
 * Check if a field name looks sensitive
 */
function isSensitiveFieldName(name: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(name))
}

/**
 * Check if a value looks like a secret
 */
function isSensitiveValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return SENSITIVE_VALUE_PATTERNS.some(pattern => pattern.test(value))
}

/**
 * Recursively redact sensitive fields from an object
 */
export function redactSensitiveData(obj: unknown, path = ''): unknown {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) => redactSensitiveData(item, `${path}[${index}]`))
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (isSensitiveFieldName(key)) {
        result[key] = REDACTED_MARKER
      } else if (typeof value === 'string' && isSensitiveValue(value)) {
        result[key] = REDACTED_MARKER
      } else {
        result[key] = redactSensitiveData(value, `${path}.${key}`)
      }
    }

    return result
  }

  // For primitive values, check if they look like secrets
  if (typeof obj === 'string' && isSensitiveValue(obj)) {
    return REDACTED_MARKER
  }

  return obj
}

/**
 * Parse Claude Code settings.json
 */
function parseClaudeCodeConfig(content: string): ParsedAgentConfig {
  try {
    const config = JSON.parse(content)
    const result: ParsedAgentConfig = {
      rawRedacted: redactSensitiveData(config) as Record<string, unknown>
    }

    // Extract hooks
    if (config.hooks) {
      result.hooks = Object.keys(config.hooks)
    }

    // Claude Code doesn't have traditional permissions in config
    // but we can extract any security-related settings
    if (config.security || config.permissions) {
      result.permissions = {
        customPolicies: redactSensitiveData(config.security || config.permissions) as Record<string, unknown>
      }
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Parse Clawdbot config.yml (legacy YAML format)
 */
function parseClawdbotConfig(content: string): ParsedAgentConfig {
  try {
    const config = parseYaml(content, { strict: true })
    const result: ParsedAgentConfig = {
      rawRedacted: redactSensitiveData(config) as Record<string, unknown>
    }

    // Extract permissions from security section
    if (config.security) {
      result.permissions = {
        allowedPaths: config.security.allowedPaths,
        blockedCommands: config.security.blockedCommands,
        securityProfile: config.security.profile,
        customPolicies: redactSensitiveData(config.security) as Record<string, unknown>
      }

      if (config.security.riskThreshold) {
        result.permissions.rateLimit = config.security.riskThreshold
      }
    }

    // Extract hooks
    if (config.hooks) {
      result.hooks = Object.keys(config.hooks)
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Parse Moltbot moltbot.json (new JSON format)
 */
function parseMoltbotJsonConfig(content: string): ParsedAgentConfig {
  try {
    const config = JSON.parse(content)
    const result: ParsedAgentConfig = {
      rawRedacted: redactSensitiveData(config) as Record<string, unknown>
    }

    // Extract gateway settings
    const gateway = config.gateway || {}

    // Extract security settings from agents.defaults.sandbox
    const sandbox = config.agents?.defaults?.sandbox || {}

    // Build permissions object
    result.permissions = {
      securityProfile: sandbox.mode,
      customPolicies: {
        gateway: redactSensitiveData(gateway) as Record<string, unknown>,
        sandbox: redactSensitiveData(sandbox) as Record<string, unknown>
      }
    }

    // Extract allowed/blocked from security config if present
    if (config.security) {
      result.permissions.allowedPaths = config.security.allowedPaths
      result.permissions.blockedCommands = config.security.blockedCommands
    }

    // Extract hooks
    if (config.hooks) {
      result.hooks = Object.keys(config.hooks)
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Parse Aider config
 */
function parseAiderConfig(content: string): ParsedAgentConfig {
  try {
    const config = parseYaml(content, { strict: true })
    const result: ParsedAgentConfig = {
      rawRedacted: redactSensitiveData(config) as Record<string, unknown>
    }

    // Aider has different config structure
    // Extract relevant security settings if present
    if (config.auto_commits === false || config.dirty_commits === false) {
      result.permissions = {
        customPolicies: {
          autoCommits: config.auto_commits,
          dirtyCommits: config.dirty_commits
        }
      }
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Parse Gemini CLI config
 */
function parseGeminiCliConfig(content: string): ParsedAgentConfig {
  try {
    const config = JSON.parse(content)
    const result: ParsedAgentConfig = {
      rawRedacted: redactSensitiveData(config) as Record<string, unknown>
    }

    // Extract any security/permission settings
    if (config.safety || config.permissions) {
      result.permissions = {
        customPolicies: redactSensitiveData(config.safety || config.permissions) as Record<string, unknown>
      }
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Parse OpenCode config
 */
function parseOpencodeConfig(content: string): ParsedAgentConfig {
  try {
    const config = parseYaml(content, { strict: true })
    const result: ParsedAgentConfig = {
      rawRedacted: redactSensitiveData(config) as Record<string, unknown>
    }

    // Extract security settings
    if (config.security) {
      result.permissions = {
        allowedPaths: config.security.allowedPaths,
        blockedCommands: config.security.blockedCommands,
        customPolicies: redactSensitiveData(config.security) as Record<string, unknown>
      }
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Parse agent configuration file
 */
export async function parseAgentConfig(
  agent: AgentType,
  configPath: string
): Promise<ParsedAgentConfig | null> {
  try {
    const content = readFileSync(configPath, 'utf-8')

    switch (agent) {
      case 'claude-code':
        return parseClaudeCodeConfig(content)
      case 'clawdbot':
        // Check if it's JSON (moltbot.json) or YAML (config.yml)
        if (content.trim().startsWith('{')) {
          return parseMoltbotJsonConfig(content)
        }
        return parseClawdbotConfig(content)
      case 'moltbot':
        return parseMoltbotJsonConfig(content)
      case 'aider':
        return parseAiderConfig(content)
      case 'gemini-cli':
        return parseGeminiCliConfig(content)
      case 'opencode':
        return parseOpencodeConfig(content)
      default:
        // Generic YAML/JSON parser
        try {
          const config = content.trim().startsWith('{')
            ? JSON.parse(content)
            : parseYaml(content, { strict: true })

          return {
            rawRedacted: redactSensitiveData(config) as Record<string, unknown>
          }
        } catch {
          return null
        }
    }
  } catch {
    return null
  }
}

/**
 * Get a safe string representation of config for display
 */
export function formatRedactedConfig(
  config: Record<string, unknown>,
  indent = 0
): string {
  const lines: string[] = []
  const prefix = '  '.repeat(indent)

  for (const [key, value] of Object.entries(config)) {
    if (value === null || value === undefined) {
      continue
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      lines.push(`${prefix}${key}:`)
      lines.push(formatRedactedConfig(value as Record<string, unknown>, indent + 1))
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${prefix}${key}: []`)
      } else if (typeof value[0] === 'object') {
        lines.push(`${prefix}${key}:`)
        for (const item of value) {
          lines.push(`${prefix}  -`)
          lines.push(formatRedactedConfig(item as Record<string, unknown>, indent + 2))
        }
      } else {
        lines.push(`${prefix}${key}: [${value.join(', ')}]`)
      }
    } else {
      lines.push(`${prefix}${key}: ${value}`)
    }
  }

  return lines.join('\n')
}
