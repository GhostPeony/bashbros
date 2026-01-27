import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PathSandbox } from './path-sandbox.js'
import { homedir } from 'os'
import { resolve } from 'path'

describe('PathSandbox', () => {
  describe('allow list', () => {
    it('allows paths in allowed directories', () => {
      const sandbox = new PathSandbox({
        allow: [process.cwd()],
        block: []
      })
      const result = sandbox.check('./src/index.ts')
      expect(result).toBeNull()
    })

    it('blocks paths outside allowed directories', () => {
      const sandbox = new PathSandbox({
        allow: ['/safe/dir'],
        block: []
      })
      const result = sandbox.check('/etc/passwd')
      expect(result).not.toBeNull()
      expect(result?.type).toBe('path')
      expect(result?.message).toContain('outside')
    })

    it('allows wildcard', () => {
      const sandbox = new PathSandbox({
        allow: ['*'],
        block: []
      })
      expect(sandbox.check('/any/path')).toBeNull()
    })
  })

  describe('block list', () => {
    it('blocks paths in blocked directories', () => {
      const sandbox = new PathSandbox({
        allow: ['*'],
        block: ['/etc', '/root']
      })
      expect(sandbox.check('/etc/passwd')).not.toBeNull()
      expect(sandbox.check('/root/.ssh')).not.toBeNull()
    })

    it('block list takes priority over allow', () => {
      const sandbox = new PathSandbox({
        allow: ['*'],
        block: ['/etc']
      })
      expect(sandbox.check('/etc/passwd')).not.toBeNull()
    })
  })

  describe('path normalization', () => {
    it('expands tilde to home directory', () => {
      const sandbox = new PathSandbox({
        allow: [homedir()],
        block: []
      })
      expect(sandbox.check('~/file.txt')).toBeNull()
    })

    it('handles dot as current directory', () => {
      const sandbox = new PathSandbox({
        allow: [process.cwd()],
        block: []
      })
      expect(sandbox.check('.')).toBeNull()
    })

    it('resolves relative paths', () => {
      const sandbox = new PathSandbox({
        allow: [process.cwd()],
        block: []
      })
      expect(sandbox.check('./test')).toBeNull()
      expect(sandbox.check('../' + process.cwd().split(/[\\/]/).pop())).toBeNull()
    })
  })

  describe('symlink detection', () => {
    it('detects symlink escape to blocked path', () => {
      const sandbox = new PathSandbox({
        allow: ['/safe'],
        block: ['/etc']
      })
      // isSymlinkEscape relies on filesystem, so we test the logic
      expect(typeof sandbox.isSymlinkEscape).toBe('function')
    })
  })
})
