// 抽選と演出（シルエットシャッフル）
// - START：対象から無作為に選んだ30件程度の画像を先読みし、読み込めたものから約80msごとに入れ替える
// - STOP ：その瞬間に対象全体から均等な確率で1件を決め、その画像の読み込みを始める
//          約1秒かけて入れ替え間隔を伸ばして減速し、最後に決定した1件の画像で止める

const tickIntervalMs = 80;
const preloadCount = 30;
// 減速時の入れ替え間隔（合計で約1秒）
const slowDownDelaysMs = [90, 100, 115, 135, 160, 190, 230];
// 決定した画像の読み込みを待つ上限
const finalImageTimeoutMs = 4000;

export function randomIndex(length) {
  // 2^32 を length で割り切れる範囲だけ使い、偏りをなくす
  const limit = Math.floor(0x100000000 / length) * length;
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % length;
}

export function pickRandom(list) {
  return list[randomIndex(list.length)];
}

function sampleWithoutReplacement(list, count) {
  const copy = [...list];
  const size = Math.min(count, copy.length);
  for (let i = 0; i < size; i += 1) {
    const j = i + randomIndex(copy.length - i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, size);
}

// 画像を読み込み、成功したら URL を返す（失敗・時間切れは null）
export function preloadImage(url, timeoutMs = Infinity) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const image = new Image();
    let timerId = null;
    const finish = (result) => {
      clearTimeout(timerId);
      image.onload = null;
      image.onerror = null;
      resolve(result);
    };
    image.onload = () => finish(url);
    image.onerror = () => finish(null);
    if (Number.isFinite(timeoutMs)) timerId = setTimeout(() => finish(null), timeoutMs);
    image.src = url;
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ onFrame: (url: string) => void }} options onFrame はシルエットとして表示する画像URLを受け取る
 */
export function createRoulette({ onFrame }) {
  let timerId = null;
  let items = [];
  let loadedUrls = [];
  let lastUrl = null;
  let session = 0;

  function showNextFrame() {
    if (loadedUrls.length === 0) return;
    // 同じ画像が続かないようにする
    let url = pickRandom(loadedUrls);
    if (loadedUrls.length > 1 && url === lastUrl) url = pickRandom(loadedUrls);
    lastUrl = url;
    onFrame(url);
  }

  function clearTimer() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function start(targetItems) {
    clearTimer();
    session += 1;
    const currentSession = session;
    items = targetItems;
    loadedUrls = [];
    lastUrl = null;
    for (const item of sampleWithoutReplacement(items, preloadCount)) {
      preloadImage(item.images[0]?.url).then((url) => {
        if (url && currentSession === session) loadedUrls.push(url);
      });
    }
    timerId = setInterval(showNextFrame, tickIntervalMs);
  }

  // 結果を決めて減速演出を行い、決定した item と読み込めた画像URLを返す
  async function stop() {
    clearTimer();
    session += 1;
    if (items.length === 0) return null;
    const item = pickRandom(items);
    const finalImage = preloadImage(item.images[0]?.url, finalImageTimeoutMs);

    for (const delay of slowDownDelaysMs) {
      showNextFrame();
      await wait(delay);
    }
    const finalUrl = await finalImage;
    if (finalUrl) onFrame(finalUrl);
    return { item, imageUrl: finalUrl };
  }

  return { start, stop };
}
