import { execFileSync, execSync } from 'child_process'
import { existsSync, readFileSync, realpathSync } from 'fs'
import { homedir, platform, arch, cpus, totalmem } from 'os'
import { join } from 'path'

export interface SystemProfile {
  // System basics
  platform: string
  arch: string
  shell: string
  cpuCores: number
  memoryGB: number

  // Languages & runtimes
  python: VersionInfo | null
  node: VersionInfo | null
  rust: VersionInfo | null
  go: VersionInfo | null
  java: VersionInfo | null
  ruby: VersionInfo | null

  // Package managers
  npm: VersionInfo | null
  pnpm: VersionInfo | null
  yarn: VersionInfo | null
  pip: VersionInfo | null
  cargo: VersionInfo | null
  brew: VersionInfo | null

  // Dev tools
  git: VersionInfo | null
  docker: VersionInfo | null
  kubectl: VersionInfo | null
  aws: VersionInfo | null
  gcloud: VersionInfo | null

  // AI tools
  claude: boolean
  clawdbot: boolean
  aider: boolean
  ollama: OllamaInfo | null

  // Project context (updated per-project)
  projectType: string | null
  projectDeps: string[]
  envVars: string[] // Names only, not values

  // User patterns (learned over time)
  commonCommands: CommandPattern[]
  workingHours: string | null
  preferredEditor: string | null

  // Last updated
  timestamp: Date
}

export interface VersionInfo {
  version: string
  path: string
}

export interface OllamaInfo {
  version: string
  models: string[]
}

export interface CommandPattern {
  command: string
  frequency: number
  lastUsed: Date
}

// Allowlist of safe commands to probe
const SAFE_VERSION_COMMANDS: Record<string, string[]> = {
  python: ['--version'],
  python3: ['--version'],
  node: ['--version'],
  rustc: ['--version'],
  go: ['version'],
  java: ['-version'],
  ruby: ['--version'],
  npm: ['--version'],
  pnpm: ['--version'],
  yarn: ['--version'],
  pip: ['--version'],
  pip3: ['--version'],
  cargo: ['--version'],
  brew: ['--version'],
  git: ['--version'],
  docker: ['--version'],
  kubectl: ['version', '--client', '--short'],
  aws: ['--version'],
  gcloud: ['--version'],
  ollama: ['--version'],
  code: ['--version'],
  cursor: ['--version'],
  vim: ['--version'],
  nvim: ['--version'],
  nano: ['--version'],
  emacs: ['--version']
}

export class SystemProfiler {
  private profile: SystemProfile | null = null
  private profilePath: string

  constructor() {
    this.profilePath = join(homedir(), '.bashbros', 'system-profile.json')
  }

  async scan(): Promise<SystemProfile> {
    const profile: SystemProfile = {
      platform: platform(),
      arch: arch(),
      shell: this.detectShell(),
      cpuCores: cpus().length,
      memoryGB: Math.round(totalmem() / (1024 ** 3)),

      python: this.getVersionSafe('python') || this.getVersionSafe('python3'),
      node: this.getVersionSafe('node'),
      rust: this.getVersionSafe('rustc'),
      go: this.getVersionSafe('go'),
      java: this.getVersionSafe('java'),
      ruby: this.getVersionSafe('ruby'),

      npm: this.getVersionSafe('npm'),
      pnpm: this.getVersionSafe('pnpm'),
      yarn: this.getVersionSafe('yarn'),
      pip: this.getVersionSafe('pip') || this.getVersionSafe('pip3'),
      cargo: this.getVersionSafe('cargo'),
      brew: this.getVersionSafe('brew'),

      git: this.getVersionSafe('git'),
      docker: this.getVersionSafe('docker'),
      kubectl: this.getVersionSafe('kubectl'),
      aws: this.getVersionSafe('aws'),
      gcloud: this.getVersionSafe('gcloud'),

      claude: this.commandExists('claude'),
      clawdbot: this.commandExists('clawdbot'),
      aider: this.commandExists('aider'),
      ollama: this.getOllamaInfo(),

      projectType: null,
      projectDeps: [],
      envVars: this.getEnvVarNames(),

      commonCommands: [],
      workingHours: null,
      preferredEditor: this.detectEditor(),

      timestamp: new Date()
    }

    this.profile = profile
    this.save()

    return profile
  }

