/**
 * Shared upstream session relay for session-capable dsh bases (>= 0.1.2).
 *
 * When dsh added browser-session authentication it stopped trusting a loopback
 * Host header alone: every `/api` request (and the remote WebSocket mux) must
 * now present a signed cookie bound to the authority it names
 * (`dsh-auth-<sha256(authority)>`), minted at the index route by exchanging the
 * process launch token. A reverse proxy that rewrites Host to loopback — which
 * is what this gateway does — therefore gets a 401 no matter how the Host is
 * forged. The gateway cannot mint that cookie itself (the signing secret lives
 * in dsh's credential provider), so it does exactly what a browser does: on the
 * loopback transport it visits the launch-token URL, keeps the Set-Cookie it
 * earns, and replays that one shared session on every request it forwards.
 *
 * Semantics match the pre-existing "single password = single operator" model:
 * whoever passes the gateway's own login rides this one upstream session. It is
 * not multi-user authorization, and upstream (which holds the secret) remains
 * the actual authority over what the session may do.
 *
 * The relay is a no-op on a base without browser sessions: acquisition fails
 * and `cookie()` returns undefined, so the gateway simply forwards without a
 * session cookie exactly as it did against an older dsh.
 *
 * @module @riceawa/dsh-lan-gateway/upstream-session
 */

import http from 'node:http'

/** The session-cookie name prefix upstream signs (`dsh-auth-<b64url(sha256)>`). */
const UPSTREAM_COOKIE_PREFIX = 'dsh-auth-'

/** A held session: the raw `name=value` and the epoch-millis it lapses. */
interface HeldCookie {
  header: string
  expiresAt: number
}

/** The minimal shared-session contract the gateway consumes. */
export interface UpstreamSession {
  /** The current `name=value` without triggering a re-acquisition. */
  peek(): string | undefined
  /** The current `name=value`, re-acquiring when missing or stale. Never throws. */
  cookie(): Promise<string | undefined>
  /** Forget a session upstream rejected, so the next request re-acquires. */
  invalidate(): void
}

export interface UpstreamSessionRelayOptions {
  /** The loopback dsh port both the exchange and every forward target. */
  port: number
  /** A host[:port] to send as Host on the exchange (default `127.0.0.1:<port>`). */
  authority?: string
  /**
   * Returns the launch-token-carrying root URL for the upstream origin
   * (`http://127.0.0.1:<port>/?token=…`), or undefined when the upstream does
   * not expose one. Re-read on every acquisition so a fresh token after an
   * upstream restart is picked up.
   */
  authenticatedUrl: () => string | undefined
}

/** Split `name=value; Path=/; …` into the `name=value` request-Cookie fragment. */
function nameValueOnly(setCookie: string): string {
  const semi = setCookie.indexOf(';')
  return (semi === -1 ? setCookie : setCookie.slice(0, semi)).trim()
}

/** Pull the Max-Age attribute (seconds) out of a Set-Cookie string, if any. */
function maxAgeSeconds(setCookie: string): number | undefined {
  const match = /\bMax-Age=(\d+)\b/i.exec(setCookie)
  return match === null ? undefined : Number(match[1])
}

/** The result of one token exchange. */
interface ExchangeResult {
  header: string
  expiresAt: number
}

/**
 * Perform the token exchange over loopback: GET the launch-token URL with the
 * upstream authority as Host, read the Set-Cookie the index route mints, and
 * return its `name=value` plus expiry (or undefined when the exchange failed
 * or no session cookie came back — e.g. an older base without browser
 * sessions).
 */
function exchange(
  url: string,
  authority: string,
  port: number,
): Promise<ExchangeResult | undefined> {
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      resolve(undefined)
      return
    }
    const request = http.request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: `${target.pathname}${target.search}`,
      headers: { host: authority, accept: 'text/html' },
    }, (response) => {
      const setCookies = response.headers['set-cookie']
      response.resume() // drain so the socket can be reused
      if (setCookies === undefined) {
        resolve(undefined)
        return
      }
      const raw = (Array.isArray(setCookies) ? setCookies : [setCookies])
        .find((value) => value.startsWith(`${UPSTREAM_COOKIE_PREFIX}=`))
      if (raw === undefined) {
        resolve(undefined)
        return
      }
      const header = nameValueOnly(raw)
      const maxAge = maxAgeSeconds(raw)
      resolve({ header, expiresAt: Date.now() + (maxAge ?? 0) * 1000 })
    })
    request.on('error', () => resolve(undefined))
    request.setTimeout(5000, () => request.destroy(new Error('upstream-session exchange timeout')))
    request.end()
  })
}

/**
 * A cached {@link UpstreamSession} acquired through the launch-token exchange.
 * Acquisition runs at most once concurrently and the result is cached until it
 * nears expiry or {@link invalidate} is called.
 */
export class UpstreamSessionRelay implements UpstreamSession {
  private readonly port: number
  private readonly authority: string
  private readonly authenticatedUrl: () => string | undefined
  private held: HeldCookie | undefined
  private inflight: Promise<string | undefined> | undefined

  constructor(options: UpstreamSessionRelayOptions) {
    this.port = options.port
    this.authority = options.authority ?? `127.0.0.1:${options.port}`
    this.authenticatedUrl = options.authenticatedUrl
  }

  /** Whether the held session is still comfortably inside its lifetime. */
  private fresh(): boolean {
    const held = this.held
    if (held === undefined) return false
    // Refresh up to a minute before the cookie actually lapses so a slow
    // request is never rejected mid-flight by an expiring session.
    return Date.now() < held.expiresAt - 60_000
  }

  peek(): string | undefined {
    return this.held?.header
  }

  invalidate(): void {
    this.held = undefined
  }

  async cookie(): Promise<string | undefined> {
    if (this.fresh()) return this.held?.header
    return this.acquire()
  }

  private acquire(): Promise<string | undefined> {
    if (this.inflight !== undefined) return this.inflight
    const pending = this.doExchange().finally(() => {
      this.inflight = undefined
    })
    this.inflight = pending
    return pending
  }

  private async doExchange(): Promise<string | undefined> {
    const url = this.authenticatedUrl()
    if (url === undefined) return undefined
    const result = await exchange(url, this.authority, this.port)
    if (result !== undefined) this.held = result
    // On a transient failure keep whatever session is still held rather than
    // dropping to anonymous.
    return this.held?.header
  }
}
