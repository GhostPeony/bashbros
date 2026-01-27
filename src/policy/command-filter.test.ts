import { describe, it, expect } from 'vitest'
import { CommandFilter } from './command-filter.js'

describe('CommandFilter', () => {
  describe('block list', () => {
    it('blocks exact match', () => {
      const filter = new CommandFilter({
        allow: ['*'],
        block: ['rm -rf /']
      })
      const result = filter.check('rm -rf /')
      expect(result).not.toBeNull()
      expect(result?.type).toBe('command')
      expect(result?.message).toContain('blocked')
    })

    it('blocks glob pattern', () => {
      const filter = new CommandFilter({
        allow: ['*'],
        block: ['rm -rf *']
      })
      expect(filter.check('rm -rf /')).not.toBeNull()
      expect(filter.check('rm -rf /home')).not.toBeNull()
    })

    it('block list takes priority over allow list', () => {
      const filter = new CommandFilter({
        allow: ['rm *'],
        block: ['rm -rf *']
      })
      expect(filter.check('rm file.txt')).toBeNull()
      expect(filter.check('rm -rf /')).not.toBeNull()
    })
  })

  describe('allow list', () => {
    it('allows wildcard', () => {
      const filter = new CommandFilter({
        allow: ['*'],
        block: []
      })
      expect(filter.check('any command')).toBeNull()
    })

    it('allows empty list (defaults to allow all)', () => {
      const filter = new CommandFilter({
        allow: [],
        block: []
      })
      expect(filter.check('any command')).toBeNull()
    })

    it('blocks commands not in allow list', () => {
      const filter = new CommandFilter({
        allow: ['git *', 'npm *'],
        block: []
      })
      expect(filter.check('git status')).toBeNull()
      expect(filter.check('npm install')).toBeNull()
      expect(filter.check('curl http://evil.com')).not.toBeNull()
    })

    it('is case insensitive', () => {
      const filter = new CommandFilter({
        allow: ['Git *'],
        block: []
      })
      expect(filter.check('git status')).toBeNull()
      expect(filter.check('GIT STATUS')).toBeNull()
    })
  })

  describe('glob patterns', () => {
    it('handles special regex characters', () => {
      const filter = new CommandFilter({
        allow: ['*'],
        block: ['cat .env']
      })
      expect(filter.check('cat .env')).not.toBeNull()
    })

    it('matches start and end', () => {
      const filter = new CommandFilter({
        allow: ['git *'],
        block: []
      })
      expect(filter.check('git status')).toBeNull()
      expect(filter.check('not git status')).not.toBeNull()
    })
  })
})