  scanProject(projectPath: string): Partial<SystemProfile> {
    // SECURITY: Resolve symlinks and validate path
    let resolvedPath: string
    try {
      resolvedPath = realpathSync(projectPath)
    } catch {
      resolvedPath = projectPath
    }

    const updates: Partial<SystemProfile> = {
      projectType: this.detectProjectType(resolvedPath),
      projectDeps: this.detectDependencies(resolvedPath)
    }

    if (this.profile) {
      this.profile = { ...this.profile, ...updates }
      this.save()
    }

    return updates
  }

  private detectShell(): string {
    if (platform() === 'win32') {
      return process.env.COMSPEC || 'cmd.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }

  /**
   * SECURITY FIX: Use execFileSync with array args instead of string concatenation
   */
  private getVersionSafe(cmd: string): VersionInfo | null {
    const args = SAFE_VERSION_COMMANDS[cmd]
    if (!args) {
      return null // Only allow whitelisted commands
    }

    try {
      // SECURITY: Use execFileSync with explicit args array
      const output = execFileSync(cmd, args, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }).trim()

      const version = this.parseVersion(output)
      const path = this.getCommandPathSafe(cmd)

      return { version, path }
    } catch {
      return null
    }
  }

  private parseVersion(output: string): string {
    // Extract version number from various formats
    const match = output.match(/(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/i)
    return match ? match[1] : output.split('\n')[0].slice(0, 50)
  }

  /**
   * SECURITY FIX: Use execFileSync for which/where command
   */
  private getCommandPathSafe(cmd: string): string {
    try {
      const whichCmd = platform() === 'win32' ? 'where' : 'which'
      // SECURITY: Use execFileSync with array args
      const result = execFileSync(whichCmd, [cmd], {
        encoding: 'utf-8',
        timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      }).trim().split('\n')[0]

      return result
    } catch {
      return cmd
    }
  }

  private commandExists(cmd: string): boolean {
    try {
      const whichCmd = platform() === 'win32' ? 'where' : 'which'
      // SECURITY: Use execFileSync with array args
      execFileSync(whichCmd, [cmd], {
        stdio: 'pipe',
        timeout: 3000,
        windowsHide: true
      })
      return true
    } catch {
      return false
    }
  }

  private getOllamaInfo(): OllamaInfo | null {
    try {
      // SECURITY: Use execFileSync with array args
      const version = execFileSync('ollama', ['--version'], {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true
      }).trim()

      let models: string[] = []
      try {
        const modelList = execFileSync('ollama', ['list'], {
          encoding: 'utf-8',
          timeout: 10000,
          windowsHide: true
        })
        models = modelList
          .split('\n')
          .slice(1) // Skip header
          .map(line => line.split(/\s+/)[0])
          .filter(Boolean)
      } catch {
        // Ollama might not have models or not be running
      }

      return { version, models }
    } catch {
      return null
    }
  }

  private getEnvVarNames(): string[] {
    // Return environment variable names (not values) for context
    // Only include safe, non-sensitive variable names
    const safePatterns = [
      /^PATH$/i,
      /^HOME$/i,
      /^USER$/i,
      /^SHELL$/i,
      /^TERM$/i,
      /^LANG$/i,
      /^NODE_VERSION$/i,
      /^PYTHON.*VERSION$/i,
      /^JAVA_HOME$/i,
      /^GOPATH$/i,
      /^EDITOR$/i,
      /^VISUAL$/i
    ]

    return Object.keys(process.env).filter(key =>
      safePatterns.some(pattern => pattern.test(key))
    )
  }

  private detectEditor(): string | null {
    const editor = process.env.EDITOR || process.env.VISUAL

    if (editor) return editor

    // Check for common editors
    const editors = ['code', 'cursor', 'vim', 'nvim', 'nano', 'emacs']
    for (const ed of editors) {
      if (this.commandExists(ed)) return ed
    }

    return null
  }

  private detectProjectType(projectPath: string): string | null {
    const checks: [string, string][] = [
      ['package.json', 'node'],
      ['pyproject.toml', 'python'],
      ['requirements.txt', 'python'],
      ['Cargo.toml', 'rust'],
      ['go.mod', 'go'],
      ['pom.xml', 'java'],
      ['build.gradle', 'java'],
      ['Gemfile', 'ruby'],
      ['composer.json', 'php']
    ]

    for (const [file, type] of checks) {
      const filePath = join(projectPath, file)
      // SECURITY: Check file exists without following symlinks first
      if (existsSync(filePath)) {
        try {
          // Verify it resolves to expected location
          const realPath = realpathSync(filePath)
          if (realPath.startsWith(realpathSync(projectPath))) {
            return type
          }
        } catch {
          // Skip if can't resolve
        }
      }
    }

    return null
  }

  private detectDependencies(projectPath: string): string[] {
    const deps: string[] = []

    // Check package.json
    const pkgPath = join(projectPath, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        // SECURITY: Verify path resolves within project
        const realPkgPath = realpathSync(pkgPath)
        if (realPkgPath.startsWith(realpathSync(projectPath))) {
          const pkg = JSON.parse(readFileSync(realPkgPath, 'utf-8'))
          deps.push(...Object.keys(pkg.dependencies || {}))
          deps.push(...Object.keys(pkg.devDependencies || {}))
        }
      } catch { /* ignore */ }
    }

    // Check requirements.txt
    const reqPath = join(projectPath, 'requirements.txt')
    if (existsSync(reqPath)) {
      try {
        // SECURITY: Verify path resolves within project
        const realReqPath = realpathSync(reqPath)
        if (realReqPath.startsWith(realpathSync(projectPath))) {
          const reqs = readFileSync(realReqPath, 'utf-8')
          const packages = reqs.split('\n')
            .map(line => line.split(/[=<>]/)[0].trim())
            .filter(Boolean)
          deps.push(...packages)
        }
      } catch { /* ignore */ }
    }

    return deps.slice(0, 100) // Limit to top 100
  }

  load(): SystemProfile | null {
    if (existsSync(this.profilePath)) {
      try {
        const data = readFileSync(this.profilePath, 'utf-8')
        this.profile = JSON.parse(data)
        return this.profile
      } catch {
        return null
      }
    }
    return null
  }

  private save(): void {
    try {
      const { writeFileSync, mkdirSync, chmodSync } = require('fs')
      const dir = join(homedir(), '.bashbros')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 }) // SECURITY: Restrict directory permissions
      }
      const filePath = this.profilePath
      writeFileSync(filePath, JSON.stringify(this.profile, null, 2))

