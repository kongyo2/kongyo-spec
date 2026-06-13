// 文字列キーの降順比較器を作る。辞書順で大きい(=新しいタイムスタンプ)ものほど前に来る
export function byStringDesc<T>(key: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const av = key(a);
    const bv = key(b);
    return av < bv ? 1 : av > bv ? -1 : 0;
  };
}
