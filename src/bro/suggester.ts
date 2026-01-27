import type { SystemProfile } from './profiler.js'
import type { AuditEntry } from '../types.js'

export interface Suggestion {
  command: string
  description: string
  confidence: number
  source: 'pattern' | 'history' | 'context' | 'model'
}

export class CommandSuggester {
  private history: AuditEntry[] = []
  private profile: SystemProfile | null = null
  private patterns: Map<string, string[]> = new Map()

  constructor(profile: SystemProfile | null = null) {
    this.profile = profile
    this.initPatterns()
  }

  private initPatterns(): void {
    // Common command sequences
    this.patterns.set('git status', ['git add .', 'git diff', 'git stash'])
    this.patterns.set('git add', ['git commit -m ""', 'git status'])
    this.patterns.set('git commit', ['git push', 'git log --oneline -5'])
    this.patterns.set('git pull', ['git status', 'git log --oneline -5'])
    this.patterns.set('git checkout', ['git status', 'git branch'])

    this.patterns.set('npm install', ['npm run build', 'npm test', 'npm start'])
    this.patterns.set('npm test', ['npm run build', 'git add .'])
    this.patterns.set('npm run build', ['npm start', 'npm test'])

    this.patterns.set('pip install', ['pip freeze', 'python -m pytest'])
    this.patterns.set('pytest', ['git add .', 'python -m pytest -v'])

    this.patterns.set('docker build', ['docker run', 'docker images'])
    this.patterns.set('docker run', ['docker ps', 'docker logs'])

    this.patterns.set('cd', ['ls', 'ls -la', 'git status'])
    this.patterns.set('mkdir', ['cd', 'touch'])
    this.patterns.set('ls', ['cd', 'cat', 'vim'])
  }

  suggest(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = []

    // 1. Pattern-based suggestions
    if (context.lastCommand) {
      const patternSuggestions = this.suggestFromPatterns(context.lastCommand)
      suggestions.push(...patternSuggestions)
    }

    // 2. History-based suggestions
    const historySuggestions = this.suggestFromHistory(context)
    suggestions.push(...historySuggestions)

    // 3. Context-based suggestions
    const contextSuggestions = this.suggestFromContext(context)
    suggestions.push(...contextSuggestions)

    // Dedupe and sort by confidence
    const unique = this.dedupeAndRank(suggestions)

    return unique.slice(0, 5) // Top 5
  }

  private suggestFromPatterns(lastCommand: string): Suggestion[] {
    const suggestions: Suggestion[] = []

    // Find matching pattern key
    for (const [key, commands] of this.patterns) {
      if (lastCommand.startsWith(key)) {
        for (const cmd of commands) {
          suggestions.push({
            command: cmd,
            description: `Common follow-up to "${key}"`,
            confidence: 0.8,
            source: 'pattern'
          })
        }
        break
      }
    }

    return suggestions
  }

  private suggestFromHistory(context: SuggestionContext): Suggestion[] {
    if (this.history.length < 3) return []

    const suggestions: Suggestion[] = []

    // Find commands that often follow the current context
    const recentCommands = this.history.slice(-20)
    const following = new Map<string, number>()

    for (let i = 0; i < recentCommands.length - 1; i++) {
      const current = recentCommands[i].command
      const next = recentCommands[i + 1].command

      if (context.lastCommand && current.startsWith(context.lastCommand.split(' ')[0])) {
        const count = following.get(next) || 0
        following.set(next, count + 1)
      }
    }

    // Convert to suggestions
    for (const [cmd, count] of following) {
      if (count >= 2) {
        suggestions.push({
          command: cmd,
          description: 'Based on your history',
          confidence: Math.min(0.9, 0.5 + count * 0.1),
          source: 'history'
        })
      }
    }

    return suggestions
  }

  private suggestFromContext(context: SuggestionContext): Suggestion[] {
    const suggestions: Suggestion[] = []

    // Project-type specific suggestions
    if (context.projectType === 'node' && context.cwd) {
      if (context.files?.includes('package.json')) {
        suggestions.push({
          command: 'npm install',
          description: 'Install dependencies',
          confidence: 0.7,
          source: 'context'
        })
      }
    }

    if (context.projectType === 'python' && context.cwd) {
      if (context.files?.includes('requirements.txt')) {
        suggestions.push({
          command: 'pip install -r requirements.txt',
          description: 'Install dependencies',
          confidence: 0.7,
          source: 'context'
        })
      }
    }

    // Error-based suggestions
    if (context.lastError) {
      if (context.lastError.includes('ModuleNotFoundError')) {
        const match = context.lastError.match(/No module named '(\w+)'/)
        if (match) {
          suggestions.push({
            command: `pip install ${match[1]}`,
            description: `Install missing module`,
            confidence: 0.9,
            source: 'context'
          })
        }
      }

      if (context.lastError.includes('Cannot find module')) {
        suggestions.push({
          command: 'npm install',
          description: 'Install missing dependencies',
          confidence: 0.85,
          source: 'context'
        })
      }
    }

    return suggestions
  }

  private dedupeAndRank(suggestions: Suggestion[]): Suggestion[] {
    const seen = new Set<string>()
    const unique: Suggestion[] = []

    // Sort by confidence first
    suggestions.sort((a, b) => b.confidence - a.confidence)

    for (const s of suggestions) {
      if (!seen.has(s.command)) {
        seen.add(s.command)
        unique.push(s)
      }
    }

    return unique
  }

  recordCommand(entry: AuditEntry): void {
    this.history.push(entry)
    // Keep last 100 commands
    if (this.history.length > 100) {
      this.history = this.history.slice(-100)
    }
  }

  updateProfile(profile: SystemProfile): void {
    this.profile = profile
  }
}

export interface SuggestionContext {
  lastCommand?: string
  lastOutput?: string
  lastError?: string
  cwd?: string
  projectType?: string
  files?: string[]
}
