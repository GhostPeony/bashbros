import { describe, it, expect } from 'vitest'
import { CommandSuggester } from './suggester.js'

describe('CommandSuggester', () => {
  describe('pattern-based suggestions', () => {
    it('suggests follow-ups for git status', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'git status'
      })

      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions.some(s => s.command.includes('git add'))).toBe(true)
    })

    it('suggests follow-ups for git add', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'git add .'
      })

      expect(suggestions.some(s => s.command.includes('git commit'))).toBe(true)
    })

    it('suggests follow-ups for git commit', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'git commit -m "test"'
      })

      expect(suggestions.some(s => s.command.includes('git push'))).toBe(true)
    })

    it('suggests follow-ups for npm install', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'npm install'
      })

      expect(suggestions.some(s =>
        s.command.includes('npm run') || s.command.includes('npm test')
      )).toBe(true)
    })

    it('suggests follow-ups for cd', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'cd project'
      })

      expect(suggestions.some(s => s.command === 'ls' || s.command === 'ls -la')).toBe(true)
    })

    it('returns pattern source for pattern matches', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'git status'
      })

      expect(suggestions.some(s => s.source === 'pattern')).toBe(true)
    })
  })

  describe('context-based suggestions', () => {
    it('suggests npm install for node projects with package.json', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        projectType: 'node',
        cwd: '/project',
        files: ['package.json']
      })

      expect(suggestions.some(s => s.command === 'npm install')).toBe(true)
    })

    it('suggests pip install for python projects with requirements.txt', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        projectType: 'python',
        cwd: '/project',
        files: ['requirements.txt']
      })

      expect(suggestions.some(s => s.command.includes('pip install'))).toBe(true)
    })

    it('suggests pip install for ModuleNotFoundError', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastError: "ModuleNotFoundError: No module named 'requests'"
      })

      expect(suggestions.some(s => s.command === 'pip install requests')).toBe(true)
    })

    it('suggests npm install for Cannot find module', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastError: "Error: Cannot find module 'lodash'"
      })

      expect(suggestions.some(s => s.command === 'npm install')).toBe(true)
    })
  })

  describe('history-based suggestions', () => {
    it('requires at least 3 history entries', () => {
      const suggester = new CommandSuggester()
      suggester.recordCommand({
        timestamp: new Date(),
        command: 'git status',
        allowed: true,
        violations: [],
        duration: 100,
        agent: 'claude-code'
      })

      const suggestions = suggester.suggest({
        lastCommand: 'git status'
      })

      // Should only have pattern suggestions, not history
      expect(suggestions.every(s => s.source !== 'history')).toBe(true)
    })

    it('suggests based on command sequences in history', () => {
      const suggester = new CommandSuggester()

      // Build up history
      for (let i = 0; i < 5; i++) {
        suggester.recordCommand({
          timestamp: new Date(),
          command: 'ls',
          allowed: true,
          violations: [],
          duration: 100,
          agent: 'claude-code'
        })
        suggester.recordCommand({
          timestamp: new Date(),
          command: 'cd src',
          allowed: true,
          violations: [],
          duration: 100,
          agent: 'claude-code'
        })
      }

      const suggestions = suggester.suggest({
        lastCommand: 'ls'
      })

      expect(suggestions.some(s => s.source === 'history')).toBe(true)
    })
  })

  describe('deduplication and ranking', () => {
    it('deduplicates suggestions', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'git status',
        projectType: 'node',
        cwd: '/project'
      })

      const commands = suggestions.map(s => s.command)
      const unique = new Set(commands)
      expect(commands.length).toBe(unique.size)
    })

    it('sorts by confidence descending', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'git status'
      })

      for (let i = 1; i < suggestions.length; i++) {
        expect(suggestions[i].confidence).toBeLessThanOrEqual(suggestions[i - 1].confidence)
      }
    })

    it('limits to 5 suggestions', () => {
      const suggester = new CommandSuggester()
      const suggestions = suggester.suggest({
        lastCommand: 'git status'
      })

      expect(suggestions.length).toBeLessThanOrEqual(5)
    })
  })

  describe('recordCommand', () => {
    it('records commands to history', () => {
      const suggester = new CommandSuggester()
      suggester.recordCommand({
        timestamp: new Date(),
        command: 'git status',
        allowed: true,
        violations: [],
        duration: 100,
        agent: 'claude-code'
      })

      // History is internal, but we can verify by the behavior
      // After recording 3+ entries, history suggestions should appear
    })

    it('keeps last 100 commands', () => {
      const suggester = new CommandSuggester()

      for (let i = 0; i < 110; i++) {
        suggester.recordCommand({
          timestamp: new Date(),
          command: `command-${i}`,
          allowed: true,
          violations: [],
          duration: 100,
          agent: 'claude-code'
        })
      }

      // Should not throw, internal state should be limited
      expect(() => suggester.suggest({ lastCommand: 'git status' })).not.toThrow()
    })
  })

  describe('updateProfile', () => {
    it('accepts profile update', () => {
      const suggester = new CommandSuggester()
      expect(() => suggester.updateProfile({
        platform: 'linux',
        arch: 'x64',
        shell: 'bash',
        timestamp: new Date().toISOString()
      })).not.toThrow()
    })
  })
})
