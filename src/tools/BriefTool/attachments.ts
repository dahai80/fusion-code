/**
 * Shared attachment validation + resolution for SendUserMessage and
 * SendUserFile.
 */

import { stat } from 'fs/promises'

import type { ValidationResult } from '../../Tool.js'

// audit-0902 P2-3: cap attachment size. validateAttachmentPaths checked the
// sensitive-file gate + isFile but NOT size — a 10GB attachment passed and was
// uploaded to the cloud transcript, exhausting token budget / memory. Cloud
// providers cap file uploads well under this; enforce a local bound so a
// pathologically large (or adversarially crafted) file is rejected before
// upload. 25MB mirrors the typical cloud attachment ceiling.
const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024

import { getCwd } from '../../utils/cwd.js'
import { getErrnoCode } from '../../utils/errors.js'
import { IMAGE_EXTENSION_REGEX } from '../../utils/imagePaste.js'
import { expandPath } from '../../utils/path.js'
import {
    isSensitiveFilePath,
    isSymlinkBypassingSensitiveGate,
    getSensitiveFileDenialMessage,
} from '../../utils/sensitiveFiles.js'

export type ResolvedAttachment = {
  path: string
  size: number
  isImage: boolean
  file_uuid?: string
}

export async function validateAttachmentPaths(
  rawPaths: string[],
): Promise<ValidationResult> {
  const cwd = getCwd()
  for (const rawPath of rawPaths) {
    const fullPath = expandPath(rawPath)
    // P0-2 (audit 0901): SendUserFile/SendUserMessage attachments bypassed the
    // sensitive-file gate entirely — AI attached `~/.env` / `~/.ssh/id_rsa` and
    // the file was uploaded to the cloud transcript unblocked. Block at the
    // attachment validator (string check first, then symlink-resolution guard).
    if (isSensitiveFilePath(fullPath)) {
      return {
        result: false,
        message: getSensitiveFileDenialMessage(rawPath),
        errorCode: 1,
      }
    }
    if (await isSymlinkBypassingSensitiveGate(fullPath)) {
      return {
        result: false,
        message: getSensitiveFileDenialMessage(rawPath),
        errorCode: 1,
      }
    }
    try {
      const stats = await stat(fullPath)
      if (!stats.isFile()) {
        return {
          result: false,
          message: `Attachment "${rawPath}" is not a regular file.`,
          errorCode: 1,
        }
      }
      // audit-0902 P2-3: reject oversized attachments before upload. Without a
      // cap, a huge file (or a symlink'd large target) is uploaded to the cloud
      // transcript, blowing the token/memory budget. Checked after isFile so
      // directories/devices (size = FS block estimate) aren't misreported here.
      if (stats.size > MAX_ATTACHMENT_SIZE) {
        return {
          result: false,
          message: `Attachment "${rawPath}" is ${stats.size} bytes, exceeding the ${MAX_ATTACHMENT_SIZE} byte (${Math.round(MAX_ATTACHMENT_SIZE / 1024 / 1024)}MB) limit. Use a smaller file.`,
          errorCode: 1,
        }
      }
    } catch (e) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return {
          result: false,
          message: `Attachment "${rawPath}" does not exist. Current working directory: ${cwd}.`,
          errorCode: 1,
        }
      }
      if (code === 'EACCES' || code === 'EPERM') {
        return {
          result: false,
          message: `Attachment "${rawPath}" is not accessible (permission denied).`,
          errorCode: 1,
        }
      }
      throw e
    }
  }
  return { result: true }
}

export async function resolveAttachments(
  rawPaths: string[],
  uploadCtx: { replBridgeEnabled: boolean; signal?: AbortSignal },
): Promise<ResolvedAttachment[]> {
  // Stat serially (local, fast) to keep ordering deterministic, then upload
  // in parallel (network, slow). Upload failures resolve undefined — the
  // attachment still carries {path, size, isImage} for local renderers.
  const stated: ResolvedAttachment[] = []
  for (const rawPath of rawPaths) {
    const fullPath = expandPath(rawPath)
    // Single stat — we need size, so this is the operation, not a guard.
    // validateInput ran before us, but the file could have moved since
    // (TOCTOU); if it did, let the error propagate so the model sees it.
    const stats = await stat(fullPath)
    stated.push({
      path: fullPath,
      size: stats.size,
      isImage: IMAGE_EXTENSION_REGEX.test(fullPath),
    })
  }
  return stated
}
