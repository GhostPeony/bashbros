import { readFileSync, existsSync } from 'fs'
import { parse } from 'yaml'
import { join } from 'path'
import { homedir } from 'os'
import type { BashBrosConfig, SecurityProfile } from './types.js'

const CONFIG_FILENAME = '.bashbros.yml'

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

export function loadConfig(path?: string): BashBrosConfig {
  const configPath = path || findConfig()

  if (!configPath) {
    return getDefaultConfig()
  }

  const content = readFileSync(configPath, 'utf-8')
  const parsed = parse(content)

  return mergeWithDefaults(parsed)
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
    'wget * | bash'
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
