import { describe, it, expect } from 'vitest'
import { ReportGenerator } from './report.js'
import type { SessionMetrics } from './metrics.js'
import type { CostEstimate } from './cost.js'

describe('ReportGenerator', () => {
  const mockMetrics: SessionMetrics = {
    sessionId: 'test-session-123',
    startTime: new Date('2024-01-15T10:00:00'),
    duration: 300000,  // 5 minutes
    commandCount: 25,
    blockedCount: 3,
    uniqueCommands: 8,
    topCommands: [
      ['git', 10],
      ['ls', 5],
      ['npm', 4],
      ['cat', 3],
      ['echo', 3]
    ],
    riskDistribution: {
      safe: 15,
      caution: 6,
      dangerous: 3,
      critical: 1
    },
    avgRiskScore: 3.2,
    avgExecutionTime: 150,
    totalExecutionTime: 3750,
    filesModified: ['/project/src/index.ts', '/project/package.json'],
    pathsAccessed: ['/project/src', '/project/package.json', '/project/README.md'],
    violationsByType: { command: 2, path: 1 }
  }

  const mockCost: CostEstimate = {
    estimatedTokens: 15000,
    estimatedCost: 0.0525,
    breakdown: {
      inputTokens: 10000,
      outputTokens: 5000,
      toolCalls: 25,
      contextTokens: 2000
    },
    model: 'claude-sonnet-4',
    confidence: 'medium'
  }

  describe('text format', () => {
    it('generates text report', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'text' })

      expect(report).toContain('Session Report')
      expect(report).toContain('25 total')
      expect(report).toContain('3 blocked')
    })

    it('includes risk distribution', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'text', showRisk: true })

      expect(report).toContain('Risk Distribution')
      expect(report).toContain('safe')
      expect(report).toContain('3.2/10')
    })

    it('includes top commands', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'text', showCommands: true })

      expect(report).toContain('Top Commands')
      expect(report).toContain('git')
    })

    it('includes cost estimate', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'text', showCost: true })

      expect(report).toContain('Cost Estimate')
      expect(report).toContain('15,000')
      expect(report).toContain('claude-sonnet-4')
    })

    it('includes files modified', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'text', showPaths: true })

      expect(report).toContain('Files Modified')
      expect(report).toContain('index.ts')
    })

    it('includes violations', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'text', showBlocked: true })

      expect(report).toContain('Violations by Type')
      expect(report).toContain('command')
    })
  })

  describe('markdown format', () => {
    it('generates markdown report', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'markdown' })

      expect(report).toContain('# Session Report')
      expect(report).toContain('| Metric | Value |')
      expect(report).toContain('| Commands | 25 |')
    })

    it('includes risk table', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'markdown', showRisk: true })

      expect(report).toContain('## Risk Distribution')
      expect(report).toContain('| Level | Count | Percentage |')
    })

    it('includes commands table', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'markdown', showCommands: true })

      expect(report).toContain('## Top Commands')
      expect(report).toContain('| Command | Count |')
      expect(report).toContain('`git`')
    })

    it('includes cost section', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'markdown', showCost: true })

      expect(report).toContain('## Cost Estimate')
      expect(report).toContain('**Tokens:**')
    })
  })

  describe('JSON format', () => {
    it('generates valid JSON', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost, { format: 'json' })
      const parsed = JSON.parse(report)

      expect(parsed.metrics).toBeDefined()
      expect(parsed.cost).toBeDefined()
      expect(parsed.metrics.sessionId).toBe('test-session-123')
    })

    it('handles missing cost', () => {
      const report = ReportGenerator.generate(mockMetrics, undefined, { format: 'json' })
      const parsed = JSON.parse(report)

      expect(parsed.metrics).toBeDefined()
      expect(parsed.cost).toBeUndefined()
    })
  })

  describe('one-line summary', () => {
    it('generates one-line summary', () => {
      const summary = ReportGenerator.oneLine(mockMetrics)

      expect(summary).toContain('25 cmds')
      expect(summary).toContain('12% blocked')
      expect(summary).toContain('3.2/10')
      expect(summary).toContain('5m')
    })
  })

  describe('options', () => {
    it('respects showCommands option', () => {
      const withCommands = ReportGenerator.generate(mockMetrics, mockCost, { showCommands: true })
      const withoutCommands = ReportGenerator.generate(mockMetrics, mockCost, { showCommands: false })

      expect(withCommands).toContain('Top Commands')
      expect(withoutCommands).not.toContain('Top Commands')
    })

    it('respects showRisk option', () => {
      const withRisk = ReportGenerator.generate(mockMetrics, mockCost, { showRisk: true })
      const withoutRisk = ReportGenerator.generate(mockMetrics, mockCost, { showRisk: false })

      expect(withRisk).toContain('Risk Distribution')
      expect(withoutRisk).not.toContain('Risk Distribution')
    })

    it('uses defaults when no options provided', () => {
      const report = ReportGenerator.generate(mockMetrics, mockCost)

      expect(report).toContain('Risk Distribution')
      expect(report).toContain('Top Commands')
      expect(report).toContain('Cost Estimate')
    })
  })

  describe('edge cases', () => {
    it('handles zero commands', () => {
      const emptyMetrics: SessionMetrics = {
        ...mockMetrics,
        commandCount: 0,
        blockedCount: 0,
        topCommands: [],
        riskDistribution: { safe: 0, caution: 0, dangerous: 0, critical: 0 },
        avgRiskScore: 0
      }

      const report = ReportGenerator.generate(emptyMetrics, undefined)
      expect(report).toContain('0 total')
    })

    it('handles no files modified', () => {
      const noFiles: SessionMetrics = {
        ...mockMetrics,
        filesModified: []
      }

      const report = ReportGenerator.generate(noFiles, undefined, { showPaths: true })
      expect(report).not.toContain('Files Modified')
    })
  })
})
