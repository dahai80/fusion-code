import memoize from 'lodash-es/memoize.js'

/**
 * Like lodash memoize, but evicts the cache entry when the returned promise
 * rejects. Plain memoize would cache the rejected promise permanently,
 * making every subsequent call with the same key also reject.
 */
export function asyncMemoize<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    resolver?: (...args: Parameters<T>) => unknown,
): T & { cache: Map<unknown, Promise<ReturnType<T>>> } {
    const memoized = memoize(fn, resolver) as T & {
        cache: Map<unknown, Promise<ReturnType<T>>>
    }
    const originalCache = memoized.cache

    const wrapped = function (this: unknown, ...args: Parameters<T>): Promise<ReturnType<T>> {
        const key = resolver ? resolver(...args) : args[0]
        if (originalCache.has(key)) {
            return originalCache.get(key)!
        }
        const result = fn.apply(this, args)
        originalCache.set(key, result)
        result.catch(() => {
            originalCache.delete(key)
        })
        return result
    } as T & { cache: Map<unknown, Promise<ReturnType<T>>> }

    wrapped.cache = originalCache
    return wrapped
}
