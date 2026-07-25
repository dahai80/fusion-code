/**
 * System Theme Watcher — OSC 11 terminal background color query
 *
 * Queries the terminal for its background color via the OSC 11 escape sequence
 * and updates the cached system theme in systemTheme.ts.
 *
 * Imports are deferred so this module is only loaded when the user's theme
 * setting is 'auto' (gated by the AUTO_THEME feature flag in ThemeProvider).
 */

import { themeFromOscColor, setCachedSystemTheme } from './systemTheme.js'

const OSC_11_QUERY = '\x1b]11;?\x1b\\'
const OSC_11_RESPONSE_PREFIX = '\x1b]11;'

// Single listener shared across polls to avoid listener accumulation
let _registeredDataListener: ((chunk: Buffer) => void) | null = null
let _responseTimeout: ReturnType<typeof setTimeout> | undefined
let _oneshotActive = false

/**
 * Shared data handler for OSC 11 responses.
 * Registered once and reused across all polling calls.
 */
function onOscData(chunk: Buffer): void {
  const text = chunk.toString('utf-8')
  const idx = text.indexOf(OSC_11_RESPONSE_PREFIX)
  if (idx === -1) return

  const end = text.indexOf('\x1b\\', idx)
  if (end === -1) return

  const raw = text.slice(idx + OSC_11_RESPONSE_PREFIX.length, end)
  const theme = themeFromOscColor(raw)
  if (theme) {
    setCachedSystemTheme(theme)
  }
}

function cleanupListener(): void {
  if (_responseTimeout !== undefined) {
    clearTimeout(_responseTimeout)
    _responseTimeout = undefined
  }
  if (_registeredDataListener) {
    process.stdin.off('data', _registeredDataListener)
    _registeredDataListener = null
  }
  try {
    process.stdin.setRawMode?.(false)
  } catch {
    // Non-TTY stdin — ignore
  }
}

/**
 * Watch for terminal theme changes by polling OSC 11.
 *
 * Returns a cleanup function that stops the watcher.
 */
export function watchSystemTheme(): () => void {
  let cancelled = false
  let intervalId: ReturnType<typeof setInterval> | undefined

  const poll = () => {
    if (cancelled) return
    queryBackgroundColor()
  }

  // Initial query
  poll()

  // Poll every 5 seconds for theme changes
  intervalId = setInterval(poll, 5000)

  return () => {
    cancelled = true
    if (intervalId !== undefined) {
      clearInterval(intervalId)
    }
    cleanupListener()
  }
}

/**
 * Query the terminal background color via OSC 11.
 *
 * Writes the OSC 11 query to stderr (which is connected to the terminal in
 * most CLI environments) and sets up a one-shot listener for the response on
 * stdin.  If stdin is not a TTY, the query is skipped silently.
 */
function queryBackgroundColor(): void {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return
  }

  // Register the shared data listener once
  if (!_registeredDataListener) {
    _registeredDataListener = onOscData
    process.stdin.on('data', _registeredDataListener)
    try {
      process.stdin.setRawMode?.(true)
    } catch {
      cleanupListener()
      return
    }
  }

  // Set a timeout so we don't hang if the terminal doesn't respond
  if (_responseTimeout !== undefined) {
    clearTimeout(_responseTimeout)
  }
  _responseTimeout = setTimeout(() => {
    _responseTimeout = undefined
  }, 500)

  // Write the query to stderr
  process.stderr.write(OSC_11_QUERY)
}

/**
 * Do a one-shot query of the terminal background color.
 * Returns the detected theme, or undefined if the query fails.
 */
export function queryThemeOnce(): Promise<'dark' | 'light' | undefined> {
  return new Promise(resolve => {
    if (!process.stdin.isTTY || !process.stderr.isTTY) {
      resolve(undefined)
      return
    }

    if (_oneshotActive) {
      resolve(undefined)
      return
    }

    _oneshotActive = true
    let resolved = false
    let responseTimeout: ReturnType<typeof setTimeout> | undefined

    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf-8')
      const idx = text.indexOf(OSC_11_RESPONSE_PREFIX)
      if (idx === -1) return

      const end = text.indexOf('\x1b\\', idx)
      if (end === -1) return

      const raw = text.slice(idx + OSC_11_RESPONSE_PREFIX.length, end)
      const theme = themeFromOscColor(raw)
      resolved = true
      cleanup()
      resolve(theme)
    }

    const cleanup = () => {
      _oneshotActive = false
      if (responseTimeout !== undefined) {
        clearTimeout(responseTimeout)
      }
      process.stdin.off('data', onData)
      process.stdin.setRawMode?.(false)
    }

    responseTimeout = setTimeout(() => {
      if (!resolved) {
        cleanup()
        resolve(undefined)
      }
    }, 500)

    process.stdin.on('data', onData)
    try {
      process.stdin.setRawMode?.(true)
    } catch {
      cleanup()
      resolve(undefined)
      return
    }

    process.stderr.write(OSC_11_QUERY)
  })
}