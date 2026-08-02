import type { ContentBlockParam } from 'src/types/anthropic-protocol.js'
import { logForDebugging } from '../utils/debug.js'

// Resolve file_uuid attachments on inbound bridge user messages and prepend
// @path refs to the content. Attachment download is not wired up in this
// build, so we forward the content unchanged and log visibly (Rule 12) when
// attachments are present so they are not silently dropped.
//
// Contract: returns `content` (the message content), NOT `msg`. Both callers
// (print.ts, useReplBridge.tsx) assign the result to command.value and treat
// it as string | ContentBlockParam[]. Returning msg here crashes
// processTextPrompt with "input.find is not a function".
export const resolveAndPrepend = async (
  msg: unknown,
  content: string | Array<ContentBlockParam>,
): Promise<string | Array<ContentBlockParam>> => {
  if (
    typeof msg === 'object' &&
    msg !== null &&
    'file_attachments' in msg
  ) {
    logForDebugging(
      '[bridge:inbound-attach] file_attachments present but attachment resolution is disabled in this build; forwarding content without @path refs',
    )
  }
  return content
}
