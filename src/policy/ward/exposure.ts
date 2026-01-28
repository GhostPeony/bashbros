/**
 * Exposure Scanner - Detects exposed AI agent servers
 *
 * Scans for listening ports that match known AI agent signatures
 * and assesses their security risk based on binding, authentication,
 * and external reachability.
 */

import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, readFileSync } from 'node:fs'
import { platform } from 'node:os'
import type {
  AgentSignature,
  ExposureResult,
  ExposureSeverity,
  ExposureAction,
  ExposureConfig,
} from './types.js'

const execAsync = promisify(exec)

/**
 * Default agent signatures for common AI coding assistants
 */
export const DEFAULT_AGENT_SIGNATURES: AgentSignature[] = [
  {
    name: 'claude-code',
    processNames: ['claude', 'claude-code', 'claude_code'],
    defaultPorts: [3000, 3001, 8080],
    configPaths: [
      '~/.claude/config.json',
      '~/.config/claude/config.json',
    ],
    authIndicators: ['api_key', 'auth_token', 'authorization'],
  },
  {
    name: 'aider',
    processNames: ['aider', 'aider-chat'],
    defaultPorts: [8501, 8000],
    configPaths: [
      '~/.aider.conf.yml',
      '.aider.conf.yml',
    ],
    authIndicators: ['api_key', 'openai_api_key'],
  },
  {
    name: 'continue',
    processNames: ['continue', 'continue-server'],
    defaultPorts: [65432, 65433],
    configPaths: [
      '~/.continue/config.json',
      '.continue/config.json',
    ],
    authIndicators: ['apiKey', 'auth'],
  },
  {
    name: 'cursor',
    processNames: ['cursor', 'Cursor', 'cursor-server'],
    defaultPorts: [3000, 8080, 9000],
    configPaths: [
      '~/.cursor/config.json',
      '%APPDATA%/Cursor/config.json',
    ],
    authIndicators: ['apiKey', 'token', 'auth'],
  },
]

/**
 * Default mapping from severity to action
 */
export const DEFAULT_SEVERITY_ACTIONS: Record<ExposureSeverity, ExposureAction> = {
  low: 'alert',
  medium: 'alert',
  high: 'block',
  critical: 'block_and_kill',
}

/**
 * Input for severity assessment
 */
export interface SeverityInput {
  bindAddress: string
  hasAuth: boolean | 'unknown'
  externallyReachable: boolean
  hasActiveSessions: boolean
}

/**
 * Parsed netstat line result
 */
export interface NetstatResult {
  protocol: string
  localAddress: string
  localPort: number
  state: string
  pid: number
}

/**
 * ExposureScanner - Scans for exposed AI agent servers
 */
export class ExposureScanner {
  private config: ExposureConfig
  private agents: AgentSignature[]

  constructor(config?: Partial<ExposureConfig>) {
    this.agents = [...DEFAULT_AGENT_SIGNATURES]
    this.config = {
      enabled: true,
      scanInterval: 60000,
      externalProbe: false,
      severityActions: { ...DEFAULT_SEVERITY_ACTIONS },
      agents: this.agents,
      ...config,
    }

    // Merge any custom agents from config
    if (config?.agents) {
      for (const agent of config.agents) {
        if (!this.agents.find(a => a.name === agent.name)) {
          this.agents.push(agent)
        }
      }
    }
  }

  /**
   * Scan for exposed agent servers
   */
  async scan(): Promise<ExposureResult[]> {
    const results: ExposureResult[] = []
    const listeningPorts = await this.getListeningPorts()

    for (const port of listeningPorts) {
      for (const agent of this.agents) {
        if (agent.defaultPorts.includes(port.localPort)) {
          const hasAuth = await this.checkAuthConfig(agent)
          const externallyReachable = this.isExternallyReachable(port.localAddress)

          const severity = this.assessSeverity({
            bindAddress: port.localAddress,
            hasAuth,
            externallyReachable,
            hasActiveSessions: false,
          })

          const action = this.getActionForSeverity(severity)

          results.push({
            agent: agent.name,
            pid: port.pid,
            port: port.localPort,
            bindAddress: port.localAddress,
            hasAuth,
            severity,
            action,
            message: this.generateMessage(agent.name, port, severity, hasAuth),
            timestamp: new Date(),
          })
        }
      }
    }

    return results
  }

