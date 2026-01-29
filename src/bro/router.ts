import type { SystemProfile } from './profiler.js'
import type { OllamaClient } from './ollama.js'

export type RouteDecision = 'bro' | 'main' | 'both'

export interface RoutingRule {
  pattern: RegExp
  route: RouteDecision
  reason: string
}

export interface RoutingResult {
  decision: RouteDecision
  reason: string
  confidence: number
}

export class TaskRouter {
  private rules: RoutingRule[]
  private profile: SystemProfile | null
  private ollama: OllamaClient | null

  constructor(profile: SystemProfile | null = null, ollama: OllamaClient | null = null) {
    this.profile = profile
    this.ollama = ollama
    this.rules = this.buildDefaultRules()
  }

  private buildDefaultRules(): RoutingRule[] {
    return [
      // Simple file operations → Bash Bro
      { pattern: /^ls\b/, route: 'bro', reason: 'Simple file listing' },
      { pattern: /^cat\s+\S+$/, route: 'bro', reason: 'Simple file read' },
      { pattern: /^head\b/, route: 'bro', reason: 'File head' },
      { pattern: /^tail\b/, route: 'bro', reason: 'File tail' },
      { pattern: /^wc\b/, route: 'bro', reason: 'Word count' },
      { pattern: /^pwd$/, route: 'bro', reason: 'Print directory' },
      { pattern: /^cd\s+/, route: 'bro', reason: 'Change directory' },
      { pattern: /^mkdir\s+/, route: 'bro', reason: 'Create directory' },
      { pattern: /^touch\s+/, route: 'bro', reason: 'Create file' },
      { pattern: /^cp\s+/, route: 'bro', reason: 'Copy file' },
      { pattern: /^mv\s+/, route: 'bro', reason: 'Move file' },
      { pattern: /^rm\s+(?!-rf)/, route: 'bro', reason: 'Remove file (safe)' },

      // Simple searches → Bash Bro
      { pattern: /^grep\s+-[ril]*\s+['"]?\w+['"]?\s+\S+$/, route: 'bro', reason: 'Simple grep' },
      { pattern: /^find\s+\.\s+-name\s+/, route: 'bro', reason: 'Simple find' },
      { pattern: /^which\s+/, route: 'bro', reason: 'Which command' },

      // Git simple operations → Bash Bro
      { pattern: /^git\s+status$/, route: 'bro', reason: 'Git status' },
      { pattern: /^git\s+branch$/, route: 'bro', reason: 'Git branch list' },
      { pattern: /^git\s+log\s+--oneline/, route: 'bro', reason: 'Git log' },
      { pattern: /^git\s+diff$/, route: 'bro', reason: 'Git diff' },
      { pattern: /^git\s+add\s+/, route: 'bro', reason: 'Git add' },

      // Package info → Bash Bro
      { pattern: /^npm\s+list/, route: 'bro', reason: 'NPM list' },
      { pattern: /^pip\s+list/, route: 'bro', reason: 'Pip list' },
      { pattern: /^pip\s+show\s+/, route: 'bro', reason: 'Pip show' },

      // Environment checks → Bash Bro
      { pattern: /^python\s+--version/, route: 'bro', reason: 'Python version' },
      { pattern: /^node\s+--version/, route: 'bro', reason: 'Node version' },
      { pattern: /^npm\s+--version/, route: 'bro', reason: 'NPM version' },
      { pattern: /^env$/, route: 'bro', reason: 'Environment vars' },
      { pattern: /^echo\s+\$\w+$/, route: 'bro', reason: 'Echo env var' },

      // Complex operations → Main agent
      { pattern: /refactor/i, route: 'main', reason: 'Refactoring requires reasoning' },
      { pattern: /implement/i, route: 'main', reason: 'Implementation requires reasoning' },
      { pattern: /explain/i, route: 'main', reason: 'Explanation requires reasoning' },
      { pattern: /debug/i, route: 'main', reason: 'Debugging requires reasoning' },
      { pattern: /fix\s+/i, route: 'main', reason: 'Fixing requires reasoning' },
      { pattern: /why/i, route: 'main', reason: 'Explanation required' },
      { pattern: /how\s+(do|can|should)/i, route: 'main', reason: 'Guidance required' },

      // Git complex → Main agent
      { pattern: /^git\s+rebase/, route: 'main', reason: 'Rebase needs oversight' },
      { pattern: /^git\s+merge/, route: 'main', reason: 'Merge needs oversight' },
      { pattern: /^git\s+reset/, route: 'main', reason: 'Reset needs oversight' },

      // Parallel tasks → Both
      { pattern: /^(npm|yarn|pnpm)\s+(test|run\s+test)/, route: 'both', reason: 'Tests can run in background' },
      { pattern: /^pytest/, route: 'both', reason: 'Tests can run in background' },
      { pattern: /^(npm|yarn|pnpm)\s+run\s+build/, route: 'both', reason: 'Build can run in background' },
      { pattern: /^docker\s+build/, route: 'both', reason: 'Docker build can run in background' },
    ]
  }

  route(command: string): RoutingResult {
    // Check rules in order
    for (const rule of this.rules) {
      if (rule.pattern.test(command)) {
        return {
          decision: rule.route,
          reason: rule.reason,
          confidence: 0.9
        }
      }
    }

    // Default: if it looks simple, route to bro
    if (this.looksSimple(command)) {
      return {
        decision: 'bro',
        reason: 'Appears to be a simple command',
        confidence: 0.6
      }
    }

    // Default to main agent for complex/unknown
    return {
      decision: 'main',
      reason: 'Complex or unknown command',
      confidence: 0.5
    }
  }

  async routeAsync(command: string): Promise<RoutingResult> {
    // Fast path: pattern match
    const patternResult = this.route(command)
    if (patternResult.confidence >= 0.7) {
      return patternResult
    }

    // AI fallback for ambiguous commands
    if (!this.ollama) {
      return patternResult
    }

    try {
      const prompt = `Classify this command as one of: bro (simple, local task), main (complex, needs reasoning), both (can run in background). Command: "${command}". Respond with ONLY one word: bro, main, or both.`

      const response = await this.ollama.generate(prompt, 'You are a command classifier. Respond with exactly one word: bro, main, or both.')

      const decision = response.trim().toLowerCase() as RouteDecision
      if (['bro', 'main', 'both'].includes(decision)) {
        return { decision, reason: 'AI classification', confidence: 0.8 }
      }
    } catch {
      // AI unavailable - fallback
    }

    return { decision: 'main', reason: 'AI fallback - defaulting to main', confidence: 0.5 }
  }

  private looksSimple(command: string): boolean {
    // Heuristics for simple commands
    const words = command.split(/\s+/)

    // Very short commands are usually simple
    if (words.length <= 3) return true

    // No pipes, redirects, or logic operators
    if (/[|><&;]/.test(command)) return false

    // No subshells
    if (/[$`(]/.test(command)) return false

    return true
  }

  addRule(pattern: RegExp, route: RouteDecision, reason: string): void {
    this.rules.unshift({ pattern, route, reason }) // Add to front for priority
  }

  updateProfile(profile: SystemProfile): void {
    this.profile = profile

    // Add project-specific rules based on profile
    if (profile.projectType === 'python') {
      this.addRule(/^python\s+-c\s+/, 'bro', 'Simple Python one-liner')
      this.addRule(/^pip\s+install\s+/, 'bro', 'Pip install')
    }

    if (profile.projectType === 'node') {
      this.addRule(/^npx\s+/, 'bro', 'NPX command')
      this.addRule(/^npm\s+install\s+/, 'bro', 'NPM install')
    }
  }
}
