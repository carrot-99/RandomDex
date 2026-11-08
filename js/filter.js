// 絞り込み（workConfig.json の filters に従って部品を自動生成する）
// - 同じ項目の中で複数選択：match が any なら「いずれか」、all なら「すべて含む」
// - 異なる項目の間：すべてに当てはまる（AND）
// - 何も選んでいない項目は条件なし
// 新しい type を増やすときは filterTypes に1つ追加する。

const storageKeyPrefix = 'RandomDex_filter_';

// ---------------------------------------------------------------------------
// 判定（画面に依存しない部分）
// ---------------------------------------------------------------------------

const filterTypes = {
  multiSelect: {
    // 選択肢：設定にあればその順、無ければ items の実際の値から作る
    options(filter, items) {
      if (Array.isArray(filter.options)) return filter.options;
      const values = new Set();
      for (const item of items) {
        for (const value of [].concat(item.attributes[filter.key] ?? [])) values.add(value);
      }
      return [...values].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ja')));
    },
    isActive(selection) {
      return Array.isArray(selection) && selection.length > 0;
    },
    matches(item, filter, selection) {
      const values = [].concat(item.attributes[filter.key] ?? []);
      return filter.match === 'all'
        ? selection.every((selected) => values.includes(selected))
        : selection.some((selected) => values.includes(selected));
    },
  },
};

export function filterItems(items, filters, selections) {
  const active = filters.filter((filter) => filterTypes[filter.type]?.isActive(selections[filter.key]));
  if (active.length === 0) return items;
  return items.filter((item) => active.every((filter) => filterTypes[filter.type].matches(item, filter, selections[filter.key])));
}

export function countActiveSelections(filters, selections) {
  return filters.filter((filter) => filterTypes[filter.type]?.isActive(selections[filter.key])).length;
}

// ---------------------------------------------------------------------------
// 保存（作品ごとにキーを分ける。キーは必ず RandomDex_ で始める）
// ---------------------------------------------------------------------------

export function loadSelections(workId, filters, items) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKeyPrefix + workId) ?? '{}');
    const selections = {};
    // 今の選択肢に存在する値だけを復元する
    for (const filter of filters) {
      const type = filterTypes[filter.type];
      if (!type || !Array.isArray(saved[filter.key])) continue;
      const options = type.options(filter, items);
      selections[filter.key] = saved[filter.key].filter((value) => options.includes(value));
    }
    return selections;
  } catch {
    return {};
  }
}

export function saveSelections(workId, selections) {
  try {
    localStorage.setItem(storageKeyPrefix + workId, JSON.stringify(selections));
  } catch {
    // 保存できない環境（プライベートブラウズ等）では保存しない
  }
}

// ---------------------------------------------------------------------------
// パネル（下から引き出す）
// ---------------------------------------------------------------------------

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function optionLabel(filter, value) {
  return filter.optionLabel ? filter.optionLabel.replace('{value}', value) : String(value);
}

/**
 * @param {object} options
 * @param {HTMLElement} options.root パネルを入れる要素
 * @param {object} options.workConfig
 * @param {object[]} options.items
 * @param {object} options.initialSelections
 * @param {(selections: object) => void} options.onApply
 */
export function createFilterPanel({ root, workConfig, items, initialSelections, onApply }) {
  const filters = workConfig.filters ?? [];
  let applied = structuredClone(initialSelections);
  let draft = {};

  const overlay = createElement('div', 'sheetOverlay');
  const sheet = createElement('div', 'sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '絞り込み');

  const header = createElement('div', 'sheetHeader');
  header.append(createElement('span', 'sheetGrip'), createElement('h2', 'sheetTitle', '絞り込み'));
  const body = createElement('div', 'sheetBody');
  const footer = createElement('div', 'sheetFooter');
  const countText = createElement('p', 'sheetCount');
  const clearButton = createElement('button', 'sheetButton isSecondary', 'クリア');
  clearButton.type = 'button';
  const applyButton = createElement('button', 'sheetButton', '適用');
  applyButton.type = 'button';
  const buttons = createElement('div', 'sheetButtons');
  buttons.append(clearButton, applyButton);
  footer.append(countText, buttons);
  sheet.append(header, body, footer);
  root.append(overlay, sheet);
  // 閉じている間は操作・読み上げの対象から外す
  root.inert = true;

  const chipButtons = []; // { filter, value, button }
  const colorFields = Object.fromEntries((workConfig.displayFields ?? []).filter((f) => f.colors).map((f) => [f.key, f.colors]));

  for (const filter of filters) {
    const type = filterTypes[filter.type];
    if (!type) continue;
    const section = createElement('section', 'filterSection');
    section.append(createElement('h3', 'filterLabel', filter.label));
    const list = createElement('div', 'filterOptions');
    const colors = filter.colorsFrom ? colorFields[filter.colorsFrom] : null;
    for (const value of type.options(filter, items)) {
      const button = createElement('button', 'filterChip', optionLabel(filter, value));
      button.type = 'button';
      if (colors?.[value]) button.style.setProperty('--chipColor', colors[value]);
      button.addEventListener('click', () => {
        const current = new Set(draft[filter.key] ?? []);
        if (current.has(value)) current.delete(value);
        else current.add(value);
        draft[filter.key] = [...current];
        render();
      });
      chipButtons.push({ filter, value, button });
      list.append(button);
    }
    section.append(list);
    body.append(section);
  }

  function render() {
    for (const { filter, value, button } of chipButtons) {
      const selected = (draft[filter.key] ?? []).includes(value);
      button.classList.toggle('isSelected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    const count = filterItems(items, filters, draft).length;
    countText.textContent = `該当 ${count}件`;
    countText.classList.toggle('isZero', count === 0);
    applyButton.disabled = count === 0;
  }

  function open() {
    draft = structuredClone(applied);
    render();
    root.inert = false;
    root.classList.add('isOpen');
    document.body.classList.add('isSheetOpen');
  }

  function close() {
    root.classList.remove('isOpen');
    root.inert = true;
    document.body.classList.remove('isSheetOpen');
  }

  overlay.addEventListener('click', close);
  clearButton.addEventListener('click', () => {
    draft = {};
    render();
  });
  applyButton.addEventListener('click', () => {
    applied = structuredClone(draft);
    close();
    onApply(applied);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.classList.contains('isOpen')) close();
  });

  return { open, close };
}
