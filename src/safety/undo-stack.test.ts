import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { UndoStack } from './undo-stack.js'
import { existsSync, writeFileSync, unlinkSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('UndoStack', () => {
  let stack: UndoStack
  let testDir: string

  beforeEach(() => {
    stack = new UndoStack()
    testDir = join(tmpdir(), `undo-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    stack.clear()
    // Clean up test directory
    try {
      const files = require('fs').readdirSync(testDir)
      for (const file of files) {
        unlinkSync(join(testDir, file))
      }
      require('fs').rmdirSync(testDir)
    } catch { /* ignore */ }
  })

  describe('recordCreate', () => {
    it('records file creation', () => {
      const entry = stack.recordCreate('/test/file.txt', 'touch /test/file.txt')

      expect(entry.operation).toBe('create')
      expect(entry.path).toBe('/test/file.txt')
      expect(entry.command).toBe('touch /test/file.txt')
      expect(entry.id).toBeTruthy()
    })

    it('adds to stack', () => {
      stack.recordCreate('/test/file.txt')
      expect(stack.size()).toBe(1)
    })
  })

  describe('recordModify', () => {
    it('records file modification with backup', () => {
      const testFile = join(testDir, 'modify-test.txt')
      writeFileSync(testFile, 'original content')

      const entry = stack.recordModify(testFile, 'echo new > file')

      expect(entry).not.toBeNull()
      expect(entry?.operation).toBe('modify')
      expect(entry?.backupPath).toBeTruthy()
      expect(existsSync(entry!.backupPath!)).toBe(true)
    })

    it('returns null for non-existent file', () => {
      const entry = stack.recordModify('/nonexistent/file.txt')
      expect(entry).toBeNull()
    })
  })

  describe('recordDelete', () => {
    it('records file deletion with backup', () => {
      const testFile = join(testDir, 'delete-test.txt')
      writeFileSync(testFile, 'content to backup')

      const entry = stack.recordDelete(testFile, 'rm file')

      expect(entry).not.toBeNull()
      expect(entry?.operation).toBe('delete')
      expect(entry?.backupPath).toBeTruthy()
    })

    it('returns null for non-existent file', () => {
      const entry = stack.recordDelete('/nonexistent/file.txt')
      expect(entry).toBeNull()
    })
  })

  describe('undo', () => {
    it('undoes create by deleting file', () => {
      const testFile = join(testDir, 'created.txt')
      writeFileSync(testFile, 'new file')

      stack.recordCreate(testFile)
      const result = stack.undo()

      expect(result.success).toBe(true)
      expect(existsSync(testFile)).toBe(false)
    })

    it('undoes modify by restoring backup', () => {
      const testFile = join(testDir, 'modified.txt')
      writeFileSync(testFile, 'original')

      stack.recordModify(testFile)
      writeFileSync(testFile, 'changed')

      const result = stack.undo()

      expect(result.success).toBe(true)
      expect(readFileSync(testFile, 'utf-8')).toBe('original')
    })

    it('undoes delete by restoring backup', () => {
      const testFile = join(testDir, 'deleted.txt')
      writeFileSync(testFile, 'to be restored')

      stack.recordDelete(testFile)
      unlinkSync(testFile)

      const result = stack.undo()

      expect(result.success).toBe(true)
      expect(existsSync(testFile)).toBe(true)
      expect(readFileSync(testFile, 'utf-8')).toBe('to be restored')
    })

    it('returns failure for empty stack', () => {
      const result = stack.undo()
      expect(result.success).toBe(false)
      expect(result.message).toBe('Nothing to undo')
    })
  })

  describe('undoAll', () => {
    it('undoes all operations', () => {
      const file1 = join(testDir, 'file1.txt')
      const file2 = join(testDir, 'file2.txt')

      writeFileSync(file1, 'content1')
      writeFileSync(file2, 'content2')

      stack.recordCreate(file1)
      stack.recordCreate(file2)

      const results = stack.undoAll()

      expect(results).toHaveLength(2)
      expect(results.every(r => r.success)).toBe(true)
      expect(stack.size()).toBe(0)
    })
  })

  describe('recordFromCommand', () => {
    it('detects delete operations', () => {
      const testFile = join(testDir, 'to-delete.txt')
      writeFileSync(testFile, 'content')

      const entries = stack.recordFromCommand('rm file.txt', [testFile])

      expect(entries).toHaveLength(1)
      expect(entries[0].operation).toBe('delete')
    })

    it('detects create operations', () => {
      const testFile = join(testDir, 'new-file.txt')

      const entries = stack.recordFromCommand('touch file.txt', [testFile])

      expect(entries).toHaveLength(1)
      expect(entries[0].operation).toBe('create')
    })

    it('detects modify operations', () => {
      const testFile = join(testDir, 'to-modify.txt')
      writeFileSync(testFile, 'original')

      const entries = stack.recordFromCommand('sed -i "s/a/b/g" file.txt', [testFile])

      expect(entries).toHaveLength(1)
      expect(entries[0].operation).toBe('modify')
    })
  })

  describe('stack management', () => {
    it('limits stack size', () => {
      // Record more than max (100)
      for (let i = 0; i < 110; i++) {
        stack.recordCreate(`/test/file${i}.txt`)
      }

      expect(stack.size()).toBe(100)
    })

    it('clears stack and backups', () => {
      const testFile = join(testDir, 'backup-test.txt')
      writeFileSync(testFile, 'content')

      const entry = stack.recordModify(testFile)
      const backupPath = entry?.backupPath

      stack.clear()

      expect(stack.size()).toBe(0)
      if (backupPath) {
        expect(existsSync(backupPath)).toBe(false)
      }
    })
  })

  describe('getStack', () => {
    it('returns copy of stack', () => {
      stack.recordCreate('/test/file.txt')
      const stackCopy = stack.getStack()

      expect(stackCopy).toHaveLength(1)
      stackCopy.pop()  // Modify copy
      expect(stack.size()).toBe(1)  // Original unchanged
    })
  })

  describe('formatStack', () => {
    it('formats empty stack', () => {
      expect(stack.formatStack()).toBe('Undo stack is empty')
    })

    it('formats stack with entries', () => {
      stack.recordCreate('/test/file.txt', 'touch file.txt')
      const formatted = stack.formatStack()

      expect(formatted).toContain('Undo Stack')
      expect(formatted).toContain('create')
      expect(formatted).toContain('/test/file.txt')
    })
  })
})
