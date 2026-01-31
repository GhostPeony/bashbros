/**
 * Simple Ollama client for local model inference.
 * Keeps it minimal - just what we need for Bash Bro.
 */

export interface OllamaConfig {
  host: string
  model: string
  timeout: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface GenerateResponse {
  response: string
  done: boolean
  context?: number[]
}

export interface ModelInfo {
  modelfile: string
  parameters: string
  template: string
  details: {
    parent_model: string
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

export interface RunningModel {
  name: string
  model: string
  size: number
  size_vram: number
  digest: string
  details: {
    family: string
    parameter_size: string
    quantization_level: string
  }
  expires_at: string
}

const DEFAULT_CONFIG: OllamaConfig = {
  host: 'http://localhost:11434',
  model: 'qwen2.5-coder:7b',
  timeout: 30000
}

export class OllamaClient {
  private config: OllamaConfig

  constructor(config: Partial<OllamaConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check if Ollama is running and accessible
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)

      const response = await fetch(`${this.config.host}/api/tags`, {
        signal: controller.signal
      })

      clearTimeout(timeout)
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.host}/api/tags`)

      if (!response.ok) {
        return []
      }

      const data = await response.json() as { models?: { name: string }[] }
      return data.models?.map((m) => m.name) || []
    } catch {
      return []
    }
  }

  /**
   * Generate a response from the model
   */
  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(`${this.config.host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          system: systemPrompt,
          stream: false
        }),
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`)
      }

      const data = await response.json() as GenerateResponse
      return data.response
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Ollama request timed out')
      }
      throw error
    }
  }

  /**
   * Chat with the model (multi-turn conversation)
   */
  async chat(messages: ChatMessage[]): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const response = await fetch(`${this.config.host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          stream: false
        }),
        signal: controller.signal
      })

      clearTimeout(timeout)

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`)
      }

      const data = await response.json() as { message?: { content: string } }
      return data.message?.content || ''
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Ollama request timed out')
      }
      throw error
    }
  }

  /**
   * Ask Bash Bro to suggest a command
   */
  async suggestCommand(context: string): Promise<string | null> {
    const systemPrompt = `You are Bash Bro, a helpful command-line assistant.
Given the context, suggest the most likely next command the user needs.
Respond with ONLY the command, no explanation. If unsure, respond with "none".`

    try {
      const response = await this.generate(context, systemPrompt)
      const command = response.trim()

      if (command.toLowerCase() === 'none' || command.length > 200) {
        return null
      }

      return command
    } catch {
      return null
    }
  }

  /**
   * Show detailed info about a model
   */
  async showModel(name: string): Promise<ModelInfo | null> {
    try {
      const response = await fetch(`${this.config.host}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })

      if (!response.ok) {
        return null
      }

      const data = await response.json() as ModelInfo
      return data
    } catch {
      return null
    }
  }

  /**
   * Delete a model
   */
  async deleteModel(name: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.host}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })

      return response.ok
    } catch {
      return false
    }
  }

  /**
   * List currently running models
   */
  async listRunning(): Promise<RunningModel[]> {
    try {
      const response = await fetch(`${this.config.host}/api/ps`)

      if (!response.ok) {
        return []
      }

      const data = await response.json() as { models?: RunningModel[] }
      return data.models || []
    } catch {
      return []
    }
  }

  /**
   * Pull a model from the registry
   */
  async pullModel(name: string): Promise<boolean> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 300000) // 5 minutes

    try {
      const response = await fetch(`${this.config.host}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, stream: false }),
        signal: controller.signal
      })

      clearTimeout(timeout)
      return response.ok
    } catch {
      clearTimeout(timeout)
      return false
    }
  }

  /**
   * Create a model from a Modelfile
   */
  async createModel(name: string, modelfile: string): Promise<boolean> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120000) // 2 minutes

    try {
      const response = await fetch(`${this.config.host}/api/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, modelfile, stream: false }),
        signal: controller.signal
      })

      clearTimeout(timeout)
      return response.ok
    } catch {
      clearTimeout(timeout)
      return false
    }
  }

  setModel(model: string): void {
    this.config.model = model
  }

  getModel(): string {
    return this.config.model
  }

  /**
   * Analyze command safety and provide recommendations
   */
  async analyzeCommandSafety(command: string): Promise<{
    safe: boolean
    risk: 'low' | 'medium' | 'high' | 'critical'
    explanation: string
    suggestions: string[]
  }> {
    const systemPrompt = `You are Bash Bro, a security-focused command-line assistant.
Analyze the given command for security risks.
Respond with JSON only, in this format:
{"safe": boolean, "risk": "low|medium|high|critical", "explanation": "...", "suggestions": ["..."]}`

    try {
      const response = await this.generate(
        `Analyze this command for security risks: ${command}`,
        systemPrompt
      )

      // Try to parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }

      // Fallback if not parseable
      return {
        safe: true,
        risk: 'low',
        explanation: 'Could not analyze command.',
        suggestions: []
      }
    } catch {
      return {
        safe: true,
        risk: 'low',
        explanation: 'Analysis unavailable.',
        suggestions: []
      }
    }
  }

  /**
   * Generate with a temporary model override (for adapter-specific calls)
   */
  async generateWithAdapter(modelOverride: string, prompt: string, systemPrompt?: string): Promise<string> {
    const originalModel = this.config.model
    this.config.model = modelOverride
    try {
      return await this.generate(prompt, systemPrompt)
    } finally {
      this.config.model = originalModel
    }
  }
}
