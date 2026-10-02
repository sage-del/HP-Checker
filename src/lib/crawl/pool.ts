/**
 * 動的に伸びる待ち行列を、同時実行数を抑えながら空になるまで処理する。
 *
 * `next()` は次の仕事を返す。`undefined` は「今は取り出せる仕事が無い」の意味で、
 * 実行中の仕事が全部終わった時点でまだ何も無ければ完了とする（BFS でリンクを
 * 見つけるたびに待ち行列が伸びるので、事前に長さが分からない）。
 * `work()` は自分でエラーを処理する前提。投げた場合は全体を reject する。
 */
export function drainQueue<T>(
  concurrency: number,
  next: () => T | undefined,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency));
  return new Promise<void>((resolve, reject) => {
    let active = 0;
    let settled = false;

    const pump = () => {
      if (settled) return;
      while (active < limit) {
        const item = next();
        if (item === undefined) break;
        active += 1;
        work(item).then(
          () => {
            active -= 1;
            pump();
          },
          (err: unknown) => {
            if (settled) return;
            settled = true;
            reject(err);
          },
        );
      }
      if (active === 0 && !settled) {
        settled = true;
        resolve();
      }
    };

    pump();
  });
}
