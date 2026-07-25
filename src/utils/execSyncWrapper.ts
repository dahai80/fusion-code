import {
  type ExecSyncOptions,
  type ExecSyncOptionsWithBufferEncoding,
  type ExecSyncOptionsWithStringEncoding,
  execSync as nodeExecSync,
} from 'child_process'
import { slowLogging } from './slowOperations.js'

/**
 * NOTE: Sync exec calls block the event loop. Prefer async alternatives.
 *
 * Wrapped execSync with slow operation logging.
 * Use this instead of child_process execSync directly to detect performance issues.
 *
 * @example
 * import { execSyncWrapped } from './execSyncWrapper.js'
 * const result = execSyncWrapped('git status', { encoding: 'utf8' })
 */
export function execSyncWrapped(command: string): Buffer
export function execSyncWrapped(
  command: string,
  options: ExecSyncOptionsWithStringEncoding,
): string
export function execSyncWrapped(
  command: string,
  options: ExecSyncOptionsWithBufferEncoding,
): Buffer
export function execSyncWrapped(
  command: string,
  options?: ExecSyncOptions,
): Buffer | string
export function execSyncWrapped(
  command: string,
  options?: ExecSyncOptions,
): Buffer | string {
  using _ = slowLogging`execSync: ${command.slice(0, 100)}`
  return nodeExecSync(command, options)
}
