import { resolve } from 'path'
import { homedir } from 'os'
import { realpathSync, lstatSync, existsSync } from 'fs'
import type { PathPolicy, PolicyViolation } from '../types.js'

export class PathSandbox {
  private allowedPaths: string[]
  private blockedPaths: string[]

  constructor(private policy: PathPolicy) {
    this.allowedPaths = policy.allow.map(p => this.normalizePath(p))
    this.blockedPaths = policy.block.map(p => this.normalizePath(p))
  }

  check(path: string): PolicyViolation | null {
    // SECURITY: Resolve symlinks to get real path
    const { realPath, isSymlink } = this.resolvePath(path)

    // Check for symlink attacks
    if (isSymlink) {
      const originalNormalized = this.normalizePath(path)
      // If symlink points outside of where it appears to be, block it
      if (!realPath.startsWith(originalNormalized.split('/')[0])) {
        return {
          type: 'path',
          rule: 'symlink_escape',
          message: `Symlink escape detected: ${path} -> ${realPath}`
        }
      }
    }

    // Check block list first (use real path)
    for (const blocked of this.blockedPaths) {
      if (realPath.startsWith(blocked) || realPath === blocked) {
        return {
          type: 'path',
          rule: `block: ${blocked}`,
          message: `Access to path is blocked: ${path}`
        }
      }
    }

    // If allow list contains '*', allow anything not blocked
    if (this.policy.allow.includes('*')) {
      return null
    }

    // Check if real path is within allowed directories
    const allowed = this.allowedPaths.some(
      allowedPath =>
        realPath.startsWith(allowedPath) || realPath === allowedPath
    )

    if (!allowed) {
      return {
        type: 'path',
        rule: 'allow (outside sandbox)',
        message: `Path is outside allowed directories: ${path}`
      }
    }

    return null
  }

  /**
   * SECURITY FIX: Resolve symlinks to detect escape attempts
   */
  private resolvePath(path: string): { realPath: string; isSymlink: boolean } {
    const normalizedPath = this.normalizePath(path)

    try {
      // Check if path exists and is a symlink
      if (existsSync(normalizedPath)) {
        const stats = lstatSync(normalizedPath)
        const isSymlink = stats.isSymbolicLink()

        // Get real path (follows symlinks)
        const realPath = realpathSync(normalizedPath)

        return { realPath, isSymlink }
      }
    } catch {
      // Path doesn't exist yet or can't be accessed
    }

    return { realPath: normalizedPath, isSymlink: false }
  }

  private normalizePath(path: string): string {
    // Expand ~ to home directory
    if (path.startsWith('~')) {
      path = path.replace('~', homedir())
    }

    // Handle . as current directory
    if (path === '.') {
      return process.cwd()
    }

    return resolve(path)
  }

  /**
   * Check if a path would escape the sandbox via symlink
   */
  isSymlinkEscape(path: string): boolean {
    const { realPath, isSymlink } = this.resolvePath(path)

    if (!isSymlink) return false

    // Check if real path is in blocked list
    for (const blocked of this.blockedPaths) {
      if (realPath.startsWith(blocked)) {
        return true
      }
    }

    // Check if real path escapes allowed directories
    if (!this.policy.allow.includes('*')) {
      const inAllowed = this.allowedPaths.some(
        allowedPath => realPath.startsWith(allowedPath)
      )
      if (!inAllowed) {
        return true
      }
    }

    return false
  }
}