  /**
   * Assess severity based on exposure factors
   */
  assessSeverity(input: SeverityInput): ExposureSeverity {
    const { bindAddress, hasAuth, externallyReachable, hasActiveSessions } = input

    // Critical: Externally reachable without auth
    if (externallyReachable && hasAuth !== true) {
      return 'critical'
    }

    // Critical: Active sessions on externally reachable
    if (externallyReachable && hasActiveSessions) {
      return 'critical'
    }

    // High: Bound to all interfaces (0.0.0.0 or ::) without auth
    const isWildcardBind = bindAddress === '0.0.0.0' || bindAddress === '::' || bindAddress === '*'
    if (isWildcardBind && hasAuth !== true) {
      return 'high'
    }

    // Medium: Bound to all interfaces with auth, or localhost without auth
    if (isWildcardBind && hasAuth === true) {
      return 'medium'
    }

    // Check if localhost
    const isLocalhost =
      bindAddress === '127.0.0.1' ||
      bindAddress === '::1' ||
      bindAddress === 'localhost'

    if (isLocalhost && hasAuth !== true) {
      return 'medium'
    }

    // Low: Localhost with auth
    return 'low'
  }

  /**
   * Get action for a given severity level
   */
  getActionForSeverity(severity: ExposureSeverity): ExposureAction {
    return this.config.severityActions[severity]
  }

  /**
   * Parse a Windows netstat output line
   */
  parseNetstatLine(line: string): NetstatResult | null {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('LISTENING')) {
      return null
    }

    // Windows netstat -ano format:
    // TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       12345
    // TCP    [::]:8000              [::]:0                 LISTENING       1111

    const parts = trimmed.split(/\s+/)
    if (parts.length < 5) {
      return null
    }

    const protocol = parts[0]
    if (protocol !== 'TCP' && protocol !== 'UDP') {
      return null
    }

    const localAddressPart = parts[1]
    const state = parts[3]
    const pid = parseInt(parts[4], 10)

    if (state !== 'LISTENING' || isNaN(pid)) {
      return null
    }

    // Parse address:port - handle IPv6 [addr]:port format
    let localAddress: string
    let localPort: number

