// 抽選履歴画面：新しい順に並べ、タップで詳細を開く

import { createItemRow, resolveListFields } from './listView.js';

const timeFormat = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function createHistoryView({ list, count, clearButton, workConfig, itemsById, onClear }) {
  const fields = resolveListFields(workConfig);

  function setEntries(entries) {
    // データ更新で無くなった id は表示しない
    const rows = entries
      .map((entry) => ({ entry, item: itemsById.get(entry.id) }))
      .filter(({ item }) => item);
    const fragment = document.createDocumentFragment();
    for (const { entry, item } of rows) {
      fragment.append(createItemRow(item, fields, { meta: timeFormat.format(new Date(entry.at)) }));
    }
    list.replaceChildren(fragment);
    if (rows.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'itemRowEmpty';
      empty.textContent = 'まだ抽選していません';
      list.append(empty);
    }
    count.textContent = rows.length ? `${rows.length}件（新しい順）` : '';
    clearButton.hidden = rows.length === 0;
  }

  clearButton.addEventListener('click', () => {
    if (window.confirm('抽選履歴をすべて消去しますか？')) onClear();
  });

  return { setEntries };
}
