import React, { useCallback, useEffect, useState } from 'react'
import type { Key } from '../ink.js'
import type { VimInputState, VimMode } from '../types/textInputTypes.js'
import { Cursor } from '../utils/Cursor.js'
import { lastGrapheme } from '../utils/intl.js'
import {
  executeIndent,
  executeJoin,
  executeOpenLine,
  executeOperatorFind,
  executeOperatorMotion,
  executeOperatorTextObj,
  executeReplace,
  executeToggleCase,
  executeX,
  type OperatorContext,
} from '../vim/operators.js'
import { type TransitionContext, transition } from '../vim/transitions.js'
import {
  createInitialPersistentState,
  createInitialVimState,
  type PersistentState,
  type RecordedChange,
  type VimState,
} from '../vim/types.js'
import { type UseTextInputProps, useTextInput } from './useTextInput.js'
import { getGlobalConfig } from '../utils/config.js'

type UseVimInputProps = Omit<UseTextInputProps, 'inputFilter'> & {
  onModeChange?: (mode: VimMode) => void
  onUndo?: () => void
  inputFilter?: UseTextInputProps['inputFilter']
}

export function useVimInput(props: UseVimInputProps): VimInputState {
  const vimStateRef = React.useRef<VimState>(createInitialVimState())
  const [mode, setMode] = useState<VimMode>('INSERT')

  const persistentRef = React.useRef<PersistentState>(
    createInitialPersistentState(),
  )

  // item 20: INSERT-mode 双键序列状态 (vimInsertModeRemaps)。独立 ref —
  // VimState 每输入被覆写, 无法承载跨键 prefix。
  const remapSeqRef = React.useRef<{
    prefix: string
    timer: ReturnType<typeof setTimeout> | null
  }>({ prefix: '', timer: null })

  // 卸载时清超时定时器, 防 leak。
  useEffect(() => {
    return () => {
      const seq = remapSeqRef.current
      if (seq.timer) clearTimeout(seq.timer)
    }
  }, [])

  // inputFilter is applied once at the top of handleVimInput (not here) so
  // vim-handled paths that return without calling textInput.onInput still
  // run the filter — otherwise a stateful filter (e.g. lazy-space-after-
  // pill) stays armed across an Escape → NORMAL → INSERT round-trip.
  const textInput = useTextInput({ ...props, inputFilter: undefined })
  const { onModeChange, inputFilter } = props

  const switchToInsertMode = useCallback(
    (offset?: number): void => {
      if (offset !== undefined) {
        textInput.setOffset(offset)
      }
      vimStateRef.current = { mode: 'INSERT', insertedText: '' }
      setMode('INSERT')
      onModeChange?.('INSERT')
    },
    [textInput, onModeChange],
  )

  const switchToNormalMode = useCallback((): void => {
    const current = vimStateRef.current
    if (current.mode === 'INSERT' && current.insertedText) {
      persistentRef.current.lastChange = {
        type: 'insert',
        text: current.insertedText,
      }
    }

    // Vim behavior: move cursor left by 1 when exiting insert mode
    // (unless at beginning of line or at offset 0)
    const offset = textInput.offset
    if (offset > 0 && props.value[offset - 1] !== '\n') {
      textInput.setOffset(offset - 1)
    }

    vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
    setMode('NORMAL')
    onModeChange?.('NORMAL')
  }, [onModeChange, textInput, props.value])

  function createOperatorContext(
    cursor: Cursor,
    isReplay: boolean = false,
  ): OperatorContext {
    return {
      cursor,
      text: props.value,
      setText: (newText: string) => props.onChange(newText),
      setOffset: (offset: number) => textInput.setOffset(offset),
      enterInsert: (offset: number) => switchToInsertMode(offset),
      getRegister: () => persistentRef.current.register,
      setRegister: (content: string, linewise: boolean) => {
        persistentRef.current.register = content
        persistentRef.current.registerIsLinewise = linewise
      },
      getLastFind: () => persistentRef.current.lastFind,
      setLastFind: (type, char) => {
        persistentRef.current.lastFind = { type, char }
      },
      recordChange: isReplay
        ? () => {}
        : (change: RecordedChange) => {
            persistentRef.current.lastChange = change
          },
    }
  }

  function replayLastChange(): void {
    const change = persistentRef.current.lastChange
    if (!change) return

    const cursor = Cursor.fromText(props.value, props.columns, textInput.offset)
    const ctx = createOperatorContext(cursor, true)

    switch (change.type) {
      case 'insert':
        if (change.text) {
          const newCursor = cursor.insert(change.text)
          props.onChange(newCursor.text)
          textInput.setOffset(newCursor.offset)
        }
        break

      case 'x':
        executeX(change.count, ctx)
        break

      case 'replace':
        executeReplace(change.char, change.count, ctx)
        break

      case 'toggleCase':
        executeToggleCase(change.count, ctx)
        break

      case 'indent':
        executeIndent(change.dir, change.count, ctx)
        break

      case 'join':
        executeJoin(change.count, ctx)
        break

      case 'openLine':
        executeOpenLine(change.direction, ctx)
        break

      case 'operator':
        executeOperatorMotion(change.op, change.motion, change.count, ctx)
        break

      case 'operatorFind':
        executeOperatorFind(
          change.op,
          change.find,
          change.char,
          change.count,
          ctx,
        )
        break

      case 'operatorTextObj':
        executeOperatorTextObj(
          change.op,
          change.scope,
          change.objType,
          change.count,
          ctx,
        )
        break
    }
  }

  function handleVimInput(rawInput: string, key: Key): void {
    const state = vimStateRef.current
    // Run inputFilter in all modes so stateful filters disarm on any key,
    // but only apply the transformed input in INSERT — NORMAL-mode command
    // lookups expect single chars and a prepended space would break them.
    const filtered = inputFilter ? inputFilter(rawInput, key) : rawInput
    const input = state.mode === 'INSERT' ? filtered : rawInput
    const cursor = Cursor.fromText(props.value, props.columns, textInput.offset)

    if (key.ctrl) {
      textInput.onInput(input, key)
      return
    }

    // NOTE(keybindings): This escape handler is intentionally NOT migrated to the keybindings system.
    // It's vim's standard INSERT->NORMAL mode switch - a vim-specific behavior that should not be
    // configurable via keybindings. Vim users expect Esc to always exit INSERT mode.
    if (key.escape && state.mode === 'INSERT') {
      switchToNormalMode()
      return
    }

    // Escape in NORMAL mode cancels any pending command (replace, operator, etc.)
    if (key.escape && state.mode === 'NORMAL') {
      vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      return
    }

    // Pass Enter to base handler regardless of mode (allows submission from NORMAL)
    if (key.return) {
      textInput.onInput(input, key)
      return
    }

    if (state.mode === 'INSERT') {
      // Track inserted text for dot-repeat
      if (key.backspace || key.delete) {
        // Backspace 中断正在暂存的 remap 序列: 清 prefix + 定时器。
        // 已插字符由下方 insertedText 回退正常处理。
        const seq0 = remapSeqRef.current
        if (seq0.timer) {
          clearTimeout(seq0.timer)
          seq0.timer = null
        }
        seq0.prefix = ''
        if (state.insertedText.length > 0) {
          vimStateRef.current = {
            mode: 'INSERT',
            insertedText: state.insertedText.slice(
              0,
              -(lastGrapheme(state.insertedText).length || 1),
            ),
          }
        }
        textInput.onInput(input, key)
        return
      }

      // item 20: vimInsertModeRemaps 双键序列检测 (仅打印字符)。
      // default off (空 remaps → 透传, byte-identical 旧行为)。
      const remaps = getGlobalConfig().vimInsertModeRemaps ?? []
      const seq = remapSeqRef.current
      if (remaps.length > 0) {
        const verdict = matchInsertRemap(remaps, seq.prefix, input)
        if (verdict.action === 'match') {
          // 完整匹配: 回溯删已暂存 prefix 字符 (已插为真实文本) + 切 NORMAL。
          // 不插当前键 (exit 序列尾字符不进文本)。
          if (seq.timer) {
            clearTimeout(seq.timer)
            seq.timer = null
          }
          // 置空前先记待删数 (prefix 已作为真实字符插入, 需回溯删)。
          const toDelete = seq.prefix.length
          seq.prefix = ''
          let cursor = Cursor.fromText(
            props.value,
            props.columns,
            textInput.offset,
          )
          for (let i = 0; i < toDelete; i++) {
            cursor = cursor.backspace()
          }
          props.onChange(cursor.text)
          textInput.setOffset(cursor.offset)
          // insertedText 镜像减 toDelete, 防 dot-repeat 重放已删字符。
          vimStateRef.current = {
            mode: 'INSERT',
            insertedText: state.insertedText.slice(
              0,
              Math.max(0, state.insertedText.length - toDelete),
            ),
          }
          switchToNormalMode()
          return
        }
        if (verdict.action === 'prefix') {
          // 暂存前缀 + 仍插入字符 (匹配时回溯删) + 起/重置超时窗。
          seq.prefix = verdict.newPrefix
          if (seq.timer) clearTimeout(seq.timer)
          const timeoutMs = getInsertRemapTimeoutMs()
          if (timeoutMs > 0) {
            seq.timer = setTimeout(() => {
              remapSeqRef.current.prefix = ''
              remapSeqRef.current.timer = null
            }, timeoutMs)
          }
          vimStateRef.current = {
            mode: 'INSERT',
            insertedText: state.insertedText + input,
          }
          textInput.onInput(input, key)
          return
        }
        // passthrough: 放弃序列, 清 prefix + 定时器, 正常插入。
        if (seq.timer) {
          clearTimeout(seq.timer)
          seq.timer = null
        }
        seq.prefix = ''
      }

      vimStateRef.current = {
        mode: 'INSERT',
        insertedText: state.insertedText + input,
      }
      textInput.onInput(input, key)
      return
    }

    if (state.mode !== 'NORMAL') {
      return
    }

    // In idle state, delegate arrow keys to base handler for cursor movement
    // and history fallback (upOrHistoryUp / downOrHistoryDown)
    if (
      state.command.type === 'idle' &&
      (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow)
    ) {
      textInput.onInput(input, key)
      return
    }

    const ctx: TransitionContext = {
      ...createOperatorContext(cursor, false),
      onUndo: props.onUndo,
      onDotRepeat: replayLastChange,
    }

    // Backspace/Delete are only mapped in motion-expecting states. In
    // literal-char states (replace, find, operatorFind), mapping would turn
    // r+Backspace into "replace with h" and df+Delete into "delete to next x".
    // Delete additionally skips count state: in vim, N<Del> removes a count
    // digit rather than executing Nx; we don't implement digit removal but
    // should at least not turn a cancel into a destructive Nx.
    const expectsMotion =
      state.command.type === 'idle' ||
      state.command.type === 'count' ||
      state.command.type === 'operator' ||
      state.command.type === 'operatorCount'

    // Map arrow keys to vim motions in NORMAL mode
    let vimInput = input
    if (key.leftArrow) vimInput = 'h'
    else if (key.rightArrow) vimInput = 'l'
    else if (key.upArrow) vimInput = 'k'
    else if (key.downArrow) vimInput = 'j'
    else if (expectsMotion && key.backspace) vimInput = 'h'
    else if (expectsMotion && state.command.type !== 'count' && key.delete)
      vimInput = 'x'

    const result = transition(state.command, vimInput, ctx)

    if (result.execute) {
      result.execute()
    }

    // Update command state (only if execute didn't switch to INSERT)
    if (vimStateRef.current.mode === 'NORMAL') {
      if (result.next) {
        vimStateRef.current = { mode: 'NORMAL', command: result.next }
      } else if (result.execute) {
        vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      }
    }

    if (
      input === '?' &&
      state.mode === 'NORMAL' &&
      state.command.type === 'idle'
    ) {
      props.onChange('?')
    }
  }

  const setModeExternal = useCallback(
    (newMode: VimMode) => {
      if (newMode === 'INSERT') {
        vimStateRef.current = { mode: 'INSERT', insertedText: '' }
      } else {
        vimStateRef.current = { mode: 'NORMAL', command: { type: 'idle' } }
      }
      setMode(newMode)
      onModeChange?.(newMode)
    },
    [onModeChange],
  )

  return {
    ...textInput,
    onInput: handleVimInput,
    mode,
    setMode: setModeExternal,
  }
}

