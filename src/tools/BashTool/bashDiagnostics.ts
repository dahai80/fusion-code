// Phase 2/3: format executor diagnostics into a compact failure summary for the
// model. On the executor route the server auto-populates `diagnostics` (a sliced
// traceback: error_type / file_path:line / code_snippet / raw_trace tail). When a
// slice is present we replace the full output with it to cut tokens fed to the
// model (PRD Phase 2). When absent (in-process path, or executor produced no
// slice) we return the full output unchanged — byte-identical with today.
//
// Phase 3: when the executor auto-rolled back the working tree via a git snapshot,
// prefix a <note> so the model knows its edits were reverted and can re-apply.

export type DiagnosticsLike = {
  error_type?: string
  file_path?: string
  line_number?: number
  code_snippet?: string
  raw_trace?: string
}

export function formatDiagnosticsForModel(
  d: DiagnosticsLike | undefined,
  fullOutput: string,
  exitCode: number,
  autoRolledBack?: boolean,
  snapshotId?: string,
): string {
  let out: string
  if (!d) {
    // No slice → full output unchanged (in-process path / executor no-slice).
    out = fullOutput
  } else {
    const parts: string[] = [`Exit code ${exitCode}`]
    if (d.error_type) parts.push(`Error: ${d.error_type}`)
    if (d.file_path) {
      parts.push(`File: ${d.file_path}${d.line_number ? `:${d.line_number}` : ''}`)
    }
    if (d.code_snippet) parts.push(`Snippet:\n${d.code_snippet}`)
    if (d.raw_trace) parts.push(`Trace (last lines):\n${d.raw_trace}`)
    out = parts.join('\n')
  }
  if (autoRolledBack) {
    out = `<note>Working tree auto-reverted via git snapshot${snapshotId ? ` (${snapshotId})` : ''}.</note>\n${out}`
  }
  return out
}
