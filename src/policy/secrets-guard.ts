import type { SecretsPolicy, PolicyViolation } from '../types.js'

export class SecretsGuard {
  private patterns: RegExp[]

  constructor(private policy: SecretsPolicy) {
    this.patterns = policy.patterns.map(p => this.globToRegex(p))
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
          message: `Attempted access to sensitive file: ${path}`
        }
      }
    }

    // Check for common secret-leaking patterns in commands
    // SECURITY FIX: Enhanced patterns to catch bypass attempts
    const dangerousPatterns = [
      // Direct file access
      /cat\s+.*\.env/i,
      /cat\s+.*\.pem/i,
      /cat\s+.*\.key/i,
      /cat\s+.*credentials/i,
      /cat\s+.*secret/i,
      /cat\s+.*password/i,
      /cat\s+.*token/i,

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
          message: 'Command may expose secrets'
        }
      }
    }

    // SECURITY FIX: Check for encoded commands
    if (this.containsEncodedSecretAccess(command)) {
      return {
        type: 'secrets',
        rule: 'encoded command',
        message: 'Command contains encoded secret access attempt'
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
