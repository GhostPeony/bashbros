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

      const data = await response.json()
      return data.models?.map((m: { name: string }) => m.name) || []
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

      const data: GenerateResponse = await response.json()
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

      const data = await response.json()
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
   * Ask Bash Bro to explain a command
   */
  async explainCommand(command: string): Promise<string> {
    const systemPrompt = `You are Bash Bro, a helpful command-line assistant.
Explain what the given command does in 1-2 sentences. Be concise and accurate.`

    try {
      return await this.generate(`Explain: ${command}`, systemPrompt)
    } catch {
      return 'Could not explain command.'
    }
  }

  /**
   * Ask Bash Bro to fix a command that failed
   */
  async fixCommand(command: string, error: string): Promise<string | null> {
    const systemPrompt = `You are Bash Bro, a helpful command-line assistant.
Given a failed command and its error, suggest a fixed version.
Respond with ONLY the fixed command, no explanation. If you can't fix it, respond with "none".`

    try {
      const response = await this.generate(
        `Command: ${command}\nError: ${error}\nFixed command:`,
        systemPrompt
      )

      const fixed = response.trim()

      if (fixed.toLowerCase() === 'none' || fixed.length > 500) {
        return null
      }

      return fixed
    } catch {
      return null
    }
  }

  setModel(model: string): void {
    this.config.model = model
  }

  getModel(): string {
    return this.config.model
  }
}
