// Build-time constant helpers.
// The bundler replaces process.env.USER_TYPE and process.env.NODE_ENV with string
// literals, so direct comparisons trigger TS2367. These helpers centralize the

/** True in internal (Anthropic employee) builds where USER_TYPE is "ant". */
export function isInternalBuild(): boolean {
    return process.env.USER_TYPE === "ant"
}

/** True in test environment. */
export function isTestEnv(): boolean {
    return process.env.NODE_ENV === "test"
}

/** True in development environment. */
export function isDevEnv(): boolean {
    return process.env.NODE_ENV === "development"
}
