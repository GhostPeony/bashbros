import { resolve } from 'path'
import { homedir } from 'os'
import type { PathPolicy, PolicyViolation } from '../types.js'

export class PathSandbox {
  private allowedPaths: string[]
  private blockedPaths: string[]

  constructor(private policy: PathPolicy) {
    this.allowedPaths = policy.allow.map(p => this.normalizePath(p))
    this.blockedPaths = policy.block.map(p => this.normalizePath(p))
  }

  check(path: string): PolicyViolation | null {
    const normalizedPath = this.normalizePath(path)

    // Check block list first
    for (const blocked of this.blockedPaths) {
      if (normalizedPath.startsWith(blocked) || normalizedPath === blocked) {
        return {
          type: 'path',
          rule: `block: ${blocked}`,
          message: `Access to path is blocked: ${path}`
        }
      }
    }

    // If allow list contains '*' or '.', allow anything not blocked
    if (this.policy.allow.includes('*')) {
      return null
    }

    // Check if path is within allowed directories
    const allowed = this.allowedPaths.some(
      allowedPath =>
        normalizedPath.startsWith(allowedPath) || normalizedPath === allowedPath
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
}
