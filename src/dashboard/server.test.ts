import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { DashboardServer } from './server.js'

describe('DashboardServer', () => {
  let server: DashboardServer
  const TEST_PORT = 17890

  beforeAll(async () => {
    server = new DashboardServer({ port: TEST_PORT, bind: '127.0.0.1' })
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('should respond to health check', async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/health`)
    expect(response.ok).toBe(true)

    const data = await response.json() as { status: string }
    expect(data.status).toBe('ok')
  })

  it('should return events from API', async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/events`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
  })

  it('should return stats from API', async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/stats`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(data).toHaveProperty('totalEvents')
    expect(data).toHaveProperty('pendingBlocks')
  })

  it('should return security summary with expected shape', async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/security/summary`)
    expect(response.ok).toBe(true)

    const data = await response.json() as Record<string, unknown>
    expect(data).toHaveProperty('totalCommands24h')
    expect(data).toHaveProperty('blockedCount24h')
    expect(data).toHaveProperty('avgRiskScore24h')
    expect(data).toHaveProperty('riskDistribution')
    expect(data).toHaveProperty('violationTypes')
    expect(data).toHaveProperty('highRiskCount24h')
    expect(typeof data.totalCommands24h).toBe('number')
    expect(typeof data.blockedCount24h).toBe('number')
    expect(typeof data.avgRiskScore24h).toBe('number')
    expect(Array.isArray(data.violationTypes)).toBe(true)
  })

  it('should return blocked commands as array', async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/security/blocked-commands`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
  })

  it('should respect limit param on blocked commands', async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/security/blocked-commands?limit=5`)
    expect(response.ok).toBe(true)

    const data = await response.json()
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeLessThanOrEqual(5)
  })

  it('should return agent integration status', async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/agents/status`)
    expect(response.ok).toBe(true)

    const data = await response.json() as { agents: Array<{ name: string; key: string; installed: boolean; hooksInstalled: boolean }> }
    expect(data).toHaveProperty('agents')
    expect(Array.isArray(data.agents)).toBe(true)
    expect(data.agents).toHaveLength(5)

    for (const agent of data.agents) {
      expect(agent).toHaveProperty('name')
      expect(agent).toHaveProperty('key')
      expect(typeof agent.installed).toBe('boolean')
      expect(typeof agent.hooksInstalled).toBe('boolean')
    }
  })
})