      // SECURITY: Restrict file permissions (owner read/write only)
      try {
        chmodSync(filePath, 0o600)
      } catch {
        // Windows doesn't support chmod the same way
      }
    } catch { /* ignore */ }
  }

  get(): SystemProfile | null {
    return this.profile
  }

  toContext(): string {
    if (!this.profile) return 'System profile not available.'

    const p = this.profile
    const lines: string[] = [
      `## System Context`,
      `- Platform: ${p.platform} (${p.arch})`,
      `- Shell: ${p.shell}`,
      `- CPU: ${p.cpuCores} cores, RAM: ${p.memoryGB}GB`,
      ''
    ]

    if (p.python) lines.push(`- Python: ${p.python.version}`)
    if (p.node) lines.push(`- Node: ${p.node.version}`)
    if (p.rust) lines.push(`- Rust: ${p.rust.version}`)
    if (p.go) lines.push(`- Go: ${p.go.version}`)

    if (p.git) lines.push(`- Git: ${p.git.version}`)
    if (p.docker) lines.push(`- Docker: ${p.docker.version}`)

    if (p.ollama) {
      lines.push(`- Ollama: ${p.ollama.version}`)
      if (p.ollama.models.length > 0) {
        lines.push(`  Models: ${p.ollama.models.join(', ')}`)
      }
    }

    if (p.projectType) {
      lines.push('')
      lines.push(`## Project: ${p.projectType}`)
      if (p.projectDeps.length > 0) {
        lines.push(`Dependencies: ${p.projectDeps.slice(0, 20).join(', ')}`)
      }
    }

    return lines.join('\n')
  }
}
