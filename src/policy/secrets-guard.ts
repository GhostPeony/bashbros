import type { SecretsPolicy, PolicyViolation } from '../types.js'

export interface TextScanFinding {
  pattern: string
  redacted: string
  line: number
  severity: 'high' | 'critical'
}

export interface TextScanResult {
  clean: boolean
  findings: TextScanFinding[]
}

export class SecretsGuard {
  private patterns: RegExp[]

  private static readonly TEXT_PATTERNS: Array<{
    name: string
    regex: RegExp
    severity: 'high' | 'critical'
  }> = [
    { name: 'AWS Access Key', regex: /AKIA[0-9A-Z]{16}/g, severity: 'critical' },
    { name: 'AWS Secret Key', regex: /(?:aws_secret_access_key|secret_key)\s*[=:]\s*[A-Za-z0-9/+=]{40}/gi, severity: 'critical' },
    { name: 'GitHub Token', regex: /gh[ps]_[A-Za-z0-9_]{36,}/g, severity: 'critical' },
    { name: 'GitHub Fine-Grained Token', regex: /github_pat_[A-Za-z0-9_]{22,}/g, severity: 'critical' },
    { name: 'Generic API Key', regex: /(?:api_key|apikey|api-key)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/gi, severity: 'high' },
    { name: 'Private Key', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, severity: 'critical' },
    { name: 'Generic Secret', regex: /(?:secret|password|passwd|token)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/gi, severity: 'high' },
    { name: 'Slack Token', regex: /xox[bprs]-[0-9a-zA-Z-]{10,}/g, severity: 'critical' },
    { name: 'Stripe Key', regex: /[sr]k_(?:live|test)_[A-Za-z0-9]{24,}/g, severity: 'critical' },
  ]

  constructor(private policy: SecretsPolicy) {
    this.patterns = policy.patterns.map(p => this.globToRegex(p))
  }

  scanText(text: string): TextScanResult {
    if (!this.policy.enabled) {
      return { clean: true, findings: [] }
    }

    const lines = text.split('\n')
    const findings: TextScanFinding[] = []

    for (const patternDef of SecretsGuard.TEXT_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        const regex = new RegExp(patternDef.regex.source, patternDef.regex.flags)
        let match
        while ((match = regex.exec(lines[i])) !== null) {
          const matched = match[0]
          const redacted = matched.substring(0, 4) + '***' + matched.substring(matched.length - 2)
          findings.push({
            pattern: patternDef.name,
            redacted,
            line: i + 1,
            severity: patternDef.severity,
          })
        }
      }
    }

