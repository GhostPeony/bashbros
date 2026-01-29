import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'

export interface CommandEntry {
  command: string
  output: string
  agent: string
  exitCode: number
  cwd: string
}

export interface ErrorEntry {
  command: string
  error: string
  agent: string
  resolved: boolean
}

export interface SessionSummary {
  id: string
  agent: string
  startTime: string
  endTime: string
  commandCount: number
  summary: string
}

export interface ContextIndex {
  lastUpdated: string
  agents: string[]
  sessionCount: number
  commandFileCount: number
  errorFileCount: number
}

export class ContextStore {
  private projectRoot: string
  private contextDir: string
  private memoryDir: string
  private artifactsDir: string

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
    this.contextDir = join(projectRoot, '.bashbros', 'context')
    this.memoryDir = join(this.contextDir, 'memory')
    this.artifactsDir = join(this.contextDir, 'artifacts')
  }

  initialize(): void {
    const dirs = [
      this.memoryDir,
      join(this.memoryDir, 'custom'),
      join(this.artifactsDir, 'sessions'),
      join(this.artifactsDir, 'commands'),
      join(this.artifactsDir, 'errors')
    ]
    for (const dir of dirs) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    }

    const starters: Record<string, string> = {
      'decisions.md': '# Decisions\n\nArchitectural decisions recorded during sessions.\n',
      'conventions.md': '# Conventions\n\nCoding patterns and style choices for this project.\n',
      'issues.md': '# Known Issues\n\nGotchas, workarounds, and known problems.\n'
    }
    for (const [file, content] of Object.entries(starters)) {
      const filePath = join(this.memoryDir, file)
      if (!existsSync(filePath)) writeFileSync(filePath, content)
    }

    const indexPath = join(this.contextDir, 'index.json')
    if (!existsSync(indexPath)) {
      writeFileSync(indexPath, JSON.stringify({
        lastUpdated: new Date().toISOString(),
        agents: [],
        sessionCount: 0,
        commandFileCount: 0,
        errorFileCount: 0
      }, null, 2))
    }
  }

  appendCommand(entry: CommandEntry): void {
    const today = new Date().toISOString().slice(0, 10)
    appendFileSync(
      join(this.artifactsDir, 'commands', `${today}.jsonl`),
      JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n'
    )
  }

  appendError(entry: ErrorEntry): void {
    const today = new Date().toISOString().slice(0, 10)
    appendFileSync(
      join(this.artifactsDir, 'errors', `${today}.jsonl`),
      JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n'
    )
  }

  writeSession(session: SessionSummary): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `${timestamp}-${session.agent}-${session.id.slice(-8)}.json`
    writeFileSync(
      join(this.artifactsDir, 'sessions', filename),
      JSON.stringify(session, null, 2)
    )
  }

  readMemory(name: string): string | null {
    const filePath = join(this.memoryDir, `${name}.md`)
    if (!existsSync(filePath)) return null
    return readFileSync(filePath, 'utf-8')
  }

  writeMemory(name: string, content: string): void {
    writeFileSync(join(this.memoryDir, `${name}.md`), content)
  }

  listMemoryFiles(): string[] {
    if (!existsSync(this.memoryDir)) return []
    return readdirSync(this.memoryDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
  }

  updateIndex(): void {
    const agents = new Set<string>()

    const sessionsDir = join(this.artifactsDir, 'sessions')
    if (existsSync(sessionsDir)) {
      for (const file of readdirSync(sessionsDir)) {
        try {
          const d = JSON.parse(readFileSync(join(sessionsDir, file), 'utf-8'))
          if (d.agent) agents.add(d.agent)
        } catch { /* ignore malformed files */ }
      }
    }

    const commandsDir = join(this.artifactsDir, 'commands')
    if (existsSync(commandsDir)) {
      for (const file of readdirSync(commandsDir)) {
        try {
          for (const line of readFileSync(join(commandsDir, file), 'utf-8').trim().split('\n')) {
            const d = JSON.parse(line)
            if (d.agent) agents.add(d.agent)
          }
        } catch { /* ignore malformed files */ }
      }
    }

    const sessionCount = existsSync(sessionsDir) ? readdirSync(sessionsDir).length : 0
    const commandFileCount = existsSync(commandsDir) ? readdirSync(commandsDir).length : 0
    const errorsDir = join(this.artifactsDir, 'errors')
    const errorFileCount = existsSync(errorsDir) ? readdirSync(errorsDir).length : 0

    writeFileSync(join(this.contextDir, 'index.json'), JSON.stringify({
      lastUpdated: new Date().toISOString(),
      agents: [...agents],
      sessionCount,
      commandFileCount,
      errorFileCount
    }, null, 2))
  }

  getIndex(): ContextIndex {
    const indexPath = join(this.contextDir, 'index.json')
    if (!existsSync(indexPath)) {
      return { lastUpdated: '', agents: [], sessionCount: 0, commandFileCount: 0, errorFileCount: 0 }
    }
    return JSON.parse(readFileSync(indexPath, 'utf-8'))
  }

  prune(retentionDays: number): void {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    for (const subdir of ['commands', 'errors']) {
      const dir = join(this.artifactsDir, subdir)
      if (!existsSync(dir)) continue
      for (const file of readdirSync(dir)) {
        const dateStr = file.replace('.jsonl', '')
        if (new Date(dateStr).getTime() < cutoff) {
          unlinkSync(join(dir, file))
        }
      }
    }
  }

  getContextDir(): string {
    return this.contextDir
  }
}
