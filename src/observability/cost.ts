/**
 * Cost Estimation
 * Estimate API costs based on session complexity
 */

export interface CostEstimate {
  estimatedTokens: number
  estimatedCost: number  // USD
  breakdown: {
    inputTokens: number
    outputTokens: number
    toolCalls: number
    contextTokens: number
  }
  model: string
  confidence: 'low' | 'medium' | 'high'
}

export interface ModelPricing {
  inputPer1k: number   // USD per 1K input tokens
  outputPer1k: number  // USD per 1K output tokens
}

// Pricing as of 2025 (update as needed)
const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'claude-sonnet-4': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-haiku-4': { inputPer1k: 0.00025, outputPer1k: 0.00125 },
  'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'default': { inputPer1k: 0.003, outputPer1k: 0.015 }
}

// Heuristics for token estimation
const AVG_CHARS_PER_TOKEN = 4
const AVG_TOOL_CALL_TOKENS = 150
const AVG_TOOL_RESULT_TOKENS = 500
const CONTEXT_OVERHEAD_RATIO = 0.2  // 20% overhead for system prompts, etc.

export class CostEstimator {
  private model: string
  private pricing: ModelPricing
  private totalInputTokens: number = 0
  private totalOutputTokens: number = 0
  private toolCallCount: number = 0

  constructor(model: string = 'claude-sonnet-4') {
    this.model = model
    this.pricing = MODEL_PRICING[model] || MODEL_PRICING['default']
  }

  /**
   * Estimate tokens from text
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / AVG_CHARS_PER_TOKEN)
  }

  /**
   * Record a tool call with input and output
   */
  recordToolCall(input: string, output?: string): void {
    this.toolCallCount++

    // Estimate input tokens (command + tool overhead)
    const inputTokens = this.estimateTokens(input) + AVG_TOOL_CALL_TOKENS
    this.totalInputTokens += inputTokens

    // Estimate output tokens (result + overhead)
    if (output) {
      const outputTokens = this.estimateTokens(output) + 50 // Response overhead
      this.totalOutputTokens += outputTokens
    } else {
      this.totalOutputTokens += AVG_TOOL_RESULT_TOKENS
    }
  }

  /**
   * Get current cost estimate
   */
  getEstimate(): CostEstimate {
    // Add context overhead
    const contextTokens = Math.ceil(
      (this.totalInputTokens + this.totalOutputTokens) * CONTEXT_OVERHEAD_RATIO
    )

    const totalInput = this.totalInputTokens + contextTokens
    const totalOutput = this.totalOutputTokens

    // Calculate cost
    const inputCost = (totalInput / 1000) * this.pricing.inputPer1k
    const outputCost = (totalOutput / 1000) * this.pricing.outputPer1k
    const totalCost = inputCost + outputCost

    // Determine confidence based on data points
    let confidence: CostEstimate['confidence']
    if (this.toolCallCount < 5) confidence = 'low'
    else if (this.toolCallCount < 20) confidence = 'medium'
    else confidence = 'high'

    return {
      estimatedTokens: totalInput + totalOutput,
      estimatedCost: Math.round(totalCost * 10000) / 10000, // 4 decimal places
      breakdown: {
        inputTokens: totalInput,
        outputTokens: totalOutput,
        toolCalls: this.toolCallCount,
        contextTokens
      },
      model: this.model,
      confidence
    }
  }

  /**
   * Format cost for display
   */
  static formatCost(cost: number): string {
    if (cost < 0.01) return `$${(cost * 100).toFixed(2)}¢`
    if (cost < 1) return `$${cost.toFixed(3)}`
    return `$${cost.toFixed(2)}`
  }

  /**
   * Get cost projection for N more commands
   */
  projectCost(additionalCommands: number): CostEstimate {
    if (this.toolCallCount === 0) {
      // Use defaults if no data
      const projectedInput = additionalCommands * (AVG_TOOL_CALL_TOKENS + 50)
      const projectedOutput = additionalCommands * AVG_TOOL_RESULT_TOKENS

      const inputCost = (projectedInput / 1000) * this.pricing.inputPer1k
      const outputCost = (projectedOutput / 1000) * this.pricing.outputPer1k

      return {
        estimatedTokens: projectedInput + projectedOutput,
        estimatedCost: inputCost + outputCost,
        breakdown: {
          inputTokens: projectedInput,
          outputTokens: projectedOutput,
          toolCalls: additionalCommands,
          contextTokens: 0
        },
        model: this.model,
        confidence: 'low'
      }
    }

    // Project based on current averages
    const avgInputPerCall = this.totalInputTokens / this.toolCallCount
    const avgOutputPerCall = this.totalOutputTokens / this.toolCallCount

    const projectedInput = this.totalInputTokens + (additionalCommands * avgInputPerCall)
    const projectedOutput = this.totalOutputTokens + (additionalCommands * avgOutputPerCall)
    const contextTokens = Math.ceil((projectedInput + projectedOutput) * CONTEXT_OVERHEAD_RATIO)

    const totalInput = projectedInput + contextTokens
    const totalOutput = projectedOutput

    const inputCost = (totalInput / 1000) * this.pricing.inputPer1k
    const outputCost = (totalOutput / 1000) * this.pricing.outputPer1k

    return {
      estimatedTokens: totalInput + totalOutput,
      estimatedCost: inputCost + outputCost,
      breakdown: {
        inputTokens: Math.ceil(totalInput),
        outputTokens: Math.ceil(totalOutput),
        toolCalls: this.toolCallCount + additionalCommands,
        contextTokens
      },
      model: this.model,
      confidence: this.toolCallCount >= 10 ? 'high' : 'medium'
    }
  }

  /**
   * Set model for pricing
   */
  setModel(model: string): void {
    this.model = model
    this.pricing = MODEL_PRICING[model] || MODEL_PRICING['default']
  }

  /**
   * Reset counters
   */
  reset(): void {
    this.totalInputTokens = 0
    this.totalOutputTokens = 0
    this.toolCallCount = 0
  }

  /**
   * Add custom model pricing
   */
  static addModelPricing(model: string, pricing: ModelPricing): void {
    MODEL_PRICING[model] = pricing
  }
}
