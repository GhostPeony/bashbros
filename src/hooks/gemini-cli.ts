/**
 * Gemini CLI Hook Integration
 * Seamlessly integrate BashBros with Gemini CLI
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

export interface GeminiSettings {
  hooks?: {
    BeforeTool?: GeminiToolHookConfig[]
    AfterTool?: GeminiToolHookConfig[]
    SessionEnd?: GeminiSessionHookConfig[]
  }
  [key: string]: unknown
}

interface GeminiHookEntry {
  name: string
  type: string
  command: string
}

interface GeminiToolHookConfig {
  matcher?: string
  hooks: GeminiHookEntry[]
}

interface GeminiSessionHookConfig {
  hooks: GeminiHookEntry[]
}

const GEMINI_DIR_NAME = '.gemini'
const GEMINI_SETTINGS_FILE = 'settings.json'
const BASHBROS_HOOK_MARKER = '# bashbros-managed'

export class GeminiCLIHooks {
  /**
   * Check if Gemini CLI is installed (project .gemini dir exists or gemini command on PATH)
   */
  static isGeminiInstalled(projectDir?: string): boolean {
    const dir = projectDir || process.cwd()
    const geminiDir = join(dir, GEMINI_DIR_NAME)

    // Check for .gemini directory in project
    if (existsSync(geminiDir)) {
      return true
    }

    // Check for gemini command on PATH
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(cmd, ['gemini'], { stdio: 'pipe', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Load current Gemini settings from project-scoped .gemini/settings.json
   */
  static loadSettings(projectDir?: string): GeminiSettings {
    const dir = projectDir || process.cwd()
    const settingsPath = join(dir, GEMINI_DIR_NAME, GEMINI_SETTINGS_FILE)

    if (!existsSync(settingsPath)) {
      return {}
    }

    try {
      const content = readFileSync(settingsPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {}
    }
  }

  /**
   * Save Gemini settings to project-scoped .gemini/settings.json
   */
  static saveSettings(settings: GeminiSettings, projectDir?: string): void {
    const dir = projectDir || process.cwd()
    const geminiDir = join(dir, GEMINI_DIR_NAME)

    if (!existsSync(geminiDir)) {
      mkdirSync(geminiDir, { recursive: true })
    }

    writeFileSync(
      join(geminiDir, GEMINI_SETTINGS_FILE),
      JSON.stringify(settings, null, 2),
      'utf-8'
    )
  }

  /**
   * Install BashBros hooks into Gemini CLI
   */
  static install(projectDir?: string): { success: boolean; message: string } {
    if (!this.isGeminiInstalled(projectDir)) {
      return {
        success: false,
        message: 'Gemini CLI not found. Install Gemini CLI or initialize a .gemini directory first.'
      }
    }

    const settings = this.loadSettings(projectDir)

    // Initialize hooks if not present
    if (!settings.hooks) {
      settings.hooks = {}
    }

    // Check if already installed
    if (this.isInstalled(settings)) {
      return {
        success: true,
        message: 'BashBros hooks already installed.'
      }
    }

    // Add BeforeTool hook for shell commands
    const beforeToolHook: GeminiToolHookConfig = {
      matcher: 'run_shell_command',
      hooks: [{
        name: 'bashbros-gate',
        type: 'command',
        command: `bashbros gemini-gate ${BASHBROS_HOOK_MARKER}`
      }]
    }

    // Add AfterTool hook for recording
    const afterToolHook: GeminiToolHookConfig = {
      matcher: 'run_shell_command',
      hooks: [{
        name: 'bashbros-record',
        type: 'command',
        command: `bashbros gemini-record ${BASHBROS_HOOK_MARKER}`
      }]
    }

    // Add SessionEnd hook for reports
    const sessionEndHook: GeminiSessionHookConfig = {
      hooks: [{
        name: 'bashbros-session-end',
        type: 'command',
        command: `bashbros session-end ${BASHBROS_HOOK_MARKER}`
      }]
    }

    // Merge with existing hooks
    settings.hooks.BeforeTool = [
      ...(settings.hooks.BeforeTool || []),
      beforeToolHook
    ]

    settings.hooks.AfterTool = [
      ...(settings.hooks.AfterTool || []),
      afterToolHook
    ]

    settings.hooks.SessionEnd = [
      ...(settings.hooks.SessionEnd || []),
      sessionEndHook
    ]

    this.saveSettings(settings, projectDir)

    return {
      success: true,
      message: 'BashBros hooks installed successfully.'
    }
  }

  /**
   * Uninstall BashBros hooks from Gemini CLI
   */
  static uninstall(projectDir?: string): { success: boolean; message: string } {
    if (!this.isGeminiInstalled(projectDir)) {
      return {
        success: false,
        message: 'Gemini CLI not found.'
      }
    }

    const settings = this.loadSettings(projectDir)

    if (!settings.hooks) {
      return {
        success: true,
        message: 'No hooks to uninstall.'
      }
    }

    // Remove BashBros hooks by filtering entries containing the marker
    const filterToolHooks = (hooks: GeminiToolHookConfig[] | undefined): GeminiToolHookConfig[] => {
      if (!hooks) return []
      return hooks.filter(h =>
        !h.hooks.some(hook => hook.command.includes(BASHBROS_HOOK_MARKER))
      )
    }

    const filterSessionHooks = (hooks: GeminiSessionHookConfig[] | undefined): GeminiSessionHookConfig[] => {
      if (!hooks) return []
      return hooks.filter(h =>
        !h.hooks.some(hook => hook.command.includes(BASHBROS_HOOK_MARKER))
      )
    }

    settings.hooks.BeforeTool = filterToolHooks(settings.hooks.BeforeTool)
    settings.hooks.AfterTool = filterToolHooks(settings.hooks.AfterTool)
    settings.hooks.SessionEnd = filterSessionHooks(settings.hooks.SessionEnd)

    // Clean up empty arrays
    if (settings.hooks.BeforeTool?.length === 0) delete settings.hooks.BeforeTool
    if (settings.hooks.AfterTool?.length === 0) delete settings.hooks.AfterTool
    if (settings.hooks.SessionEnd?.length === 0) delete settings.hooks.SessionEnd
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks

    this.saveSettings(settings, projectDir)

    return {
      success: true,
      message: 'BashBros hooks uninstalled successfully.'
    }
  }

  /**
   * Check if BashBros hooks are installed
   */
  static isInstalled(settings?: GeminiSettings): boolean {
    const s = settings || this.loadSettings()

    if (!s.hooks) return false

    const hasMarker = (hooks: (GeminiToolHookConfig | GeminiSessionHookConfig)[] | undefined): boolean => {
      if (!hooks) return false
      return hooks.some(h =>
        h.hooks.some(hook => hook.command.includes(BASHBROS_HOOK_MARKER))
      )
    }

    return hasMarker(s.hooks.BeforeTool) ||
           hasMarker(s.hooks.AfterTool) ||
           hasMarker(s.hooks.SessionEnd)
  }

  /**
   * Get hook status
   */
  static getStatus(projectDir?: string): {
    geminiInstalled: boolean
    hooksInstalled: boolean
    hooks: string[]
  } {
    const geminiInstalled = this.isGeminiInstalled(projectDir)
    const settings = geminiInstalled ? this.loadSettings(projectDir) : {}
    const hooksInstalled = this.isInstalled(settings)

    const hooks: string[] = []
    if (settings.hooks?.BeforeTool) hooks.push('BeforeTool (gate)')
    if (settings.hooks?.AfterTool) hooks.push('AfterTool (record)')
    if (settings.hooks?.SessionEnd) hooks.push('SessionEnd (report)')

    return {
      geminiInstalled,
      hooksInstalled,
      hooks
    }
  }
}