// --- item 20: vimInsertModeRemaps 双键 INSERT exit 序列映射 (CC 2.1.208) ---
// 纯函数: 判定 INSERT 字符是否构成 remap 序列。无副作用, 便于单测。
// remaps: 已配的 exit 序列 (如 ["jj","jk"]); prefix: 已暂存前缀; input: 当前键。
// 返回 action: 'match' (完整匹配, 需回溯删 prefix + 切 NORMAL)
//            | 'prefix' (仍是某序列前缀, 暂存 + 继续超时窗)
//            | 'passthrough' (非匹配非前缀, 放弃序列, 正常插入)
export type InsertRemapResult = {
  action: 'match' | 'prefix' | 'passthrough'
  newPrefix: string
}

export function matchInsertRemap(
  remaps: string[],
  prefix: string,
  input: string,
): InsertRemapResult {
  if (remaps.length === 0) {
    return { action: 'passthrough', newPrefix: '' }
  }
  const candidate = prefix + input
  if (remaps.includes(candidate)) {
    return { action: 'match', newPrefix: '' }
  }
  if (remaps.some((r) => r.startsWith(candidate))) {
    return { action: 'prefix', newPrefix: candidate }
  }
  return { action: 'passthrough', newPrefix: '' }
}

// 超时窗: env FUSION_VIM_INSERT_REMAP_TIMEOUT_MS, default 750, fail-open。
// 0 = 禁超时 (立即放弃序列, 单字符无法成序列, 合法 edge)。
export function getInsertRemapTimeoutMs(): number {
  const raw = process.env.FUSION_VIM_INSERT_REMAP_TIMEOUT_MS
  if (raw === undefined) return 750
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return 750
  return parsed
}