    if (localAddressPart.startsWith('[')) {
      // IPv6 format: [::1]:3000 or [::]:8000
      const match = localAddressPart.match(/^\[([^\]]+)\]:(\d+)$/)
      if (!match) {
        return null
      }
      localAddress = match[1]
      localPort = parseInt(match[2], 10)
    } else {
      // IPv4 format: 0.0.0.0:3000
      const lastColonIndex = localAddressPart.lastIndexOf(':')
      if (lastColonIndex === -1) {
        return null
      }
      localAddress = localAddressPart.substring(0, lastColonIndex)
      localPort = parseInt(localAddressPart.substring(lastColonIndex + 1), 10)
    }

    if (isNaN(localPort)) {
      return null
    }

    return {
      protocol,
      localAddress,
      localPort,
      state,
      pid,
    }
  }

  /**
   * Get all listening TCP ports (cross-platform)
   */
  async getListeningPorts(): Promise<NetstatResult[]> {
    const results: NetstatResult[] = []

    try {
      if (platform() === 'win32') {
        const { stdout } = await execAsync('netstat -ano -p TCP')
        const lines = stdout.split('\n')

        for (const line of lines) {
          const parsed = this.parseNetstatLine(line)
          if (parsed) {
            results.push(parsed)
          }
        }
      } else {
        // Unix-like systems: use ss or netstat
        try {
          const { stdout } = await execAsync('ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null')
          const lines = stdout.split('\n')

          for (const line of lines) {
            const parsed = this.parseUnixListeningLine(line)
            if (parsed) {
              results.push(parsed)
            }
          }
        } catch {
          // Fallback to lsof on macOS
          const { stdout } = await execAsync('lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null || true')
          const lines = stdout.split('\n')

          for (const line of lines) {
            const parsed = this.parseLsofLine(line)
            if (parsed) {
              results.push(parsed)
            }
          }
        }
      }
    } catch {
      // Return empty array if we can't get port info
    }

    return results
  }

  /**
   * Parse Unix ss/netstat output line
   */
  private parseUnixListeningLine(line: string): NetstatResult | null {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('State') || trimmed.startsWith('Proto')) {
      return null
    }

    // ss format: LISTEN 0 128 0.0.0.0:3000 0.0.0.0:* users:(("node",pid=1234,fd=3))
    // netstat format: tcp 0 0 0.0.0.0:3000 0.0.0.0:* LISTEN 1234/node

    // Try ss format first
    const ssMatch = trimmed.match(/LISTEN\s+\d+\s+\d+\s+([^\s]+):(\d+)\s+.*?pid=(\d+)/)
    if (ssMatch) {
      return {
        protocol: 'TCP',
        localAddress: ssMatch[1] === '*' ? '0.0.0.0' : ssMatch[1],
        localPort: parseInt(ssMatch[2], 10),
        state: 'LISTENING',
        pid: parseInt(ssMatch[3], 10),
      }
    }

    // Try netstat format
    const netstatMatch = trimmed.match(/tcp\s+\d+\s+\d+\s+([^\s]+):(\d+)\s+.*?LISTEN\s+(\d+)/)
    if (netstatMatch) {
      return {
        protocol: 'TCP',
        localAddress: netstatMatch[1] === '*' ? '0.0.0.0' : netstatMatch[1],
        localPort: parseInt(netstatMatch[2], 10),
        state: 'LISTENING',
        pid: parseInt(netstatMatch[3], 10),
      }
    }

    return null
  }

  /**
   * Parse lsof output line (macOS fallback)
   */
  private parseLsofLine(line: string): NetstatResult | null {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('COMMAND')) {
      return null
    }

    // lsof format: node 1234 user 3u IPv4 0x123 0t0 TCP *:3000 (LISTEN)
    const parts = trimmed.split(/\s+/)
    if (parts.length < 9) {
      return null
    }

    const pid = parseInt(parts[1], 10)
    if (isNaN(pid)) {
      return null
    }

    // Find TCP and port info
    const tcpIndex = parts.findIndex(p => p === 'TCP' || p === 'TCP6')
    if (tcpIndex === -1) {
      return null
    }

    const addressPart = parts[tcpIndex + 1]
    if (!addressPart) {
      return null
    }

    // Parse *:3000 or 127.0.0.1:3000
    const match = addressPart.match(/^([^:]+):(\d+)$/)
    if (!match) {
      return null
    }

    return {
      protocol: 'TCP',
      localAddress: match[1] === '*' ? '0.0.0.0' : match[1],
      localPort: parseInt(match[2], 10),
      state: 'LISTENING',
      pid,
    }
  }

  /**
   * Check if an agent has auth configured
   */
  async checkAuthConfig(agent: AgentSignature): Promise<boolean | 'unknown'> {
    for (const configPath of agent.configPaths) {
      const expandedPath = this.expandPath(configPath)

      if (existsSync(expandedPath)) {
        try {
          const content = readFileSync(expandedPath, 'utf-8')

          for (const indicator of agent.authIndicators) {
            if (content.includes(indicator)) {
              return true
            }
          }
          return false
        } catch {
          // Can't read config, unknown
        }
      }
    }

    return 'unknown'
  }

  /**
   * Check if an address is externally reachable
   */
  private isExternallyReachable(bindAddress: string): boolean {
    // 0.0.0.0 or :: binds to all interfaces
    if (bindAddress === '0.0.0.0' || bindAddress === '::' || bindAddress === '*') {
      // Could be externally reachable if there's a non-loopback interface
      // For now, we assume it could be reachable
      // In a real implementation, we'd check network interfaces
      return this.config.externalProbe
    }

    // Localhost addresses are not externally reachable
    if (
      bindAddress === '127.0.0.1' ||
      bindAddress === '::1' ||
      bindAddress === 'localhost'
    ) {
      return false
    }

    // Private IP ranges - potentially reachable on LAN
    if (this.isPrivateIP(bindAddress)) {
      return this.config.externalProbe
    }

    // Public IP - externally reachable
    return true
  }

  /**
   * Check if an IP is in a private range
   */
  private isPrivateIP(ip: string): boolean {
    // IPv4 private ranges
    if (ip.startsWith('10.')) return true
    if (ip.startsWith('172.')) {
      const second = parseInt(ip.split('.')[1], 10)
      if (second >= 16 && second <= 31) return true
    }
    if (ip.startsWith('192.168.')) return true

    // IPv6 private ranges
    if (ip.toLowerCase().startsWith('fc') || ip.toLowerCase().startsWith('fd')) {
      return true
    }

    return false
  }

  /**
   * Expand path with home directory and environment variables
   */
  private expandPath(path: string): string {
    let expanded = path

    // Expand ~ to home directory
    if (expanded.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || ''
      expanded = expanded.replace('~', home)
    }

    // Expand %VAR% style env vars (Windows)
    expanded = expanded.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '')

    // Expand $VAR style env vars (Unix)
    expanded = expanded.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => process.env[name] || '')

    return expanded
  }

  /**
   * Generate human-readable message for an exposure
   */
  private generateMessage(
    agentName: string,
    port: NetstatResult,
    severity: ExposureSeverity,
    hasAuth: boolean | 'unknown'
  ): string {
    const authStatus = hasAuth === true
      ? 'with authentication'
      : hasAuth === false
        ? 'without authentication'
        : 'authentication status unknown'

    const bindDesc = port.localAddress === '0.0.0.0' || port.localAddress === '::'
      ? 'all interfaces'
      : port.localAddress

    return `${agentName} server detected on port ${port.localPort} (${bindDesc}) ${authStatus}. Severity: ${severity}`
  }

  /**
   * Add a custom agent signature
   */
  addAgent(agent: AgentSignature): void {
    this.agents.push(agent)
  }

  /**
   * Get all configured agent signatures
   */
  getAgents(): AgentSignature[] {
    return [...this.agents]
  }
}
