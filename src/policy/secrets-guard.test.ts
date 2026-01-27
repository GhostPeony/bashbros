import { describe, it, expect } from 'vitest'
import { SecretsGuard } from './secrets-guard.js'

describe('SecretsGuard', () => {
  const defaultPolicy = {
    enabled: true,
    mode: 'block' as const,
    patterns: ['*.env', '*.pem', '*.key', 'id_rsa*', 'credentials*']
  }

  describe('enabled/disabled', () => {
    it('allows all when disabled', () => {
      const guard = new SecretsGuard({ ...defaultPolicy, enabled: false })
      expect(guard.check('cat .env', ['.env'])).toBeNull()
    })

    it('checks when enabled', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat .env', ['.env'])).not.toBeNull()
    })
  })

  describe('path patterns', () => {
    it('blocks .env files', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat .env', ['.env'])).not.toBeNull()
      expect(guard.check('cat .env.local', ['.env.local'])).not.toBeNull()
    })

    it('blocks key files', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat server.pem', ['server.pem'])).not.toBeNull()
      expect(guard.check('cat private.key', ['private.key'])).not.toBeNull()
    })

    it('blocks SSH keys', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat id_rsa', ['id_rsa'])).not.toBeNull()
      expect(guard.check('cat id_rsa.pub', ['id_rsa.pub'])).not.toBeNull()
    })

    it('blocks credentials files', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat credentials.json', ['credentials.json'])).not.toBeNull()
    })
  })

  describe('dangerous command patterns', () => {
    it('blocks cat .env', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat .env', [])).not.toBeNull()
    })

    it('blocks echo of secret env vars', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('echo $API_KEY', [])).not.toBeNull()
      expect(guard.check('echo $SECRET_TOKEN', [])).not.toBeNull()
      expect(guard.check('echo $PASSWORD', [])).not.toBeNull()
    })

    it('blocks printenv filtering secrets', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('printenv | grep KEY', [])).not.toBeNull()
      expect(guard.check('printenv SECRET', [])).not.toBeNull()
    })

    it('blocks curl with secrets', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('curl -H "Authorization: Bearer token"', [])).not.toBeNull()
    })

    it('blocks base64 of secrets', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('base64 .env', [])).not.toBeNull()
      expect(guard.check('base64 server.pem', [])).not.toBeNull()
    })
  })

  describe('bypass prevention', () => {
    it('blocks command substitution', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat $(echo .env)', [])).not.toBeNull()
      expect(guard.check('cat `echo file`', [])).not.toBeNull()
      expect(guard.check('cat ${FILE}', [])).not.toBeNull()
    })

    it('blocks variable indirection', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('FILE=.env; cat $FILE', [])).not.toBeNull()
    })

    it('blocks glob expansion', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat *env', [])).not.toBeNull()
      expect(guard.check('cat .*env', [])).not.toBeNull()
    })

    it('blocks hex/printf tricks', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('printf "%s" \\x2e\\x65\\x6e\\x76', [])).not.toBeNull()
      expect(guard.check('echo -e "\\x2e"', [])).not.toBeNull()
    })

    it('blocks here-doc', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat <<EOF .env', [])).not.toBeNull()
    })

    it('blocks process substitution', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat <(ls)', [])).not.toBeNull()
    })
  })

  describe('encoded secrets detection', () => {
    it('blocks base64 encoded paths', () => {
      const guard = new SecretsGuard(defaultPolicy)
      // "LmVudg==" is base64 for ".env"
      expect(guard.check('echo LmVudg== | base64 -d', [])).not.toBeNull()
      // "aWRfcnNh" is base64 for "id_rsa"
      expect(guard.check('echo aWRfcnNh | base64 -d', [])).not.toBeNull()
    })

    it('blocks hex encoded paths', () => {
      const guard = new SecretsGuard(defaultPolicy)
      // "2e656e76" is hex for ".env"
      expect(guard.check('echo 2e656e76 | xxd -r -p', [])).not.toBeNull()
    })
  })

  describe('cloud credentials', () => {
    it('blocks AWS credentials', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.aws/credentials', [])).not.toBeNull()
      expect(guard.check('cat ~/.aws/config', [])).not.toBeNull()
    })

    it('blocks kube config', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.kube/config', [])).not.toBeNull()
    })

    it('blocks docker config', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.docker/config', [])).not.toBeNull()
    })
  })

  describe('git credentials', () => {
    it('blocks git-credentials', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.git-credentials', [])).not.toBeNull()
    })

    it('blocks netrc', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.netrc', [])).not.toBeNull()
    })
  })

  describe('SSH keys', () => {
    it('blocks common SSH key files', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.ssh/id_rsa', [])).not.toBeNull()
      expect(guard.check('cat ~/.ssh/id_ed25519', [])).not.toBeNull()
      expect(guard.check('cat ~/.ssh/id_ecdsa', [])).not.toBeNull()
    })

    it('blocks known_hosts and authorized_keys', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.ssh/known_hosts', [])).not.toBeNull()
      expect(guard.check('cat ~/.ssh/authorized_keys', [])).not.toBeNull()
    })
  })

  describe('history files', () => {
    it('blocks shell history', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.bash_history', [])).not.toBeNull()
      expect(guard.check('cat ~/.zsh_history', [])).not.toBeNull()
    })
  })

  describe('database credentials', () => {
    it('blocks postgres password file', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.pgpass', [])).not.toBeNull()
    })

    it('blocks mysql config', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.my.cnf', [])).not.toBeNull()
    })
  })

  describe('GPG', () => {
    it('blocks GPG directory', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat ~/.gnupg/secring.gpg', [])).not.toBeNull()
    })

    it('blocks secret key export', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('gpg --export-secret-keys', [])).not.toBeNull()
    })
  })

  describe('safe commands', () => {
    it('allows normal file operations', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('cat README.md', ['README.md'])).toBeNull()
      expect(guard.check('ls -la', [])).toBeNull()
      expect(guard.check('git status', [])).toBeNull()
    })

    it('allows echo of normal vars', () => {
      const guard = new SecretsGuard(defaultPolicy)
      expect(guard.check('echo $HOME', [])).toBeNull()
      expect(guard.check('echo $PATH', [])).toBeNull()
    })
  })
})
