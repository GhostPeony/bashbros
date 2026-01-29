/**
 * OpenCode Hook Integration
 * Seamlessly integrate BashBros with OpenCode via TypeScript plugin modules
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

const OPENCODE_DIR_NAME = '.opencode'
const PLUGINS_DIR_NAME = 'plugins'
const PLUGIN_FILENAME = 'bashbros.ts'
const BASHBROS_MANAGED_MARKER = '// bashbros-managed'

export class OpenCodeHooks {
  /**
   * Check if OpenCode is available (project .opencode dir exists or opencode command on PATH)
   */
  static isOpenCodeInstalled(projectDir?: string): boolean {
    const dir = projectDir || process.cwd()
    const openCodeDir = join(dir, OPENCODE_DIR_NAME)

    // Check for .opencode directory in the project
    if (existsSync(openCodeDir)) {
      return true
    }

    // Check for opencode command on PATH
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(cmd, ['opencode'], { stdio: 'pipe', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the path to the plugin file
   */
  private static getPluginPath(projectDir?: string): string {
    const dir = projectDir || process.cwd()
    return join(dir, OPENCODE_DIR_NAME, PLUGINS_DIR_NAME, PLUGIN_FILENAME)
  }

  /**
   * Get the path to the plugins directory
   */
  private static getPluginsDir(projectDir?: string): string {
    const dir = projectDir || process.cwd()
    return join(dir, OPENCODE_DIR_NAME, PLUGINS_DIR_NAME)
  }

  /**
   * Generate the TypeScript plugin source code
   */
  static generatePluginSource(): string {
    return `// bashbros-managed - BashBros security plugin for OpenCode
// Do not edit manually. Managed by: bashbros opencode install
import type { Plugin } from "@opencode-ai/plugin"

export const BashBrosPlugin: Plugin = async ({ $ }) => {
  return {
    "tool.execute.before": async (input: any, output: any) => {
      if (input.tool === "bash") {
        const command = typeof output.args?.command === 'string' ? output.args.command : ''
        if (!command) return
        try {
          await $\`bashbros gate \${JSON.stringify(command)}\`
        } catch (error: any) {
          throw new Error(\`BashBros blocked: \${error?.stderr || error?.message || 'Policy violation'}\`)
        }
      }
    },
    "tool.execute.after": async (input: any) => {
      if (input.tool === "bash") {
        try {
          await $\`bashbros record \${JSON.stringify(JSON.stringify({ tool: input.tool, args: input.args }))}\`
        } catch {
          // Silent fail for recording
        }
      }
    }
  }
}
`
  }

  /**
   * Install BashBros plugin into OpenCode project
   */
  static install(projectDir?: string): { success: boolean; message: string } {
    if (!this.isOpenCodeInstalled(projectDir)) {
      return {
        success: false,
        message: 'OpenCode not found. Install OpenCode or initialize a .opencode directory first.'
      }
    }

    // Check if already installed
    if (this.isInstalled(projectDir)) {
      return {
        success: true,
        message: 'BashBros plugin already installed.'
      }
    }

    const pluginsDir = this.getPluginsDir(projectDir)
    const pluginPath = this.getPluginPath(projectDir)

    // Ensure plugins directory exists
    if (!existsSync(pluginsDir)) {
      mkdirSync(pluginsDir, { recursive: true })
    }

    // Write the plugin file
    writeFileSync(pluginPath, this.generatePluginSource(), 'utf-8')

    return {
      success: true,
      message: 'BashBros plugin installed successfully.'
    }
  }

  /**
   * Uninstall BashBros plugin from OpenCode project
   */
  static uninstall(projectDir?: string): { success: boolean; message: string } {
    const pluginPath = this.getPluginPath(projectDir)

    if (!existsSync(pluginPath)) {
      return {
        success: true,
        message: 'No BashBros plugin found. Nothing to uninstall.'
      }
    }

    // Read the file to verify it has the bashbros-managed marker
    try {
      const content = readFileSync(pluginPath, 'utf-8')
      if (!content.startsWith(BASHBROS_MANAGED_MARKER)) {
        return {
          success: false,
          message: 'Plugin file exists but is not managed by BashBros. Refusing to remove user-created plugin.'
        }
      }
    } catch {
      return {
        success: false,
        message: 'Failed to read plugin file.'
      }
    }

    // Safe to remove - it has the bashbros-managed marker
    unlinkSync(pluginPath)

    return {
      success: true,
      message: 'BashBros plugin uninstalled successfully.'
    }
  }

  /**
   * Check if BashBros plugin is installed with the managed marker
   */
  static isInstalled(projectDir?: string): boolean {
    const pluginPath = this.getPluginPath(projectDir)

    if (!existsSync(pluginPath)) {
      return false
    }

    try {
      const content = readFileSync(pluginPath, 'utf-8')
      return content.startsWith(BASHBROS_MANAGED_MARKER)
    } catch {
      return false
    }
  }

  /**
   * Get plugin status
   */
  static getStatus(projectDir?: string): {
    openCodeInstalled: boolean
    pluginInstalled: boolean
  } {
    const openCodeInstalled = this.isOpenCodeInstalled(projectDir)
    const pluginInstalled = this.isInstalled(projectDir)

    return {
      openCodeInstalled,
      pluginInstalled
    }
  }
}
