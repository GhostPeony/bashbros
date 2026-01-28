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

    const data = await response.json()
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
})
