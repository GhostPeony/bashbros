import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
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

      python: this.getVersion('python', '--version'),
      node: this.getVersion('node', '--version'),
      rust: this.getVersion('rustc', '--version'),
      go: this.getVersion('go', 'version'),
      java: this.getVersion('java', '-version'),
      ruby: this.getVersion('ruby', '--version'),

      npm: this.getVersion('npm', '--version'),
      pnpm: this.getVersion('pnpm', '--version'),
      yarn: this.getVersion('yarn', '--version'),
      pip: this.getVersion('pip', '--version'),
      cargo: this.getVersion('cargo', '--version'),
      brew: this.getVersion('brew', '--version'),

      git: this.getVersion('git', '--version'),
      docker: this.getVersion('docker', '--version'),
      kubectl: this.getVersion('kubectl', 'version --client --short'),
      aws: this.getVersion('aws', '--version'),
      gcloud: this.getVersion('gcloud', '--version'),

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
    const updates: Partial<SystemProfile> = {
      projectType: this.detectProjectType(projectPath),
      projectDeps: this.detectDependencies(projectPath)
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

  private getVersion(cmd: string, args: string): VersionInfo | null {
    try {
      const output = execSync(`${cmd} ${args}`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim()

      const version = this.parseVersion(output)
      const path = this.getCommandPath(cmd)

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

  private getCommandPath(cmd: string): string {
    try {
      const which = platform() === 'win32' ? 'where' : 'which'
      return execSync(`${which} ${cmd}`, {
        encoding: 'utf-8',
        timeout: 3000
      }).trim().split('\n')[0]
    } catch {
      return cmd
    }
  }

  private commandExists(cmd: string): boolean {
    try {
      const which = platform() === 'win32' ? 'where' : 'which'
      execSync(`${which} ${cmd}`, { stdio: 'pipe', timeout: 3000 })
      return true
    } catch {
      return false
    }
  }

  private getOllamaInfo(): OllamaInfo | null {
    try {
      const version = execSync('ollama --version', {
        encoding: 'utf-8',
        timeout: 5000
      }).trim()

      let models: string[] = []
      try {
        const modelList = execSync('ollama list', {
          encoding: 'utf-8',
          timeout: 10000
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
    return Object.keys(process.env).filter(key =>
      // Filter to relevant dev-related vars
      key.includes('PATH') ||
      key.includes('HOME') ||
      key.includes('NODE') ||
      key.includes('PYTHON') ||
      key.includes('JAVA') ||
      key.includes('EDITOR') ||
      key.includes('SHELL') ||
      key.includes('TERM')
    )
  }

  private detectEditor(): string | null {
    const editor = process.env.EDITOR || process.env.VISUAL

    if (editor) return editor

    // Check for common editors
    const editors = ['code', 'cursor', 'vim', 'nvim', 'nano', 'emacs', 'sublime']
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
      if (existsSync(join(projectPath, file))) {
        return type
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
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        deps.push(...Object.keys(pkg.dependencies || {}))
        deps.push(...Object.keys(pkg.devDependencies || {}))
      } catch { /* ignore */ }
    }

    // Check requirements.txt
    const reqPath = join(projectPath, 'requirements.txt')
    if (existsSync(reqPath)) {
      try {
        const reqs = readFileSync(reqPath, 'utf-8')
        const packages = reqs.split('\n')
          .map(line => line.split(/[=<>]/)[0].trim())
          .filter(Boolean)
        deps.push(...packages)
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
      const { writeFileSync, mkdirSync } = require('fs')
      const dir = join(homedir(), '.bashbros')
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
      writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2))
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