    return { clean: findings.length === 0, findings }
  }

  check(command: string, paths: string[]): PolicyViolation | null {
    if (!this.policy.enabled) {
      return null
    }

    // Check command for secret file access
    for (const path of paths) {
      if (this.isSecretPath(path)) {
        return {
          type: 'secrets',
          rule: `pattern match: ${path}`,
          message: `Blocked: command accesses ${path} (sensitive file)`,
          remediation: [
            'Risk: credential or secret exposure',
            `To allow: bashbros allow "${command.split(/\s+/)[0]} ${path}" --once`
          ],
          severity: 'critical'
        }
      }
    }

    // Check for common secret-leaking patterns in commands
    // SECURITY FIX: Enhanced patterns to catch bypass attempts
    const dangerousPatterns = [
      // Direct file access (multiple readers)
      /(cat|head|tail|less|more|bat)\s+.*\.env/i,
      /(cat|head|tail|less|more|bat)\s+.*\.pem/i,
      /(cat|head|tail|less|more|bat)\s+.*\.key/i,
      /(cat|head|tail|less|more|bat)\s+.*credentials/i,
      /(cat|head|tail|less|more|bat)\s+.*secret/i,
      /(cat|head|tail|less|more|bat)\s+.*password/i,
      /(cat|head|tail|less|more|bat)\s+.*token/i,

      // Python/Perl/Ruby file readers
      /python.*open\s*\(.*\.(env|pem|key)/i,
      /python.*-c.*open/i,
      /perl.*-[pne].*\.(env|pem|key)/i,
      /ruby.*-e.*File\.(read|open)/i,

      // Environment variable exposure
      /echo\s+\$\w*(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|API)/i,
      /printenv.*(KEY|SECRET|TOKEN|PASSWORD)/i,
      /env\s*\|\s*grep.*(KEY|SECRET|TOKEN|PASSWORD)/i,

      // Curl/wget with secrets
      /curl.*-d.*\$\w*(KEY|SECRET|TOKEN)/i,
      /curl.*-H.*Authorization/i,
      /wget.*--header.*Authorization/i,

      // Base64 encoding (obfuscation attempt)
      /base64.*\.env/i,
      /base64.*\.pem/i,
      /base64.*\.key/i,
      /base64\s+-d/i, // Decoding could reveal secrets

      // SECURITY FIX: Command substitution bypass attempts
      /cat\s+\$\(/i,     // cat $(...)
      /cat\s+`/i,        // cat `...`
      /cat\s+\$\{/i,     // cat ${...}

      // SECURITY FIX: Variable indirection
      /\w+=.*\.env.*;\s*cat\s+\$/i,  // VAR=.env; cat $VAR
      /\w+=.*secret.*;\s*cat\s+\$/i,

      // SECURITY FIX: Glob expansion bypass
      /cat\s+\*env/i,    // cat *env
      /cat\s+\.\*env/i,  // cat .*env
      /cat\s+\?\?env/i,  // cat ??env

      // SECURITY FIX: Printf/echo tricks
      /printf\s+.*\\x/i,   // Hex encoding
      /echo\s+-e.*\\x/i,   // Echo with hex
      /echo\s+-e.*\\[0-7]/i, // Octal encoding

      // SECURITY FIX: Here-doc/here-string
      /cat\s*<<.*\.env/i,
      /cat\s*<<<.*secret/i,

      // Process substitution
      /cat\s+<\(/i,      // cat <(...)

      // History/log access
      /cat.*\.bash_history/i,
      /cat.*\.zsh_history/i,
      /cat.*history/i,

      // AWS/cloud credentials
      /cat.*\.aws\/credentials/i,
      /cat.*\.aws\/config/i,
      /cat.*\.kube\/config/i,
      /cat.*\.docker\/config/i,

      // SSH keys
      /cat.*id_rsa/i,
      /cat.*id_ed25519/i,
      /cat.*id_ecdsa/i,
      /cat.*known_hosts/i,
      /cat.*authorized_keys/i,

      // GPG
      /cat.*\.gnupg/i,
      /gpg.*--export-secret/i,

      // Git credentials
      /cat.*\.git-credentials/i,
      /cat.*\.netrc/i,

      // Database files
      /cat.*\.pgpass/i,
      /cat.*\.my\.cnf/i,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          type: 'secrets',
          rule: 'dangerous pattern',
          message: 'Blocked: command may expose secrets',
          remediation: [
            'Risk: credential exposure via command pattern',
            'Review the command carefully before allowing'
          ],
          severity: 'high'
        }
      }
    }

    // SECURITY FIX: Check for encoded commands
    if (this.containsEncodedSecretAccess(command)) {
      return {
        type: 'secrets',
        rule: 'encoded command',
        message: 'Blocked: command contains encoded secret access attempt',
        remediation: [
          'Risk: obfuscated credential access detected',
          'This command appears to use encoding to bypass secret detection'
        ],
        severity: 'critical'
      }
    }

    return null
  }

  /**
   * SECURITY FIX: Detect base64/hex encoded secret access
   */
  private containsEncodedSecretAccess(command: string): boolean {
    // Check for base64 encoded sensitive paths
    const sensitiveBase64 = [
      'LmVudg==',      // .env
      'LnBlbQ==',      // .pem
      'LmtleQ==',      // .key
      'aWRfcnNh',      // id_rsa
      'Y3JlZGVudGlhbHM=', // credentials
      'c2VjcmV0',      // secret
    ]

    for (const encoded of sensitiveBase64) {
      if (command.includes(encoded)) {
        return true
      }
    }

    // Check for hex encoded paths
    const sensitiveHex = [
      '2e656e76',      // .env
      '2e70656d',      // .pem
      '2e6b6579',      // .key
      '69645f727361',  // id_rsa
    ]

    for (const hex of sensitiveHex) {
      if (command.toLowerCase().includes(hex)) {
        return true
      }
    }

    return false
  }

  private isSecretPath(path: string): boolean {
    const lowerPath = path.toLowerCase()

    return this.patterns.some(pattern => pattern.test(lowerPath))
  }

  private globToRegex(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')

    return new RegExp(escaped, 'i')
  }
}
