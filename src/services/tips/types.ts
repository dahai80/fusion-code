// log: created for TS2307 fix

export type TipEntry = {
    id: string
    message: string
    category?: string
    priority?: number
}

export type TipRegistry = {
    tips: TipEntry[]
    seenTipIds: Set<string>
}
