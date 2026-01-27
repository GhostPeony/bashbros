/**
 * Command Risk Scoring
 * Scores commands 1-10 based on potential danger
 */

export interface RiskScore {
  score: number
  level: 'safe' | 'caution' | 'dangerous' | 'critical'
  factors: string[]
}

interface RiskPattern {
  pattern: RegExp
  score: number
  factor: string
}

// Risk patterns organized by category
const INFO_GATHERING: RiskPattern[] = [
  { pattern: /\bwhoami\b/, score: 2, factor: 'User identification' },
  { pattern: /\bid\b/, score: 2, factor: 'User/group info' },
  { pattern: /\buname\b/, score: 2, factor: 'System info' },
  { pattern: /\bhostname\b/, score: 1, factor: 'Hostname query' },
  { pattern: /cat\s+\/etc\/passwd/, score: 5, factor: 'Password file access' },
  { pattern: /cat\s+\/etc\/shadow/, score: 9, factor: 'Shadow file access' },
  { pattern: /cat\s+\/etc\/hosts/, score: 3, factor: 'Hosts file access' },
  { pattern: /\bps\s+(aux|ef)/, score: 3, factor: 'Process listing' },
  { pattern: /\bnetstat\b/, score: 4, factor: 'Network connections' },
  { pattern: /\bss\s+-/, score: 4, factor: 'Socket statistics' },
  { pattern: /\blsof\b/, score: 4, factor: 'Open files listing' },
  { pattern: /\bfind\s+.*-perm/, score: 5, factor: 'Permission scanning' },
  { pattern: /\bfind\s+.*-user\s+root/, score: 5, factor: 'Root file scanning' },
]

const PERSISTENCE: RiskPattern[] = [
  { pattern: /\bcrontab\b/, score: 7, factor: 'Cron job modification' },
  { pattern: /\/etc\/cron/, score: 7, factor: 'System cron access' },
  { pattern: /\bsystemctl\s+(enable|disable)/, score: 7, factor: 'Service persistence' },
  { pattern: /\bchkconfig\b/, score: 6, factor: 'Service configuration' },
  { pattern: /\.bashrc|\.bash_profile|\.profile/, score: 6, factor: 'Shell profile modification' },
  { pattern: /\/etc\/rc\.local/, score: 8, factor: 'Startup script' },
  { pattern: /\.ssh\/authorized_keys/, score: 8, factor: 'SSH key injection' },
]

const DATA_EXFIL: RiskPattern[] = [
  { pattern: /curl.*\|\s*(bash|sh)/, score: 10, factor: 'Remote code execution' },
  { pattern: /wget.*\|\s*(bash|sh)/, score: 10, factor: 'Remote code execution' },
  { pattern: /\bnc\s+-[elp]/, score: 9, factor: 'Netcat listener/connection' },
  { pattern: /\b(ncat|netcat|socat)\s/, score: 9, factor: 'Network tool' },
  { pattern: /\bscp\s+.*@/, score: 6, factor: 'Remote file copy' },
  { pattern: /\brsync\s+.*@/, score: 6, factor: 'Remote sync' },
  { pattern: /curl.*-d.*\$/, score: 7, factor: 'Data exfiltration via curl' },
  { pattern: /base64.*\|.*curl/, score: 8, factor: 'Encoded data exfiltration' },
  { pattern: /python.*-m\s+http\.server/, score: 8, factor: 'HTTP server exposure' },
  { pattern: /\baws\s+s3\s+(cp|sync|mv)/, score: 7, factor: 'Cloud data transfer' },
  { pattern: /\bgsutil\s+(cp|rsync|mv)/, score: 7, factor: 'Cloud data transfer' },
  { pattern: /\baz\s+storage\s+blob/, score: 7, factor: 'Cloud data transfer' },
]

