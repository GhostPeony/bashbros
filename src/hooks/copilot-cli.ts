/**
 * Copilot CLI Hook Integration
 * Seamlessly integrate BashBros with GitHub Copilot CLI
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

export interface CopilotHookConfig {
  version: number
  _bashbros: boolean
  hooks: {
    preToolUse?: CopilotHookEntry[]
    postToolUse?: CopilotHookEntry[]
    sessionEnd?: CopilotHookEntry[]
  }
}

interface CopilotHookEntry {
  type: string
  bash: string
  powershell: string
  timeoutSec?: number
}

const HOOKS_REL_PATH = join('.github', 'hooks', 'bashbros.json')

function getHooksPath(projectDir: string): string {
  return join(projectDir, HOOKS_REL_PATH)
}

function getHooksDir(projectDir: string): string {
  return join(projectDir, '.github', 'hooks')
}

export class CopilotCLIHooks {
  /**
   * Check if copilot command is installed
   */
  static isCopilotInstalled(): boolean {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(cmd, ['copilot'], { stdio: 'pipe', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Install BashBros hooks for Copilot CLI
   */
  static install(projectDir?: string): { success: boolean; message: string } {
    const dir = projectDir || process.cwd()

    if (!this.isCopilotInstalled()) {
      return {
        success: false,
        message: 'Copilot CLI not found. Install GitHub Copilot CLI first.'
      }
    }

    const hooksPath = getHooksPath(dir)

    // Check if already installed
    if (this.isInstalled(dir)) {
      return {
        success: true,
        message: 'BashBros hooks already installed.'
      }
    }

    // Build the config
    const config: CopilotHookConfig = {
      version: 1,
      _bashbros: true,
      hooks: {
        preToolUse: [{
          type: 'command',
          bash: 'bashbros copilot-gate',
          powershell: 'bashbros copilot-gate',
          timeoutSec: 30
        }],
        postToolUse: [{
          type: 'command',
          bash: 'bashbros copilot-record',
          powershell: 'bashbros copilot-record'
        }],
        sessionEnd: [{
          type: 'command',
          bash: 'bashbros session-end',
          powershell: 'bashbros session-end'
        }]
      }
    }

    // Ensure the directory exists
    const hooksDir = getHooksDir(dir)
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true })
    }

    writeFileSync(hooksPath, JSON.stringify(config, null, 2), 'utf-8')

    return {
      success: true,
      message: 'BashBros hooks installed successfully.'
    }
  }

  /**
   * Uninstall BashBros hooks from Copilot CLI
   */
  static uninstall(projectDir?: string): { success: boolean; message: string } {
    const dir = projectDir || process.cwd()
    const hooksPath = getHooksPath(dir)

    if (!existsSync(hooksPath)) {
      return {
        success: true,
        message: 'No hooks file found. Nothing to uninstall.'
      }
    }

    // Only remove if it has our marker
    try {
      const content = readFileSync(hooksPath, 'utf-8')
      const config = JSON.parse(content) as CopilotHookConfig
      if (!config._bashbros) {
        return {
          success: false,
          message: 'Hooks file exists but was not created by BashBros. Refusing to remove.'
        }
      }
    } catch {
      return {
        success: false,
        message: 'Could not read hooks file. Refusing to remove.'
      }
    }

    unlinkSync(hooksPath)

    return {
      success: true,
      message: 'BashBros hooks uninstalled successfully.'
    }
  }

  /**
   * Check if BashBros hooks are installed
   */
  static isInstalled(projectDir?: string): boolean {
    const dir = projectDir || process.cwd()
    const hooksPath = getHooksPath(dir)

    if (!existsSync(hooksPath)) {
      return false
    }

    try {
      const content = readFileSync(hooksPath, 'utf-8')
      const config = JSON.parse(content) as CopilotHookConfig
      return config._bashbros === true
    } catch {
      return false
    }
  }

  /**
   * Get hook status
   */
  static getStatus(projectDir?: string): {
    copilotInstalled: boolean
    hooksInstalled: boolean
    hooks: string[]
  } {
    const dir = projectDir || process.cwd()
    const copilotInstalled = this.isCopilotInstalled()
    const hooksInstalled = this.isInstalled(dir)

    const hooks: string[] = []
    if (hooksInstalled) {
      const hooksPath = getHooksPath(dir)
      try {
        const content = readFileSync(hooksPath, 'utf-8')
        const config = JSON.parse(content) as CopilotHookConfig
        if (config.hooks.preToolUse) hooks.push('preToolUse (gate)')
        if (config.hooks.postToolUse) hooks.push('postToolUse (record)')
        if (config.hooks.sessionEnd) hooks.push('sessionEnd (report)')
      } catch {
        // File unreadable; hooks list stays empty
      }
    }

    return {
      copilotInstalled,
      hooksInstalled,
      hooks
    }
  }
}
