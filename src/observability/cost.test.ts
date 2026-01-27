import { describe, it, expect, beforeEach } from 'vitest'
import { CostEstimator } from './cost.js'

describe('CostEstimator', () => {
  let estimator: CostEstimator

  beforeEach(() => {
    estimator = new CostEstimator('claude-sonnet-4')
  })

  describe('token estimation', () => {
    it('estimates tokens from text', () => {
      const tokens = estimator.estimateTokens('Hello world')
      expect(tokens).toBeGreaterThan(0)
      // ~4 chars per token, 11 chars = ~3 tokens
      expect(tokens).toBe(3)
    })

    it('handles empty string', () => {
      expect(estimator.estimateTokens('')).toBe(0)
    })

    it('handles long text', () => {
      const longText = 'a'.repeat(1000)
      const tokens = estimator.estimateTokens(longText)
      expect(tokens).toBe(250)  // 1000/4
    })
  })

  describe('tool call recording', () => {
    it('records tool calls', () => {
      estimator.recordToolCall('ls -la', 'file1.txt\nfile2.txt')

      const estimate = estimator.getEstimate()
      expect(estimate.breakdown.toolCalls).toBe(1)
      expect(estimate.estimatedTokens).toBeGreaterThan(0)
    })

    it('accumulates multiple calls', () => {
      estimator.recordToolCall('cmd1', 'output1')
      estimator.recordToolCall('cmd2', 'output2')
      estimator.recordToolCall('cmd3', 'output3')

      const estimate = estimator.getEstimate()
      expect(estimate.breakdown.toolCalls).toBe(3)
    })

    it('handles missing output', () => {
      estimator.recordToolCall('ls')
      const estimate = estimator.getEstimate()
      expect(estimate.breakdown.toolCalls).toBe(1)
    })
  })

  describe('cost calculation', () => {
    it('calculates cost for claude-sonnet-4', () => {
      // Record enough to have meaningful cost
      for (let i = 0; i < 10; i++) {
        estimator.recordToolCall('command ' + i, 'output '.repeat(100))
      }

      const estimate = estimator.getEstimate()
      expect(estimate.estimatedCost).toBeGreaterThan(0)
      expect(estimate.model).toBe('claude-sonnet-4')
    })

    it('uses default pricing for unknown models', () => {
      const e = new CostEstimator('unknown-model')
      e.recordToolCall('test', 'output')
      const estimate = e.getEstimate()
      expect(estimate.estimatedCost).toBeGreaterThan(0)
    })
  })

  describe('confidence levels', () => {
    it('low confidence with few data points', () => {
      estimator.recordToolCall('cmd1', 'out1')
      expect(estimator.getEstimate().confidence).toBe('low')
    })

    it('medium confidence with some data', () => {
      for (let i = 0; i < 10; i++) {
        estimator.recordToolCall(`cmd${i}`, `out${i}`)
      }
      expect(estimator.getEstimate().confidence).toBe('medium')
    })

    it('high confidence with lots of data', () => {
      for (let i = 0; i < 25; i++) {
        estimator.recordToolCall(`cmd${i}`, `out${i}`)
      }
      expect(estimator.getEstimate().confidence).toBe('high')
    })
  })

  describe('cost projection', () => {
    it('projects future cost with no data', () => {
      const projection = estimator.projectCost(10)
      expect(projection.breakdown.toolCalls).toBe(10)
      expect(projection.confidence).toBe('low')
    })

    it('projects based on averages', () => {
      for (let i = 0; i < 5; i++) {
        estimator.recordToolCall('test command', 'test output here')
      }

      const current = estimator.getEstimate()
      const projection = estimator.projectCost(5)

      expect(projection.estimatedCost).toBeGreaterThan(current.estimatedCost)
      expect(projection.breakdown.toolCalls).toBe(10)
    })
  })

  describe('format cost', () => {
    it('formats sub-cent costs', () => {
      expect(CostEstimator.formatCost(0.0005)).toBe('$0.05¢')
    })

    it('formats sub-dollar costs', () => {
      expect(CostEstimator.formatCost(0.125)).toBe('$0.125')
    })

    it('formats dollar costs', () => {
      expect(CostEstimator.formatCost(5.5)).toBe('$5.50')
    })
  })

  describe('model switching', () => {
    it('allows changing model', () => {
      estimator.setModel('claude-haiku-4')
      estimator.recordToolCall('test', 'output')

      const estimate = estimator.getEstimate()
      expect(estimate.model).toBe('claude-haiku-4')
    })
  })

  describe('reset', () => {
    it('clears all counters', () => {
      estimator.recordToolCall('test', 'output')
      expect(estimator.getEstimate().breakdown.toolCalls).toBe(1)

      estimator.reset()
      expect(estimator.getEstimate().breakdown.toolCalls).toBe(0)
    })
  })

  describe('custom pricing', () => {
    it('allows adding custom model pricing', () => {
      CostEstimator.addModelPricing('custom-model', {
        inputPer1k: 0.01,
        outputPer1k: 0.05
      })

      const e = new CostEstimator('custom-model')
      e.recordToolCall('test', 'output')
      const estimate = e.getEstimate()
      expect(estimate.estimatedCost).toBeGreaterThan(0)
    })
  })
})
