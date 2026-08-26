import { describe, expect, it } from 'bun:test'
import { formatDiagnosticsForModel } from '../../../tools/BashTool/bashDiagnostics.js'

describe('formatDiagnosticsForModel', () => {
  const full = 'Traceback (most recent call last):\n  File "x.py", line 10\nValueError: boom\nbig\noutput\nlines\n...'

  it('returns full output unchanged when diagnostics undefined (byte-identical)', () => {
    expect(formatDiagnosticsForModel(undefined, full, 1)).toBe(full)
  })

  it('returns full output unchanged when diagnostics is an empty object', () => {
    expect(formatDiagnosticsForModel({}, full, 1)).toBe(`Exit code 1`)
  })

  it('replaces full output with a slice when diagnostics present', () => {
    const out = formatDiagnosticsForModel(
      {
        error_type: 'ValueError',
        file_path: 'x.py',
        line_number: 10,
        code_snippet: '    raise ValueError("boom")',
        raw_trace: 'ValueError: boom',
      },
      full,
      1,
    )
    expect(out).toBe(
      [
        'Exit code 1',
        'Error: ValueError',
        'File: x.py:10',
        'Snippet:\n    raise ValueError("boom")',
        'Trace (last lines):\nValueError: boom',
      ].join('\n'),
    )
    // Full output must NOT appear in the slice.
    expect(out).not.toContain('Traceback (most recent call last)')
  })

  it('prefixes <note> when autoRolledBack is true', () => {
    const out = formatDiagnosticsForModel(
      { error_type: 'Error' },
      full,
      2,
      true,
      'head:abc123',
    )
    expect(out.startsWith('<note>Working tree auto-reverted via git snapshot (head:abc123).</note>')).toBe(true)
  })

  it('prefixes <note> without snapshot id when snapshotId absent', () => {
    const out = formatDiagnosticsForModel({ error_type: 'Error' }, full, 2, true)
    expect(out.startsWith('<note>Working tree auto-reverted via git snapshot.</note>')).toBe(true)
  })

  it('omits <note> when autoRolledBack false or undefined', () => {
    expect(formatDiagnosticsForModel({ error_type: 'Error' }, full, 1, false).startsWith('<note>')).toBe(false)
    expect(formatDiagnosticsForModel({ error_type: 'Error' }, full, 1, undefined).startsWith('<note>')).toBe(false)
  })

  it('includes only present fields on partial diagnostics', () => {
    const out = formatDiagnosticsForModel({ error_type: 'SyntaxError' }, full, 1)
    expect(out).toBe('Exit code 1\nError: SyntaxError')
  })

  it('omits line number suffix when line_number absent', () => {
    const out = formatDiagnosticsForModel({ file_path: 'x.py' }, full, 1)
    expect(out).toBe('Exit code 1\nFile: x.py')
  })
})
