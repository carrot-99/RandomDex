// 抽選と演出
// ステップ3では名前を一定間隔で入れ替えるだけの最小版。演出はステップ5で作り込む。

const tickIntervalMs = 80;

export function pickRandom(list) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return list[values[0] % list.length];
}

export function createRoulette({ onTick }) {
  let timerId = null;
  let candidates = [];

  function start(items) {
    stop();
    candidates = items;
    timerId = setInterval(() => onTick(pickRandom(candidates)), tickIntervalMs);
  }

  // 対象全体から均等な確率で1件を決めて返す
  function stop() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    return candidates.length ? pickRandom(candidates) : null;
  }

  return { start, stop };
}
