import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Session-based allowlist for temporary command permissions.
 * Stored in a temp file that gets cleared on restart.
 */

const SESSION_FILE = join(homedir(), '.bashbros', 'session-allow.json')

interface SessionData {
  pid: number
  startTime: number
  allowedCommands: string[]
}

function ensureDir(): void {
  const dir = join(homedir(), '.bashbros')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function loadSession(): SessionData | null {
  try {
    if (!existsSync(SESSION_FILE)) {
      return null
    }

    const data = JSON.parse(readFileSync(SESSION_FILE, 'utf-8'))

    // Check if session is from current process
    if (data.pid !== process.pid) {
      // Different process - check if it's stale (older than 24 hours)
      const age = Date.now() - data.startTime
      if (age > 24 * 60 * 60 * 1000) {
        return null
      }
    }

    return data
  } catch {
    return null
  }
}

function saveSession(data: SessionData): void {
  ensureDir()
  writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
}

function getOrCreateSession(): SessionData {
  const existing = loadSession()

  if (existing) {
    return existing
  }

  const newSession: SessionData = {
    pid: process.pid,
    startTime: Date.now(),
    allowedCommands: []
  }

  saveSession(newSession)
  return newSession
}

/**
 * Add a command to the session allowlist
 */
export function allowForSession(command: string): void {
  const session = getOrCreateSession()

  if (!session.allowedCommands.includes(command)) {
    session.allowedCommands.push(command)
    saveSession(session)
  }
}

/**
 * Check if a command is allowed for this session
 */
export function isAllowedForSession(command: string): boolean {
  const session = loadSession()

  if (!session) {
    return false
  }

  // Check exact match
  if (session.allowedCommands.includes(command)) {
    return true
  }

  // Check pattern match (command starts with allowed pattern)
  for (const allowed of session.allowedCommands) {
    if (allowed.endsWith('*')) {
      const prefix = allowed.slice(0, -1)
      if (command.startsWith(prefix)) {
        return true
      }
    }
  }

  return false
}

/**
 * Get all commands allowed for this session
 */
export function getSessionAllowlist(): string[] {
  const session = loadSession()
  return session?.allowedCommands || []
}

/**
 * Clear the session allowlist
 */
export function clearSessionAllowlist(): void {
  const session = getOrCreateSession()
  session.allowedCommands = []
  saveSession(session)
}
