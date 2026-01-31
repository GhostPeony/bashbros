import { describe, it, expect } from 'vitest'
import { getDefaultConfig } from './config.js'

describe('sessionStart config', () => {
  it('has sessionStart defaults', () => {
    const config = getDefaultConfig()
    expect(config.sessionStart).toBeDefined()
    expect(config.sessionStart.enabled).toBe(true)
    expect(config.sessionStart.collectMetadata).toBe(true)
    expect(config.sessionStart.ollamaStatus).toBe(false)
    expect(config.sessionStart.preloadContext).toBe(true)
  })
})
