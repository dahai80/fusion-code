import { logForDebugging } from '../../utils/debug.js'

export interface LicenseMatch {
    license: string
    confidence: number
    pattern: string
}

const LICENSE_PATTERNS: Array<{ name: string; pattern: RegExp; spdx: string }> = [
    { name: 'MIT', pattern: /Permission is hereby granted, free of charge/i, spdx: 'MIT' },
    { name: 'Apache-2.0', pattern: /Licensed under the Apache License, Version 2\.0/i, spdx: 'Apache-2.0' },
    { name: 'GPL-2.0', pattern: /GNU GENERAL PUBLIC LICENSE.*Version 2/i, spdx: 'GPL-2.0' },
    { name: 'GPL-3.0', pattern: /GNU GENERAL PUBLIC LICENSE.*Version 3/i, spdx: 'GPL-3.0' },
    { name: 'BSD-2-Clause', pattern: /Redistribution and use in source and binary forms/i, spdx: 'BSD-2-Clause' },
    { name: 'BSD-3-Clause', pattern: /Redistribution and use.*neither the name of/i, spdx: 'BSD-3-Clause' },
    { name: 'ISC', pattern: /Permission to use, copy, modify, and\/or distribute/i, spdx: 'ISC' },
    { name: 'MPL-2.0', pattern: /Mozilla Public License Version 2\.0/i, spdx: 'MPL-2.0' },
    { name: 'LGPL', pattern: /GNU LESSER GENERAL PUBLIC LICENSE/i, spdx: 'LGPL' },
    { name: 'Unlicense', pattern: /free and unencumbered software released into the public domain/i, spdx: 'Unlicense' },
]

const COPYRIGHT_HEURISTICS = [
    /copyright\s+\(c\)\s+\d{4}/i,
    /copyright\s+\d{4}/i,
    /\(c\)\s+\d{4}/i,
    /all rights reserved/i,
    /@license/i,
    /@copyright/i,
]

export function detectLicenseInCode(code: string): LicenseMatch | null {
    for (const { name, pattern, spdx } of LICENSE_PATTERNS) {
        if (pattern.test(code)) {
            logForDebugging(`[license-check] detected ${name} license`)
            return { license: spdx, confidence: 0.9, pattern: name }
        }
    }

    for (const heuristic of COPYRIGHT_HEURISTICS) {
        if (heuristic.test(code)) {
            logForDebugging('[license-check] detected copyright notice')
            return { license: 'UNKNOWN', confidence: 0.5, pattern: 'copyright-notice' }
        }
    }

    return null
}

export function checkCodeForCopyright(code: string): {
    hasCopyright: boolean
    license: LicenseMatch | null
    warning: string | null
} {
    const license = detectLicenseInCode(code)
    const hasCopyright = COPYRIGHT_HEURISTICS.some(h => h.test(code))

    let warning: string | null = null
    if (license && !['MIT', 'ISC', 'Unlicense', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0'].includes(license.license)) {
        warning = `Detected ${license.license} license — this may impose copyleft restrictions. Review before using.`
    }
    if (hasCopyright && !license) {
        warning = 'Detected copyright notice without clear license. Verify usage rights.'
    }

    return { hasCopyright, license, warning }
}
