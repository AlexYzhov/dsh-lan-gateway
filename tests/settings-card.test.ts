/**
 * Settings-card field codec tests.
 *
 * The card posts the *whole* config on every save and the settings scope
 * applies it with a wholesale `replace`, so a field that the card cannot
 * express is not merely uneditable — the next save resets it to the
 * composition default. That makes the tri-state codec load-bearing: `auto`
 * (unset) and an explicit `false` must stay distinguishable, or the
 * plaintext-proxy escape hatch for `secureCookies` silently reverts and the
 * `/__login` loop comes back.
 *
 * @module tests/settings-card
 */

import { describe, expect, it } from 'vitest'
import { FIELDS, formatValue, parseValue, type FieldDef } from '../src/client/lan-gateway-card.tsx'

/** The tri-state field definition, as the card declares it. */
const secureCookies = FIELDS.find(f => f.field === 'secureCookies') as FieldDef

describe('settings-card tri-state field', () => {
  it('is present in the field table (an absent field would be wiped by save)', () => {
    // save() rebuilds the POST body from FIELDS, and replace() drops anything
    // missing — so a key absent here cannot survive a settings-card save.
    expect(secureCookies).toBeDefined()
    expect(secureCookies.kind).toBe('tristate')
  })

  it('renders unset as "auto", never as "false"', () => {
    expect(formatValue(secureCookies, undefined)).toBe('auto')
    expect(formatValue(secureCookies, true)).toBe('true')
    expect(formatValue(secureCookies, false)).toBe('false')
  })

  it('parses "auto" as a clear so the key re-inherits the composition layer', () => {
    expect(parseValue(secureCookies, 'auto')).toEqual({ kind: 'clear' })
  })

  it('parses an explicit false as a set, not as unset', () => {
    expect(parseValue(secureCookies, 'false')).toEqual({ kind: 'set', value: false })
    expect(parseValue(secureCookies, 'true')).toEqual({ kind: 'set', value: true })
  })

  it('round-trips every state through the codec', () => {
    for (const value of [undefined, true, false] as const) {
      const text = formatValue(secureCookies, value)
      const write = parseValue(secureCookies, text)
      // 'auto' is the only state that clears; the other two must set.
      if (value === undefined) expect(write).toEqual({ kind: 'clear' })
      else expect(write).toEqual({ kind: 'set', value })
    }
  })

  it('rejects an unknown option rather than inventing a value', () => {
    expect(parseValue(secureCookies, 'yes')).toBeUndefined()
  })
})
