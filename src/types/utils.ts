export type DeepImmutable<T> = {
    readonly [P in keyof T]: T[P] extends object
        ? T[P] extends Function
            ? T[P]
            : DeepImmutable<T[P]>
        : T[P]
}

export type Permutations<T extends string, U extends string = T> =
    T extends string
        ? [T, ...Exclude<U, T> extends never ? [] : Permutations<Exclude<U, T>>]
        : []
