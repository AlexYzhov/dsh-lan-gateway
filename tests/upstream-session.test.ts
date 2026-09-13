/**
 * Unit tests for the shared upstream-session relay against a real loopback
 * HTTP server — the half of the seam the integration suite stubs out with a
 * fake session object. The regression this pins: upstream names its
 * browser-session cookie `dsh-auth-<base64url(sha256(authority))>`, so a
 * matcher looking for `dsh-auth-=` finds nothing, the relay holds no session,
 * and every forwarded request reaches upstream anonymously (401).
 *
 * @module tests/upstream-session
 */

import { createHash } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { UpstreamSessionRelay } from '../src/upstream-session.ts'

/** How the fake index route answers a token exchange. */
type Outcome = 'mint' | 'refuse' | 'other'

interface FakeUpstream {
  port: number
  authority: string
  /** Requests the upstream observed, in order. */
  seen: { url: string | undefined; host: string | undefined }[]
  /** The cookie value minted from now on (so a test can rotate it). */
  value: string
  /** What the token exchange answers from now on. */
  outcome: Outcome
  close: () => Promise<void>
}

/**
 * A loopback stand-in for dsh's launch-token index route: it mints the real
 * cookie name for whatever authority the request names, exactly as
 * `BrowserAuth.authorizeIndex` does.
 */
async function fakeUpstream(options: { outcome?: Outcome; value?: string } = {}): Promise<FakeUpstream> {
  const observed: FakeUpstream['seen'] = []
  let outcome: Outcome = options.outcome ?? 'mint'
  let value = options.value ?? 'v1.payload.sig'
  const server = http.createServer((req, res) => {
    observed.push({ url: req.url, host: req.headers.host })
    if (outcome === 'refuse') {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dsh web authentication required; reopen the URL printed by dsh web.\n')
      return
    }
    if (outcome === 'other') {
      res.writeHead(303, { location: '/', 'set-cookie': ['unrelated=1; Path=/'] })
      res.end()
      return
    }
    const authority = String(req.headers.host)
    const name = `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}`
    res.writeHead(303, {
      location: '/',
      'set-cookie': [`${name}=${value}; Max-Age=604800; Path=/; HttpOnly; SameSite=Strict`],
    })
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const fake: FakeUpstream = {
    port,
    authority: `127.0.0.1:${port}`,
    seen: observed,
    get value() {
      return value
    },
    set value(next: string) {
      value = next
    },
    get outcome() {
      return outcome
    },
    set outcome(next: Outcome) {
      outcome = next
    },
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve())
    }),
  }
  return fake
}

let upstream: FakeUpstream | undefined

afterEach(async () => {
  await upstream?.close()
  upstream = undefined
})

/** A relay pointed at the fake upstream's token URL. */
function relayFor(upstream: FakeUpstream): UpstreamSessionRelay {
  return new UpstreamSessionRelay({
    port: upstream.port,
    authority: upstream.authority,
    authenticatedUrl: () => `http://${upstream.authority}/?token=launch-token`,
  })
}

describe('UpstreamSessionRelay', () => {
  it('holds the dsh-auth-<hash> cookie the token exchange mints', async () => {
    upstream = await fakeUpstream()
    const relay = relayFor(upstream)
    const name = `dsh-auth-${createHash('sha256').update(upstream.authority).digest('base64url')}`

    expect(await relay.cookie()).toBe(`${name}=v1.payload.sig`)
    expect(relay.peek()).toBe(`${name}=v1.payload.sig`)
    // The exchange is a browser-equivalent visit of the launch-token URL, with
    // upstream's own authority as Host — the authority the cookie is bound to.
    expect(upstream.seen[0]).toEqual({ url: '/?token=launch-token', host: upstream.authority })
  })

  it('ignores a Set-Cookie that is not the upstream session', async () => {
    upstream = await fakeUpstream({ outcome: 'other' })
    const relay = relayFor(upstream)

    expect(await relay.cookie()).toBeUndefined()
    expect(relay.peek()).toBeUndefined()
  })

  it('returns undefined when the exchange is refused and re-acquires later', async () => {
    upstream = await fakeUpstream({ outcome: 'refuse' })
    const relay = relayFor(upstream)
    const name = `dsh-auth-${createHash('sha256').update(upstream.authority).digest('base64url')}`

    expect(await relay.cookie()).toBeUndefined()

    // Upstream starts accepting the launch token (secret rotation, restart):
    // the next call exchanges again instead of caching the failure.
    upstream.value = 'v1.fresh.sig'
    upstream.outcome = 'mint'
    expect(await relay.cookie()).toBe(`${name}=v1.fresh.sig`)
    expect(upstream.seen).toHaveLength(2)
  })

  it('forgets a session upstream rejected via invalidate()', async () => {
    upstream = await fakeUpstream()
    const relay = relayFor(upstream)
    const name = `dsh-auth-${createHash('sha256').update(upstream.authority).digest('base64url')}`

    expect(await relay.cookie()).toBe(`${name}=v1.payload.sig`)
    relay.invalidate()
    expect(relay.peek()).toBeUndefined()

    upstream.value = 'v1.rotated.sig'
    expect(await relay.cookie()).toBe(`${name}=v1.rotated.sig`)
    expect(upstream.seen).toHaveLength(2)
  })
})
