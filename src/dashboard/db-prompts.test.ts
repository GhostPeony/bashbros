import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DashboardDB } from './db.js'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = '.bashbros-prompts-test.db'

describe('DashboardDB - User Prompts', () => {
  let db: DashboardDB

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    db = new DashboardDB(TEST_DB)
  })

  afterEach(() => {
    db.close()
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
  })

  describe('insertUserPrompt + getUserPrompts', () => {
    it('should insert and retrieve a prompt', () => {
      const id = db.insertUserPrompt({
        promptText: 'Hello, what is TypeScript?',
        cwd: '/home/user/project'
      })

      expect(id).toBeDefined()

      const prompts = db.getUserPrompts({ limit: 10 })
      expect(prompts).toHaveLength(1)
      expect(prompts[0].id).toBe(id)
      expect(prompts[0].promptText).toBe('Hello, what is TypeScript?')
      expect(prompts[0].promptLength).toBe(26)
      expect(prompts[0].cwd).toBe('/home/user/project')
    })

    it('should compute word count correctly', () => {
      db.insertUserPrompt({ promptText: 'one two three four five' })

      const prompts = db.getUserPrompts()
      expect(prompts[0].wordCount).toBe(5)
    })

    it('should handle empty prompt', () => {
      db.insertUserPrompt({ promptText: '' })

      const prompts = db.getUserPrompts()
      expect(prompts[0].promptText).toBe('')
      expect(prompts[0].wordCount).toBe(0)
      expect(prompts[0].promptLength).toBe(0)
    })

    it('should handle whitespace-only prompt', () => {
      db.insertUserPrompt({ promptText: '   \n\t  ' })

      const prompts = db.getUserPrompts()
      expect(prompts[0].wordCount).toBe(0)
    })

    it('should truncate prompt text at 50KB but preserve original length', () => {
      const longText = 'a'.repeat(60000)
      db.insertUserPrompt({ promptText: longText })

      const prompts = db.getUserPrompts()
      expect(prompts[0].promptText.length).toBe(50000)
      // Original length is preserved
      expect(prompts[0].promptLength).toBe(60000)
    })

    it('should associate prompt with session', () => {
      const sessionId = db.insertSession({
        agent: 'claude-code',
        pid: 1234,
        workingDir: '/tmp'
      })

      db.insertUserPrompt({ sessionId, promptText: 'session prompt' })
      db.insertUserPrompt({ promptText: 'no session prompt' })

      const sessionPrompts = db.getUserPrompts({ sessionId })
      expect(sessionPrompts).toHaveLength(1)
      expect(sessionPrompts[0].promptText).toBe('session prompt')
      expect(sessionPrompts[0].sessionId).toBe(sessionId)
    })

    it('should filter by since', () => {
      db.insertUserPrompt({ promptText: 'old prompt' })

      const futureDate = new Date(Date.now() + 60000)
      const prompts = db.getUserPrompts({ since: futureDate })
      expect(prompts).toHaveLength(0)

      const pastDate = new Date(Date.now() - 60000)
      const allPrompts = db.getUserPrompts({ since: pastDate })
      expect(allPrompts).toHaveLength(1)
    })
  })

  describe('getUserPromptStats', () => {
    it('should return zero stats for empty DB', () => {
      const stats = db.getUserPromptStats()
      expect(stats.totalPrompts).toBe(0)
      expect(stats.totalWords).toBe(0)
      expect(stats.totalChars).toBe(0)
      expect(stats.avgPromptLength).toBe(0)
      expect(stats.avgWordCount).toBe(0)
      expect(stats.longestPrompt).toBe(0)
      expect(stats.last24h).toBe(0)
      expect(stats.promptsPerSession).toBe(0)
    })

    it('should compute stats correctly', () => {
      db.insertUserPrompt({ promptText: 'short' })           // 5 chars, 1 word
      db.insertUserPrompt({ promptText: 'a bit longer text' }) // 17 chars, 4 words
      db.insertUserPrompt({ promptText: 'medium length' })     // 13 chars, 2 words

      const stats = db.getUserPromptStats()
      expect(stats.totalPrompts).toBe(3)
      expect(stats.totalWords).toBe(7)
      expect(stats.totalChars).toBe(35)
      expect(stats.longestPrompt).toBe(17)
      expect(stats.last24h).toBe(3)
    })

    it('should compute promptsPerSession', () => {
      const s1 = db.insertSession({ agent: 'claude', pid: 1, workingDir: '/tmp' })
      const s2 = db.insertSession({ agent: 'claude', pid: 2, workingDir: '/tmp' })

      db.insertUserPrompt({ sessionId: s1, promptText: 'p1' })
      db.insertUserPrompt({ sessionId: s1, promptText: 'p2' })
      db.insertUserPrompt({ sessionId: s1, promptText: 'p3' })
      db.insertUserPrompt({ sessionId: s2, promptText: 'p4' })

      const stats = db.getUserPromptStats()
      // s1 has 3, s2 has 1, avg = 2
      expect(stats.promptsPerSession).toBe(2)
    })
  })

  describe('achievement stats include prompt fields', () => {
    it('should include prompt fields in getAchievementStats', () => {
      db.insertUserPrompt({ promptText: 'hello world' })
      db.insertUserPrompt({ promptText: 'another prompt with more words here' })

      const stats = db.getAchievementStats()
      expect(stats.totalPrompts).toBe(2)
      expect(stats.totalPromptWords).toBe(8) // 2 + 6
      expect(stats.longestPromptLength).toBe(35)
    })

    it('should return zero prompt fields for empty DB', () => {
      const stats = db.getAchievementStats()
      expect(stats.totalPrompts).toBe(0)
      expect(stats.totalPromptWords).toBe(0)
      expect(stats.totalPromptChars).toBe(0)
      expect(stats.longestPromptLength).toBe(0)
      expect(stats.promptsPerSession).toBe(0)
    })
  })

  describe('conversationalist badge', () => {
    it('should award bronze tier at 1 prompt', () => {
      db.insertUserPrompt({ promptText: 'my first prompt' })

      const stats = db.getAchievementStats()
      const badges = db.computeAchievements(stats)
      const convo = badges.find(b => b.id === 'conversationalist')

      expect(convo).toBeDefined()
      expect(convo!.tier).toBe(1)
      expect(convo!.tierName).toBe('Bronze')
    })

    it('should be locked with 0 prompts', () => {
      const stats = db.getAchievementStats()
      const badges = db.computeAchievements(stats)
      const convo = badges.find(b => b.id === 'conversationalist')

      expect(convo).toBeDefined()
      expect(convo!.tier).toBe(0)
      expect(convo!.tierName).toBe('Locked')
    })
  })

  describe('XP includes prompt contribution', () => {
    it('should add XP from prompts', () => {
      // Insert 10 prompts with 5 words each = 50 words
      for (let i = 0; i < 10; i++) {
        db.insertUserPrompt({ promptText: 'one two three four five' })
      }

      const stats = db.getAchievementStats()
      const badges = db.computeAchievements(stats)
      const xp = db.computeXP(stats, badges)

      // Base: +1 per 2 prompts = 5, +1 per 500 words = 0 (50 words < 500)
      // Plus badge XP for conversationalist bronze (tier 1, 50 XP)
      // Total should include prompt contribution
      expect(xp.totalXP).toBeGreaterThan(0)

      // Compare with no-prompt XP
      const emptyDb = new DashboardDB('.bashbros-prompts-empty-test.db')
      const emptyStats = emptyDb.getAchievementStats()
      const emptyBadges = emptyDb.computeAchievements(emptyStats)
      const emptyXp = emptyDb.computeXP(emptyStats, emptyBadges)
      emptyDb.close()
      if (existsSync('.bashbros-prompts-empty-test.db')) unlinkSync('.bashbros-prompts-empty-test.db')

      expect(xp.totalXP).toBeGreaterThan(emptyXp.totalXP)
    })
  })

  describe('cleanup', () => {
    it('should not delete recent prompts', () => {
      db.insertUserPrompt({ promptText: 'recent prompt' })

      // Cleanup with 30 days retention should not delete recent prompts
      db.cleanup(30)

      const remaining = db.getUserPrompts()
      expect(remaining).toHaveLength(1)
    })
  })
})
