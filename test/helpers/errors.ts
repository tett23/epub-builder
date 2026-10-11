// 誤りの種類を確かめる（クラスを使わない誤り。ADR 0021）

/** 関数が投げた値を返す。投げなければ失敗する */
export function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('例外にならない');
}
