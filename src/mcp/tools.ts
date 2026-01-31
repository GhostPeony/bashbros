import type { DashboardDB, SessionRecord, CommandRecord } from '../dashboard/db.js'
import type { OllamaClient } from '../bro/ollama.js'
import type { CommandSuggester, SuggestionContext } from '../bro/suggester.js'
import type { SecretsGuard } from '../policy/secrets-guard.js'

// ── Capability Tier ──

export type CapabilityTier = 'basic' | 'moderate' | 'advanced'

export function detectCapabilityTier(parameterSize: string): CapabilityTier {
  // parameterSize from Ollama /api/show e.g., "7B", "14B", "70B"
  const match = parameterSize.match(/(\d+\.?\d*)([BM])/i)
  if (!match) return 'basic'
  const size = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const params = unit === 'M' ? size / 1000 : size
  if (params >= 33) return 'advanced'
  if (params >= 14) return 'moderate'
  return 'basic'
}

// ── session_summary ──

export interface SessionSummaryInput {
  count?: number
  agent?: string
}

export interface SessionSummaryOutput {
  sessions: Array<{
    id: string
    agent: string
    repoName: string | null
    workingDir: string
    startTime: string
    endTime: string | null
    duration: string
    commandCount: number
    blockedCount: number
    avgRiskScore: number
    topCommands: Array<{ command: string; count: number }>
    summary: string
  }>
}

export async function sessionSummary(
  input: SessionSummaryInput,
  db: DashboardDB,
  ollama: OllamaClient | null
): Promise<SessionSummaryOutput> {
  const count = input.count ?? 3
  const sessions = db.getSessions({
    agent: input.agent,
    limit: count,
  })

  const results = []
  for (const session of sessions) {
    const metrics = db.getSessionMetrics(session.id)
    const durationMs = session.endTime
      ? session.endTime.getTime() - session.startTime.getTime()
      : Date.now() - session.startTime.getTime()
    const durationMin = Math.round(durationMs / 60000)

    // Generate natural language summary if Ollama available
    let summary = `${metrics.totalCommands} commands, ${metrics.blockedCommands} blocked, avg risk ${session.avgRiskScore.toFixed(1)}`
    if (ollama && await ollama.isAvailable()) {
      const topCmds = metrics.topCommands.slice(0, 5).map(c => c.command).join(', ')
      const prompt = `Summarize this coding session in 1-2 sentences:
Agent: ${session.agent}, Repo: ${session.repoName || 'unknown'}
Duration: ${durationMin} minutes, Commands: ${metrics.totalCommands}, Blocked: ${metrics.blockedCommands}
Top commands: ${topCmds}
Risk: avg ${session.avgRiskScore.toFixed(1)}/10`
      try {
        const aiSummary = await ollama.generate(prompt, 'You are a concise session summarizer. Respond in 1-2 sentences.')
        if (aiSummary && aiSummary.length > 10) {
          summary = aiSummary.trim()
        }
      } catch {
        // Use default summary
      }
    }

    results.push({
      id: session.id,
      agent: session.agent,
      repoName: session.repoName,
      workingDir: session.workingDir,
      startTime: session.startTime.toISOString(),
      endTime: session.endTime?.toISOString() ?? null,
      duration: `${durationMin}m`,
      commandCount: session.commandCount,
      blockedCount: session.blockedCount,
      avgRiskScore: session.avgRiskScore,
      topCommands: metrics.topCommands.slice(0, 5),
      summary,
    })
  }

  return { sessions: results }
}

// ── trace_search ──

export interface TraceSearchInput {
  query: string
  limit?: number
  session_id?: string
}

export interface TraceSearchOutput {
  matches: Array<{
    command: string
    timestamp: string
    sessionId: string
    riskLevel: string
    exitInfo: string
    allowed: boolean
  }>
  totalMatches: number
}

export async function traceSearch(
  input: TraceSearchInput,
  db: DashboardDB
): Promise<TraceSearchOutput> {
  const limit = input.limit ?? 10

  // Search commands by text
  let matches: CommandRecord[]
  if (input.session_id) {
    const sessionCommands = db.getCommands({ sessionId: input.session_id, limit: 1000 })
    matches = sessionCommands.filter(c =>
      c.command.toLowerCase().includes(input.query.toLowerCase())
    ).slice(0, limit)
  } else {
    matches = db.searchCommands(input.query, limit)
  }

  return {
    matches: matches.map(m => ({
      command: m.command,
      timestamp: m.timestamp.toISOString(),
      sessionId: m.sessionId,
      riskLevel: m.riskLevel,
      exitInfo: m.allowed ? 'allowed' : `blocked: ${m.violations.join(', ')}`,
      allowed: m.allowed,
    })),
    totalMatches: matches.length,
  }
}

// ── history_suggest ──

export interface HistorySuggestInput {
  last_command: string
  last_output?: string
  cwd?: string
}

export interface HistorySuggestOutput {
  suggestions: Array<{
    command: string
    confidence: number
    source: string
    reason: string
  }>
}

export async function historySuggest(
  input: HistorySuggestInput,
  suggester: CommandSuggester
): Promise<HistorySuggestOutput> {
  const context: SuggestionContext = {
    lastCommand: input.last_command,
    lastOutput: input.last_output?.substring(0, 500),
    cwd: input.cwd,
  }

  const suggestions = await suggester.suggestAsync(context)

  return {
    suggestions: suggestions.map(s => ({
      command: s.command,
      confidence: s.confidence,
      source: s.source || 'pattern',
      reason: s.description || '',
    })),
  }
}

// ── secret_scan ──

export interface SecretScanInput {
  text: string
}

export interface SecretScanOutput {
  clean: boolean
  findings: Array<{
    pattern: string
    redacted: string
    line: number
    severity: string
  }>
}

export function secretScan(
  input: SecretScanInput,
  guard: SecretsGuard
): SecretScanOutput {
  const result = guard.scanText(input.text)
  return {
    clean: result.clean,
    findings: result.findings.map(f => ({
      pattern: f.pattern,
      redacted: f.redacted,
      line: f.line,
      severity: f.severity,
    })),
  }
}

// ── code_task ──

export interface CodeTaskInput {
  task: string
  code: string
  language?: string
  context?: string
}

export interface CodeTaskOutput {
  result: string
  model_used: string
  capability_tier: CapabilityTier
  confidence: string
}

export async function codeTask(
  input: CodeTaskInput,
  ollama: OllamaClient,
  tier: CapabilityTier
): Promise<CodeTaskOutput> {
  const tierDescription = {
    basic: 'You handle simple edits: formatting, renames, adding imports, boilerplate, type annotations.',
    moderate: 'You handle moderate tasks: writing tests, adding error handling, refactoring single functions, implementing interfaces.',
    advanced: 'You handle complex tasks: multi-function refactors within a file, pattern-following generation, complex logic.',
  }

  const systemPrompt = `You are a coding assistant. ${tierDescription[tier]}
Return ONLY the modified code, no explanations, no markdown fences.
If the language is specified, use it. Otherwise infer from the code.`

  const prompt = [
    `Task: ${input.task}`,
    input.language ? `Language: ${input.language}` : '',
    input.context ? `Context:\n${input.context}` : '',
    `\nCode:\n${input.code}`,
  ].filter(Boolean).join('\n')

  const result = await ollama.generate(prompt, systemPrompt)

  return {
    result: result.trim(),
    model_used: ollama.getModel(),
    capability_tier: tier,
    confidence: tier === 'advanced' ? 'high' : tier === 'moderate' ? 'medium' : 'low',
  }
}
