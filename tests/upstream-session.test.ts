/**
 * Unit tests for the upstream session relay's exchange: a live stub of dsh's
 * index route mints the per-authority signed cookie the 0.1.2 generation
 * names `dsh-auth-<b64url(sha256(authority))>`. The relay must recognize that
 * exact real-world name — a regression guard for the `dsh-auth-=` matcher bug
 * that silently dropped every session, holding none and 401ing every forward
 * — and must cache the result and re-acquire after `invalidate`.
 *
 * @module tests/upstream-session
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  UpstreamSessionRelay,
  type UpstreamSessionRelayOptions,
} from '../src/upstream-session.ts'

/** The cookie name a real dsh 0.1.2 minted for authority 127.0.0.1:3080. */
const REAL_COOKIE = 'dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw=v1.session'

interface Stub {
  server: Server
  port: number
  hits: number
}

const stubs: Stub[] = []

/** A stub index route: 303 + configurable Set-Cookie entries, counting hits. */
async function startStub(setCookie: string[]): Promise<Stub> {
  const stub: Stub = {
    server: createServer((_req, res) => {
      stub.hits += 1
      res.statusCode = 303
      res.setHeader('location', '/')
      res.setHeader('set-cookie', setCookie)
      res.end()
    }),
    port: 0,
    hits: 0,
  }
  stub.server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => {
    stub.server.once('listening', resolve)
  })
  stub.port = (stub.server.address() as AddressInfo).port
  stubs.push(stub)
  return stub
}

afterEach(async () => {
  for (const stub of stubs.splice(0)) {
    await new Promise<void>((resolve) => {
      stub.server.close(() => resolve())
    })
  }
})

function relayFor(stub: Stub, over: Partial<UpstreamSessionRelayOptions> = {}): UpstreamSessionRelay {
  return new UpstreamSessionRelay({
    port: stub.port,
    authenticatedUrl: () => `http://127.0.0.1:${stub.port}/?token=test-token`,
    ...over,
  })
}

describe('UpstreamSessionRelay exchange', () => {
  it('accepts the real per-authority cookie name', async () => {
    const stub = await startStub([`${REAL_COOKIE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict`])
    const relay = relayFor(stub)
    await expect(relay.cookie()).resolves.toBe('dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw=v1.session')
    expect(stub.hits).toBe(1)
  })

  it('picks the dsh-auth-* entry among foreign cookies', async () => {
    const stub = await startStub(['session=foreign; Path=/', `${REAL_COOKIE}; Max-Age=2592000; Path=/`])
    const relay = relayFor(stub)
    await expect(relay.cookie()).resolves.toBe('dsh-auth-VPhEEcLKeqRDBoBalzN2Nm7CnfxKhLE00pKIDWxt1sw=v1.session')
  })

  it('holds no session when upstream sets no dsh-auth-* cookie', async () => {
    const stub = await startStub(['session=foreign; Path=/'])
    const relay = relayFor(stub)
    await expect(relay.cookie()).resolves.toBeUndefined()
    expect(stub.hits).toBe(1)
  })

  it('caches the session across calls and re-acquires after invalidate', async () => {
    const stub = await startStub([`${REAL_COOKIE}; Max-Age=2592000; Path=/`])
    const relay = relayFor(stub)
    await relay.cookie()
    await relay.cookie()
    expect(stub.hits).toBe(1)
    relay.invalidate()
    await relay.cookie()
    expect(stub.hits).toBe(2)
  })

  it('never exchanges when authenticatedUrl yields nothing', async () => {
    const stub = await startStub([`${REAL_COOKIE}; Max-Age=2592000; Path=/`])
    const relay = relayFor(stub, { authenticatedUrl: () => undefined })
    await expect(relay.cookie()).resolves.toBeUndefined()
    expect(stub.hits).toBe(0)
  })
})