const DESTRUCTIVE: RiskPattern[] = [
  { pattern: /\brm\s+-rf\s+\//, score: 10, factor: 'Root filesystem deletion' },
  { pattern: /\brm\s+-rf\s+~/, score: 9, factor: 'Home directory deletion' },
  { pattern: /\brm\s+-rf\s+\*/, score: 8, factor: 'Wildcard deletion' },
  { pattern: /\bmkfs\b/, score: 10, factor: 'Filesystem format' },
  { pattern: /\bdd\s+.*of=\/dev\//, score: 10, factor: 'Direct disk write' },
  { pattern: />\s*\/dev\/sda/, score: 10, factor: 'Disk overwrite' },
  { pattern: /:.*\(\).*\{.*:.*\|.*:.*&.*\}/, score: 10, factor: 'Fork bomb' },
  { pattern: /\bshred\b/, score: 8, factor: 'Secure file deletion' },
]

const PRIVILEGE_ESCALATION: RiskPattern[] = [
  { pattern: /\bsudo\s+-i/, score: 7, factor: 'Interactive root shell' },
  { pattern: /\bsudo\s+su\b/, score: 7, factor: 'Switch to root' },
  { pattern: /\bchmod\s+[47]777/, score: 8, factor: 'World-writable permissions' },
  { pattern: /\bchmod\s+u\+s/, score: 9, factor: 'SUID bit setting' },
  { pattern: /\bchown\s+root/, score: 7, factor: 'Change to root ownership' },
  { pattern: /\/etc\/sudoers/, score: 9, factor: 'Sudoers modification' },
  { pattern: /\bpasswd\s+root/, score: 9, factor: 'Root password change' },
]

const EVASION: RiskPattern[] = [
  { pattern: /\bhistory\s+-[cd]/, score: 6, factor: 'History manipulation' },
  { pattern: /unset\s+HISTFILE/, score: 7, factor: 'Disable history logging' },
  { pattern: /export\s+HISTSIZE=0/, score: 7, factor: 'Disable history' },
  { pattern: /\brm\s+.*\.bash_history/, score: 7, factor: 'History deletion' },
  { pattern: /\b\/dev\/null.*2>&1/, score: 3, factor: 'Output suppression' },
  { pattern: /base64\s+-d/, score: 5, factor: 'Base64 decoding' },
  { pattern: /\beval\s+/, score: 6, factor: 'Dynamic code execution' },
  { pattern: /\$'\\x[0-9a-f]/, score: 7, factor: 'ANSI-C quoting bypass' },
  { pattern: /python.*-c\s+['"]/, score: 5, factor: 'Python code execution' },
  { pattern: /perl.*-e\s+['"]/, score: 5, factor: 'Perl code execution' },
  { pattern: /ruby.*-e\s+['"]/, score: 5, factor: 'Ruby code execution' },
  { pattern: /node.*-e\s+['"]/, score: 5, factor: 'Node code execution' },
]

const CONTAINER_ESCAPE: RiskPattern[] = [
  { pattern: /docker\s+run.*-v\s+\/[^\/]*:/, score: 8, factor: 'Docker root mount' },
  { pattern: /docker\s+run.*--privileged/, score: 9, factor: 'Privileged container' },
  { pattern: /docker\s+exec.*-it/, score: 5, factor: 'Container shell access' },
  { pattern: /kubectl\s+exec/, score: 6, factor: 'Kubernetes exec' },
  { pattern: /kubectl\s+cp/, score: 6, factor: 'Kubernetes file copy' },
  { pattern: /docker\s+cp.*:\//, score: 6, factor: 'Docker file extraction' },
]

const FILE_READERS: RiskPattern[] = [
  { pattern: /\b(head|tail)\s+.*\.(env|pem|key|secret)/i, score: 6, factor: 'Sensitive file read' },
  { pattern: /\b(less|more)\s+.*\.(env|pem|key|secret)/i, score: 6, factor: 'Sensitive file read' },
  { pattern: /\b(strings|xxd|od)\s+/, score: 4, factor: 'Binary file inspection' },
  { pattern: /\bfind\s+.*-exec\s+cat/, score: 7, factor: 'Find with cat exec' },
  { pattern: /\bfind\s+.*\|\s*xargs\s+(cat|head|tail)/, score: 7, factor: 'Find piped to reader' },
  { pattern: /\bxargs\s+(cat|head|tail|less)/, score: 6, factor: 'Xargs file read' },
  { pattern: /\bawk\s+.*\.(env|pem|key)/i, score: 6, factor: 'Awk sensitive file' },
  { pattern: /\bsed\s+.*\.(env|pem|key)/i, score: 5, factor: 'Sed sensitive file' },
]

const SAFE_COMMANDS: RiskPattern[] = [
  { pattern: /^ls(\s+-[la]+)?$/, score: 1, factor: 'Directory listing' },
  { pattern: /^pwd$/, score: 1, factor: 'Print directory' },
  { pattern: /^cd\s+/, score: 1, factor: 'Change directory' },
  { pattern: /^echo\s+/, score: 1, factor: 'Echo output' },
  { pattern: /^cat\s+[^\/]/, score: 2, factor: 'File read (relative)' },
  { pattern: /^git\s+(status|log|diff|branch)/, score: 1, factor: 'Git read operation' },
  { pattern: /^git\s+(add|commit|push|pull)/, score: 2, factor: 'Git write operation' },
  { pattern: /^npm\s+(list|show|view)/, score: 1, factor: 'NPM read operation' },
  { pattern: /^npm\s+(install|run|test)/, score: 2, factor: 'NPM write operation' },
  { pattern: /^node\s+--version/, score: 1, factor: 'Version check' },
  { pattern: /^python\s+--version/, score: 1, factor: 'Version check' },
]

const ALL_PATTERNS: RiskPattern[] = [
  ...SAFE_COMMANDS,
  ...INFO_GATHERING,
  ...PERSISTENCE,
  ...DATA_EXFIL,
  ...DESTRUCTIVE,
  ...PRIVILEGE_ESCALATION,
  ...EVASION,
  ...CONTAINER_ESCAPE,
  ...FILE_READERS,
]

export class RiskScorer {
  private customPatterns: RiskPattern[] = []

  /**
   * Score a command's risk level
   */
  score(command: string): RiskScore {
    const factors: string[] = []
    let maxScore = 1

    // Check all patterns
    const allPatterns = [...ALL_PATTERNS, ...this.customPatterns]

    for (const { pattern, score, factor } of allPatterns) {
      if (pattern.test(command)) {
        factors.push(factor)
        if (score > maxScore) {
          maxScore = score
        }
      }
    }

    // Additional heuristics
    const heuristicScore = this.applyHeuristics(command, factors)
    if (heuristicScore > maxScore) {
      maxScore = heuristicScore
    }

    // Determine level
    const level = this.scoreToLevel(maxScore)

    return {
      score: maxScore,
      level,
      factors: factors.length > 0 ? factors : ['Standard command']
    }
  }

  private applyHeuristics(command: string, factors: string[]): number {
    let score = 0

    // Long commands are suspicious
    if (command.length > 200) {
      factors.push('Unusually long command')
      score = Math.max(score, 4)
    }

    // Multiple pipes
    const pipeCount = (command.match(/\|/g) || []).length
    if (pipeCount > 3) {
      factors.push(`Complex pipeline (${pipeCount} pipes)`)
      score = Math.max(score, 5)
    }

    // Background execution with nohup
    if (/nohup.*&/.test(command)) {
      factors.push('Background persistent process')
      score = Math.max(score, 6)
    }

    // Encoded content
    if (/[A-Za-z0-9+/=]{50,}/.test(command)) {
      factors.push('Possible encoded payload')
      score = Math.max(score, 6)
    }

    // IP addresses (potential C2)
    if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(command)) {
      factors.push('Contains IP address')
      score = Math.max(score, 4)
    }

    // Hex escapes
    if (/\\x[0-9a-fA-F]{2}/.test(command)) {
      factors.push('Hex-encoded characters')
      score = Math.max(score, 5)
    }

    return score
  }

  private scoreToLevel(score: number): RiskScore['level'] {
    if (score <= 2) return 'safe'
    if (score <= 5) return 'caution'
    if (score <= 8) return 'dangerous'
    return 'critical'
  }

  /**
   * Add custom risk patterns
   */
  addPattern(pattern: RegExp, score: number, factor: string): void {
    this.customPatterns.push({ pattern, score, factor })
  }

  /**
   * Check if command should be blocked based on score threshold
   */
  shouldBlock(command: string, threshold: number = 8): boolean {
    return this.score(command).score >= threshold
  }

  /**
   * Get color for terminal display
   */
  static levelColor(level: RiskScore['level']): string {
    switch (level) {
      case 'safe': return 'green'
      case 'caution': return 'yellow'
      case 'dangerous': return 'red'
      case 'critical': return 'bgRed'
    }
  }
}
