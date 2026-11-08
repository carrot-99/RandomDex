// 結果表示（workConfig.json の displayFields に従って項目を並べる）
// 画面側は作品固有の項目名を持たず、format ごとの表示部品だけを用意する。
// 新しい format を増やすときは formatRenderers に1つ追加する。

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function isEmpty(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

// 読みやすい文字色（背景色の明るさで白か黒を選ぶ）
function textColorFor(hexColor) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hexColor ?? '');
  if (!match) return '#fff';
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 165 ? '#1f2328' : '#fff';
}

// 各部品は { element, wide } を返す。wide は横幅いっぱいに表示する部品
const formatRenderers = {
  // 値をそのまま表示（unit があれば付ける）
  plain(value, field) {
    const text = isEmpty(value) ? '—' : Array.isArray(value) ? value.join('、') : `${value}${field.unit ? ` ${field.unit}` : ''}`;
    return { element: createElement('span', 'fieldText', text), wide: false };
  },

  // 4桁ゼロ埋め（No.0026）
  zeroPad4(value) {
    return { element: createElement('span', 'fieldText fieldNumber', `No.${String(value).padStart(4, '0')}`), wide: false };
  },

  // 色分けしたバッジ（colors に値ごとの色を指定）
  badges(value, field) {
    const list = createElement('span', 'badgeList');
    for (const entry of [].concat(value ?? [])) {
      const badge = createElement('span', 'badge', entry);
      const color = field.colors?.[entry];
      if (color) {
        badge.style.background = color;
        badge.style.color = textColorFor(color);
      }
      list.append(badge);
    }
    return { element: list, wide: false };
  },

  // 数値と横棒グラフ、合計値
  statBars(value, field) {
    const table = createElement('div', 'statBars');
    const max = field.max ?? 255;
    for (const stat of field.items ?? []) {
      const number = value?.[stat.key] ?? 0;
      const row = createElement('div', 'statRow');
      const bar = createElement('span', 'statBar');
      const fill = createElement('span', 'statBarFill');
      const ratio = Math.min(number / max, 1);
      fill.style.width = `${ratio * 100}%`;
      // 値に応じて色を変える（低い：赤 → 黄 → 緑 → 高い：青）
      fill.style.background = `hsl(${Math.round(Math.min(number / 180, 1) * 200)} 70% 50%)`;
      bar.append(fill);
      row.append(createElement('span', 'statLabel', stat.label), createElement('span', 'statValue', number), bar);
      table.append(row);
    }
    if (field.totalKey) {
      const row = createElement('div', 'statRow statTotal');
      row.append(
        createElement('span', 'statLabel', field.totalLabel ?? '合計'),
        createElement('span', 'statValue', value?.[field.totalKey] ?? 0),
        createElement('span', ''),
      );
      table.append(row);
    }
    return { element: table, wide: true };
  },

  // 折り返し表示の長文。sourceKey の値を出典として小さく添える
  longText(value, field, item) {
    const wrapper = createElement('div', 'longText');
    if (isEmpty(value)) {
      wrapper.append(createElement('p', 'longTextBody isEmpty', field.emptyText ?? '—'));
      return { element: wrapper, wide: true };
    }
    wrapper.append(createElement('p', 'longTextBody', value));
    const source = field.sourceKey ? item.attributes[field.sourceKey] : '';
    if (source) wrapper.append(createElement('p', 'longTextSource', `（${source}）`));
    return { element: wrapper, wide: true };
  },

  // 小さなタグを並べる。collapseAfter 件を超える分は折りたたむ
  chips(value, field) {
    const values = [].concat(value ?? []);
    const wrapper = createElement('div', 'chipArea');
    const list = createElement('div', 'chipList');
    const limit = field.collapseAfter ?? Infinity;
    values.forEach((entry, index) => {
      const chip = createElement('span', 'chip', entry);
      if (index >= limit) chip.classList.add('isCollapsible');
      list.append(chip);
    });
    wrapper.append(list);
    if (values.length > limit) {
      list.classList.add('isCollapsed');
      const toggle = createElement('button', 'chipToggle', `ほか${values.length - limit}件を表示`);
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        const collapsed = list.classList.toggle('isCollapsed');
        toggle.textContent = collapsed ? `ほか${values.length - limit}件を表示` : '折りたたむ';
      });
      wrapper.append(toggle);
    }
    if (values.length === 0) list.append(createElement('span', 'fieldText', '—'));
    return { element: wrapper, wide: true };
  },
};

export function renderDetail(container, item, workConfig) {
  container.replaceChildren();
  for (const field of workConfig.displayFields) {
    const renderer = formatRenderers[field.format] ?? formatRenderers.plain;
    const { element, wide } = renderer(item.attributes[field.key], field, item);
    const row = createElement('div', wide ? 'detailRow isWide' : 'detailRow');
    row.append(createElement('dt', 'detailLabel', field.label));
    const description = createElement('dd', 'detailValue');
    description.append(element);
    row.append(description);
    container.append(row);
  }
}
