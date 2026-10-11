// 誤りを、クラスを使わずに値として表す（ADR 0021）

/** `name` で種類を表す誤り */
export type NamedError<N extends string, Extra extends object = Record<never, never>> =
  & Error
  & { readonly name: N }
  & Readonly<Extra>;

/** 標準の Error に、種類の名前と種類ごとの情報を加える */
export function namedError<N extends string, Extra extends object = Record<never, never>>(
  name: N,
  message: string,
  extra?: Extra,
): NamedError<N, Extra> {
  return Object.assign(new Error(message), { name }, extra) as NamedError<N, Extra>;
}

/** 種類の名前で誤りを判別する */
export function hasErrorName<N extends string>(value: unknown, name: N): value is NamedError<N> {
  return value instanceof Error && value.name === name;
}
