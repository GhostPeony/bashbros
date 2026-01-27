import { describe, it, expect } from 'vitest'
import { TaskRouter } from './router.js'

describe('TaskRouter', () => {
  describe('simple commands -> bro', () => {
    const router = new TaskRouter()

    it('routes ls to bro', () => {
      const result = router.route('ls -la')
      expect(result.decision).toBe('bro')
    })

    it('routes cat to bro', () => {
      const result = router.route('cat file.txt')
      expect(result.decision).toBe('bro')
    })

    it('routes pwd to bro', () => {
      const result = router.route('pwd')
      expect(result.decision).toBe('bro')
    })

    it('routes mkdir to bro', () => {
      const result = router.route('mkdir test')
      expect(result.decision).toBe('bro')
    })

    it('routes git status to bro', () => {
      const result = router.route('git status')
      expect(result.decision).toBe('bro')
    })

    it('routes git branch to bro', () => {
      const result = router.route('git branch')
      expect(result.decision).toBe('bro')
    })

    it('routes version checks to bro', () => {
      expect(router.route('python --version').decision).toBe('bro')
      expect(router.route('node --version').decision).toBe('bro')
      expect(router.route('npm --version').decision).toBe('bro')
    })

    it('routes simple grep to bro', () => {
      const result = router.route('grep -r "pattern" src/')
      expect(result.decision).toBe('bro')
    })

    it('routes simple find to bro', () => {
      const result = router.route('find . -name "*.ts"')
      expect(result.decision).toBe('bro')
    })
  })

  describe('complex commands -> main', () => {
    const router = new TaskRouter()

    it('routes refactor requests to main', () => {
      const result = router.route('refactor this function')
      expect(result.decision).toBe('main')
    })

    it('routes implement requests to main', () => {
      const result = router.route('implement a new feature')
      expect(result.decision).toBe('main')
    })

    it('routes explain requests to main', () => {
      const result = router.route('explain this code')
      expect(result.decision).toBe('main')
    })

    it('routes debug requests to main', () => {
      const result = router.route('debug the login issue')
      expect(result.decision).toBe('main')
    })

    it('routes fix requests to main', () => {
      const result = router.route('fix the bug')
      expect(result.decision).toBe('main')
    })

    it('routes why questions to main', () => {
      const result = router.route('why is this failing?')
      expect(result.decision).toBe('main')
    })

    it('routes how questions to main', () => {
      expect(router.route('how do I do this?').decision).toBe('main')
      expect(router.route('how can I improve this?').decision).toBe('main')
      expect(router.route('how should I structure this?').decision).toBe('main')
    })

    it('routes git rebase to main', () => {
      const result = router.route('git rebase main')
      expect(result.decision).toBe('main')
    })

    it('routes git merge to main', () => {
      const result = router.route('git merge feature')
      expect(result.decision).toBe('main')
    })

    it('routes git reset to main', () => {
      const result = router.route('git reset --hard')
      expect(result.decision).toBe('main')
    })
  })

  describe('parallel commands -> both', () => {
    const router = new TaskRouter()

    it('routes npm test to both', () => {
      const result = router.route('npm test')
      expect(result.decision).toBe('both')
    })

    it('routes pytest to both', () => {
      const result = router.route('pytest')
      expect(result.decision).toBe('both')
    })

    it('routes npm run build to both', () => {
      const result = router.route('npm run build')
      expect(result.decision).toBe('both')
    })

    it('routes docker build to both', () => {
      const result = router.route('docker build .')
      expect(result.decision).toBe('both')
    })
  })

  describe('heuristics', () => {
    const router = new TaskRouter()

    it('routes short unknown commands to bro', () => {
      const result = router.route('date')
      expect(result.decision).toBe('bro')
      expect(result.confidence).toBeLessThan(0.9) // Lower confidence
    })

    it('routes commands with pipes to main', () => {
      const result = router.route('cat file | grep pattern')
      expect(result.decision).toBe('main')
    })

    it('routes commands with redirects to main', () => {
      const result = router.route('echo hello > file.txt')
      expect(result.decision).toBe('main')
    })

    it('routes commands with subshells to main when complex', () => {
      // Short commands are considered simple even with subshells
      // Longer commands with subshells route to main
      const result = router.route('process some data with $(complex subshell)')
      expect(result.decision).toBe('main')
    })
  })

  describe('confidence levels', () => {
    const router = new TaskRouter()

    it('has high confidence for matched rules', () => {
      const result = router.route('ls -la')
      expect(result.confidence).toBe(0.9)
    })

    it('has medium confidence for heuristic matches', () => {
      const result = router.route('whoami')
      expect(result.confidence).toBe(0.6)
    })

    it('has low confidence for unknown complex commands', () => {
      // Commands with pipes/redirects are treated as complex
      const result = router.route('some long unknown command | another command > file')
      expect(result.confidence).toBe(0.5)
    })
  })

  describe('addRule', () => {
    it('adds custom rules with priority', () => {
      const router = new TaskRouter()
      router.addRule(/^mycommand/, 'bro', 'Custom command')

      const result = router.route('mycommand arg1 arg2')
      expect(result.decision).toBe('bro')
      expect(result.reason).toBe('Custom command')
    })
  })

  describe('updateProfile', () => {
    it('adds project-specific rules for python', () => {
      const router = new TaskRouter()
      router.updateProfile({
        platform: 'linux',
        arch: 'x64',
        shell: 'bash',
        timestamp: new Date().toISOString(),
        projectType: 'python'
      })

      expect(router.route('python -c "print(1)"').decision).toBe('bro')
      expect(router.route('pip install requests').decision).toBe('bro')
    })

    it('adds project-specific rules for node', () => {
      const router = new TaskRouter()
      router.updateProfile({
        platform: 'linux',
        arch: 'x64',
        shell: 'bash',
        timestamp: new Date().toISOString(),
        projectType: 'node'
      })

      expect(router.route('npx prettier --write').decision).toBe('bro')
      expect(router.route('npm install lodash').decision).toBe('bro')
    })
  })
})
