// 一覧画面
// - 絞り込み後の対象を文字だけで並べる（画像は詳細を開いたときに読み込む）
// - 表示する項目は workConfig.json の listFields（displayFields の key を並べる）
// - 名前・フォルム名の部分一致で探せる（ひらがな・カタカナ、全角・半角を区別しない）

import { renderFieldValue } from './detailView.js';

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

// 検索用に文字をそろえる：全角英数→半角、ひらがな→カタカナ、小文字化
export function normalizeForSearch(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function createListView({ list, count, searchInput, workConfig }) {
  const fields = (workConfig.listFields ?? [])
    .map((key) => workConfig.displayFields.find((field) => field.key === key))
    .filter(Boolean);
  let items = [];
  let query = '';
  const searchTextCache = new WeakMap();

  function searchTextOf(item) {
    if (!searchTextCache.has(item)) searchTextCache.set(item, normalizeForSearch(`${item.name}${item.subName}`));
    return searchTextCache.get(item);
  }

  function createRow(item) {
    const row = createElement('li', 'itemRow');
    const link = createElement('a', 'itemLink');
    link.href = `#item/${encodeURIComponent(item.id)}`;
    const main = createElement('span', 'itemRowMain');
    const names = createElement('span', 'itemRowNames');
    names.append(createElement('span', 'itemRowName', item.name));
    if (item.subName) names.append(createElement('span', 'itemRowSubName', item.subName));
    const [firstField, ...restFields] = fields;
    // 先頭の項目（図鑑No など）は名前の左に、残り（タイプ等）は右に並べる
    if (firstField) {
      const lead = createElement('span', 'itemRowLead');
      lead.append(renderFieldValue(firstField, item));
      main.append(lead);
    }
    main.append(names);
    link.append(main);
    if (restFields.length) {
      const extra = createElement('span', 'itemRowExtra');
      for (const field of restFields) extra.append(renderFieldValue(field, item));
      link.append(extra);
    }
    row.append(link);
    return row;
  }

  function render() {
    const normalizedQuery = normalizeForSearch(query);
    const visible = normalizedQuery ? items.filter((item) => searchTextOf(item).includes(normalizedQuery)) : items;
    const fragment = document.createDocumentFragment();
    for (const item of visible) fragment.append(createRow(item));
    list.replaceChildren(fragment);
    count.textContent = normalizedQuery ? `${visible.length}件（対象 ${items.length}件中）` : `${items.length}件`;
    if (visible.length === 0) list.append(createElement('li', 'itemRowEmpty', '該当するものがありません'));
  }

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    render();
  });

  function setItems(newItems) {
    items = newItems;
    render();
  }

  return { setItems };
}
