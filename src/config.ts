import { readFileSync, existsSync, statSync } from 'fs'
import { parse } from 'yaml'
import { join } from 'path'
import { homedir } from 'os'
import type { BashBrosConfig, SecurityProfile } from './types.js'

const CONFIG_FILENAME = '.bashbros.yml'

// Configuration limits for validation
const CONFIG_LIMITS = {
  maxPerMinute: { min: 1, max: 10000 },
  maxPerHour: { min: 1, max: 100000 },
  maxPatterns: 100,
  maxPathLength: 1000
}

export function findConfig(): string | null {
  // Check current directory
  if (existsSync(CONFIG_FILENAME)) {
    return CONFIG_FILENAME
  }

  // Check home directory
  const homeConfig = join(homedir(), CONFIG_FILENAME)
  if (existsSync(homeConfig)) {
    return homeConfig
  }

  // Check ~/.bashbros/config.yml
  const dotConfig = join(homedir(), '.bashbros', 'config.yml')
  if (existsSync(dotConfig)) {
    return dotConfig
  }

  return null
}

/**
 * SECURITY: Validate config file permissions
 */
function validateConfigPermissions(configPath: string): void {
  try {
    const stats = statSync(configPath)

    // On Unix, check if file is world-writable (security risk)
    if (process.platform !== 'win32') {
      const mode = stats.mode
      const worldWritable = (mode & 0o002) !== 0
      const groupWritable = (mode & 0o020) !== 0

      if (worldWritable || groupWritable) {
        console.warn(`⚠️  Warning: Config file ${configPath} has insecure permissions`)
        console.warn('   Run: chmod 600 ' + configPath)
      }
    }
  } catch {
    // Ignore permission check errors
  }
}

export function loadConfig(path?: string): BashBrosConfig {
  const configPath = path || findConfig()

  if (!configPath) {
    return getDefaultConfig()
  }

  // SECURITY: Check file permissions
  validateConfigPermissions(configPath)

  const content = readFileSync(configPath, 'utf-8')

  // SECURITY: Use safe YAML parsing (no custom tags)
  let parsed: unknown
  try {
    parsed = parse(content, { strict: true })
  } catch (error) {
    console.error('Failed to parse config file:', error)
    return getDefaultConfig()
  }

  // SECURITY: Validate parsed config
  const validated = validateConfig(parsed)

  return mergeWithDefaults(validated)
}

/**
 * SECURITY: Validate and sanitize config values
 */
function validateConfig(parsed: unknown): Partial<BashBrosConfig> {
  if (!parsed || typeof parsed !== 'object') {
    return {}
  }

  const config = parsed as Record<string, unknown>
  const validated: Partial<BashBrosConfig> = {}

  // Validate agent type
  const validAgents = ['claude-code', 'clawdbot', 'gemini-cli', 'aider', 'opencode', 'custom']
  if (typeof config.agent === 'string' && validAgents.includes(config.agent)) {
    validated.agent = config.agent as BashBrosConfig['agent']
  }

  // Validate profile
  const validProfiles = ['balanced', 'strict', 'permissive', 'custom']
  if (typeof config.profile === 'string' && validProfiles.includes(config.profile)) {
    validated.profile = config.profile as SecurityProfile
  }

  // Validate commands
  if (config.commands && typeof config.commands === 'object') {
    const cmds = config.commands as Record<string, unknown>
    validated.commands = {
      allow: validateStringArray(cmds.allow, CONFIG_LIMITS.maxPatterns),
      block: validateStringArray(cmds.block, CONFIG_LIMITS.maxPatterns)
    }
  }

  // Validate paths
  if (config.paths && typeof config.paths === 'object') {
    const paths = config.paths as Record<string, unknown>
    validated.paths = {
      allow: validatePathArray(paths.allow),
      block: validatePathArray(paths.block)
    }
  }

  // Validate secrets
  if (config.secrets && typeof config.secrets === 'object') {
    const secrets = config.secrets as Record<string, unknown>
    validated.secrets = {
      enabled: typeof secrets.enabled === 'boolean' ? secrets.enabled : true,
      mode: secrets.mode === 'audit' ? 'audit' : 'block',
      patterns: validateStringArray(secrets.patterns, CONFIG_LIMITS.maxPatterns)
    }
  }

  // Validate audit
  if (config.audit && typeof config.audit === 'object') {
    const audit = config.audit as Record<string, unknown>
    validated.audit = {
      enabled: typeof audit.enabled === 'boolean' ? audit.enabled : true,
      destination: validateAuditDestination(audit.destination),
      remotePath: validateRemotePath(audit.remotePath)
    }
  }

  // Validate rate limit
  if (config.rateLimit && typeof config.rateLimit === 'object') {
    const rl = config.rateLimit as Record<string, unknown>
    const maxPerMinute = validateNumber(rl.maxPerMinute, CONFIG_LIMITS.maxPerMinute)
    const maxPerHour = validateNumber(rl.maxPerHour, CONFIG_LIMITS.maxPerHour)

    // SECURITY: Ensure hour limit >= minute limit
    validated.rateLimit = {
      enabled: typeof rl.enabled === 'boolean' ? rl.enabled : true,
      maxPerMinute,
      maxPerHour: Math.max(maxPerHour, maxPerMinute)
    }
  }

  return validated
}

function validateStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, maxItems)
    .map(s => s.slice(0, 500)) // Limit string length
}

function validatePathArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is string => typeof item === 'string')
    .slice(0, CONFIG_LIMITS.maxPatterns)
    .map(s => s.slice(0, CONFIG_LIMITS.maxPathLength))
    .filter(s => !s.includes('\0')) // Block null bytes
}

function validateNumber(value: unknown, limits: { min: number; max: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return limits.min
  }
  return Math.max(limits.min, Math.min(limits.max, Math.floor(value)))
}

function validateAuditDestination(value: unknown): 'local' | 'remote' | 'both' {
  if (value === 'remote' || value === 'both') {
    return value
  }
  return 'local'
}

/**
 * SECURITY: Validate remote audit path (must be HTTPS)
 */
function validateRemotePath(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  try {
    const url = new URL(value)

    // SECURITY: Only allow HTTPS
    if (url.protocol !== 'https:') {
      console.warn('⚠️  Warning: Remote audit path must use HTTPS. Ignoring:', value)
      return undefined
    }

    // Block localhost/private IPs for remote
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
      // Allow for testing but warn
      console.warn('⚠️  Warning: Remote audit path points to local address')
    }

    return value
  } catch {
    console.warn('⚠️  Warning: Invalid remote audit URL:', value)
    return undefined
  }
}

export function getDefaultConfig(): BashBrosConfig {
  return {
    agent: 'claude-code',
    profile: 'balanced',
    commands: getDefaultCommands('balanced'),
    paths: getDefaultPaths('balanced'),
    secrets: {
      enabled: true,
      mode: 'block',
      patterns: [
        '.env*',
        '*.pem',
        '*.key',
        '*credentials*',
        '*secret*',
        '.aws/*',
        '.ssh/*'
      ]
    },
    audit: {
      enabled: true,
      destination: 'local'
    },
    rateLimit: {
      enabled: true,
      maxPerMinute: 100,
      maxPerHour: 1000
    }
  }
}

function getDefaultCommands(profile: SecurityProfile) {
  const dangerousCommands = [
    'rm -rf /',
    'rm -rf ~',
    'rm -rf /*',
    ':(){:|:&};:',
    'mkfs',
    'dd if=/dev/zero',
    '> /dev/sda',
    'chmod -R 777 /',
    'curl * | bash',
    'wget * | bash',
    'curl * | sh',
    'wget * | sh'
  ]

  const commonAllowed = [
    'ls *', 'cat *', 'head *', 'tail *', 'grep *',
    'git *', 'npm *', 'npx *', 'pnpm *', 'yarn *',
    'node *', 'python *', 'pip *',
    'mkdir *', 'touch *', 'cp *', 'mv *',
    'cd *', 'pwd', 'echo *', 'which *',
    'code *', 'vim *', 'nano *'
  ]

  if (profile === 'strict') {
    return { allow: [], block: dangerousCommands }
  }

  if (profile === 'permissive') {
    return { allow: ['*'], block: dangerousCommands }
  }

  // balanced
  return { allow: commonAllowed, block: dangerousCommands }
}

function getDefaultPaths(profile: SecurityProfile) {
  const dangerousPaths = [
    '~/.ssh',
    '~/.aws',
    '~/.gnupg',
    '~/.config/gh',
    '/etc/passwd',
    '/etc/shadow'
  ]

  if (profile === 'strict') {
    return { allow: ['.'], block: dangerousPaths }
  }

  if (profile === 'permissive') {
    return { allow: ['*'], block: dangerousPaths }
  }

  // balanced
  return { allow: ['.', '~'], block: dangerousPaths }
}

function mergeWithDefaults(parsed: Partial<BashBrosConfig>): BashBrosConfig {
  const defaults = getDefaultConfig()
  return {
    ...defaults,
    ...parsed,
    commands: { ...defaults.commands, ...parsed.commands },
    paths: { ...defaults.paths, ...parsed.paths },
    secrets: { ...defaults.secrets, ...parsed.secrets },
    audit: { ...defaults.audit, ...parsed.audit },
    rateLimit: { ...defaults.rateLimit, ...parsed.rateLimit }
  }
}

export { BashBrosConfig }
