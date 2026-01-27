/**
 * Undo Stack
 * Track file changes for rollback capability
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname, basename } from 'path'
import { homedir } from 'os'

export interface UndoEntry {
  id: string
  timestamp: Date
  path: string
  operation: 'create' | 'modify' | 'delete'
  backupPath?: string
  originalContent?: string
  command?: string
}

export interface UndoResult {
  success: boolean
  message: string
  entry?: UndoEntry
}

const UNDO_DIR = join(homedir(), '.bashbros', 'undo')
const MAX_STACK_SIZE = 100
const MAX_FILE_SIZE = 10 * 1024 * 1024  // 10MB max for backup

export class UndoStack {
  private stack: UndoEntry[] = []
  private sessionId: string

  constructor() {
    this.sessionId = Date.now().toString(36)
    this.ensureUndoDir()
  }

  private ensureUndoDir(): void {
    if (!existsSync(UNDO_DIR)) {
      mkdirSync(UNDO_DIR, { recursive: true, mode: 0o700 })
    }
  }

  private generateId(): string {
    return `${this.sessionId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }

  /**
   * Record a file creation
   */
  recordCreate(path: string, command?: string): UndoEntry {
    const entry: UndoEntry = {
      id: this.generateId(),
      timestamp: new Date(),
      path,
      operation: 'create',
      command
    }

    this.push(entry)
    return entry
  }

  /**
   * Record a file modification (backs up original)
   */
  recordModify(path: string, command?: string): UndoEntry | null {
    if (!existsSync(path)) {
      return null
    }

    // Check file size
    const stats = require('fs').statSync(path)
    if (stats.size > MAX_FILE_SIZE) {
      // Too large, just record without backup
      const entry: UndoEntry = {
        id: this.generateId(),
        timestamp: new Date(),
        path,
        operation: 'modify',
        command
      }
      this.push(entry)
      return entry
    }

    // Create backup
    const id = this.generateId()
    const backupPath = join(UNDO_DIR, `${id}.backup`)

    try {
      copyFileSync(path, backupPath)

      const entry: UndoEntry = {
        id,
        timestamp: new Date(),
        path,
        operation: 'modify',
        backupPath,
        command
      }

      this.push(entry)
      return entry
    } catch {
      return null
    }
  }

  /**
   * Record a file deletion (backs up content)
   */
  recordDelete(path: string, command?: string): UndoEntry | null {
    if (!existsSync(path)) {
      return null
    }

    const stats = require('fs').statSync(path)
    if (stats.size > MAX_FILE_SIZE) {
      // Too large, just record without backup
      const entry: UndoEntry = {
        id: this.generateId(),
        timestamp: new Date(),
        path,
        operation: 'delete',
        command
      }
      this.push(entry)
      return entry
    }

    // Create backup
    const id = this.generateId()
    const backupPath = join(UNDO_DIR, `${id}.backup`)

    try {
      copyFileSync(path, backupPath)

      const entry: UndoEntry = {
        id,
        timestamp: new Date(),
        path,
        operation: 'delete',
        backupPath,
        command
      }

      this.push(entry)
      return entry
    } catch {
      return null
    }
  }

  /**
   * Auto-detect operation from command
   */
  recordFromCommand(command: string, paths: string[]): UndoEntry[] {
    const entries: UndoEntry[] = []

    // Detect operation type
    const isCreate = /^(touch|mkdir|cp|mv|>|>>)/.test(command) ||
                     /^(echo|cat|printf).*>/.test(command)
    const isDelete = /^rm\s/.test(command)
    const isModify = /^(sed|awk|vim|vi|nano|code)\s/.test(command) ||
                     /^(echo|cat).*>>/.test(command)

    for (const path of paths) {
      let entry: UndoEntry | null = null

      if (isDelete && existsSync(path)) {
        entry = this.recordDelete(path, command)
      } else if (isModify && existsSync(path)) {
        entry = this.recordModify(path, command)
      } else if (isCreate && !existsSync(path)) {
        entry = this.recordCreate(path, command)
      }

      if (entry) {
        entries.push(entry)
      }
    }

    return entries
  }

  /**
   * Undo the last operation
   */
  undo(): UndoResult {
    const entry = this.stack.pop()

    if (!entry) {
      return { success: false, message: 'Nothing to undo' }
    }

    return this.undoEntry(entry)
  }

  /**
   * Undo a specific entry
   */
  undoEntry(entry: UndoEntry): UndoResult {
    try {
      switch (entry.operation) {
        case 'create':
          // Undo create = delete the file
          if (existsSync(entry.path)) {
            unlinkSync(entry.path)
            return {
              success: true,
              message: `Deleted created file: ${entry.path}`,
              entry
            }
          }
          return {
            success: false,
            message: `File already deleted: ${entry.path}`,
            entry
          }

        case 'modify':
          // Undo modify = restore from backup
          if (entry.backupPath && existsSync(entry.backupPath)) {
            copyFileSync(entry.backupPath, entry.path)
            return {
              success: true,
              message: `Restored: ${entry.path}`,
              entry
            }
          }
          return {
            success: false,
            message: `No backup available for: ${entry.path}`,
            entry
          }

        case 'delete':
          // Undo delete = restore from backup
          if (entry.backupPath && existsSync(entry.backupPath)) {
            // Ensure directory exists
            const dir = dirname(entry.path)
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true })
            }
            copyFileSync(entry.backupPath, entry.path)
            return {
              success: true,
              message: `Restored deleted file: ${entry.path}`,
              entry
            }
          }
          return {
            success: false,
            message: `No backup available for: ${entry.path}`,
            entry
          }

        default:
          return {
            success: false,
            message: `Unknown operation: ${entry.operation}`,
            entry
          }
      }
    } catch (error: any) {
      return {
        success: false,
        message: `Undo failed: ${error.message}`,
        entry
      }
    }
  }

  /**
   * Undo all operations in the session
   */
  undoAll(): UndoResult[] {
    const results: UndoResult[] = []

    while (this.stack.length > 0) {
      results.push(this.undo())
    }

    return results
  }

  /**
   * Get the undo stack
   */
  getStack(): UndoEntry[] {
    return [...this.stack]
  }

  /**
   * Get stack size
   */
  size(): number {
    return this.stack.length
  }

  /**
   * Clear the stack (and backups)
   */
  clear(): void {
    // Delete backup files
    for (const entry of this.stack) {
      if (entry.backupPath && existsSync(entry.backupPath)) {
        try {
          unlinkSync(entry.backupPath)
        } catch { /* ignore */ }
      }
    }

    this.stack = []
  }

  /**
   * Push entry to stack
   */
  private push(entry: UndoEntry): void {
    this.stack.push(entry)

    // Limit stack size
    if (this.stack.length > MAX_STACK_SIZE) {
      const removed = this.stack.shift()
      // Clean up backup
      if (removed?.backupPath && existsSync(removed.backupPath)) {
        try {
          unlinkSync(removed.backupPath)
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Format stack for display
   */
  formatStack(): string {
    if (this.stack.length === 0) {
      return 'Undo stack is empty'
    }

    const lines: string[] = ['Undo Stack:', '']

    for (let i = this.stack.length - 1; i >= 0; i--) {
      const entry = this.stack[i]
      const hasBackup = entry.backupPath ? '✓' : '✗'
      const time = entry.timestamp.toLocaleTimeString()
      const op = entry.operation.padEnd(6)

      lines.push(`${i + 1}. [${time}] ${op} ${entry.path} (backup: ${hasBackup})`)
      if (entry.command) {
        lines.push(`   └─ ${entry.command.slice(0, 60)}...`)
      }
    }

    return lines.join('\n')
  }
}
