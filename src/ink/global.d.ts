// log: fix TS2339
import type { Styles, TextStyles } from './styles.js'
import type { DOMElement } from './dom.js'
import type { ClickEvent } from './events/click-event.js'
import type { FocusEvent } from './events/focus-event.js'
import type { KeyboardEvent } from './events/keyboard-event.js'

declare global {
    namespace JSX {
        interface IntrinsicElements {
            // log: fix TS2339
            'ink-text': {
                style?: Styles
                textStyles?: TextStyles
                children?: React.ReactNode
            }
            // log: fix TS2339
            'ink-box': {
                ref?: React.Ref<DOMElement>
                style?: Styles
                tabIndex?: number
                autoFocus?: boolean
                onClick?: (event: ClickEvent) => void
                onFocus?: (event: FocusEvent) => void
                onFocusCapture?: (event: FocusEvent) => void
                onBlur?: (event: FocusEvent) => void
                onBlurCapture?: (event: FocusEvent) => void
                onKeyDown?: (event: KeyboardEvent) => void
                onKeyDownCapture?: (event: KeyboardEvent) => void
                onMouseEnter?: () => void
                onMouseLeave?: () => void
                stickyScroll?: boolean
                children?: React.ReactNode
            }
            // log: fix TS2339
            'ink-link': {
                href: string
                children?: React.ReactNode
            }
            // log: fix TS2339
            'ink-raw-ansi': {
                rawText: string
                rawWidth: number
                rawHeight: number
            }
        }
    }
}

export {}
