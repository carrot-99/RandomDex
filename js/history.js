// 抽選履歴（作品ごとにブラウザへ保存。キーは必ず RandomDex_ で始める）
// 新しいものが先頭。上限を超えた古いものから消す。

const storageKeyPrefix = 'RandomDex_history_';
export const historyLimit = 100;

export function loadHistory(workId) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKeyPrefix + workId) ?? '[]');
    return Array.isArray(saved) ? saved.filter((entry) => entry && typeof entry.id === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(workId, entries) {
  try {
    localStorage.setItem(storageKeyPrefix + workId, JSON.stringify(entries));
  } catch {
    // 保存できない環境（プライベートブラウズ等）では保存しない
  }
}

export function addHistory(workId, itemId) {
  const entries = [{ id: itemId, at: Date.now() }, ...loadHistory(workId)].slice(0, historyLimit);
  saveHistory(workId, entries);
  return entries;
}

export function clearHistory(workId) {
  saveHistory(workId, []);
  return [];
}
