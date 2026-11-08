// 結果表示（workConfig.json の displayFields に従って項目を並べる）
// ステップ3では値をそのまま文字で表示する。format ごとの部品はステップ4で作る。

function formatPlain(value, field) {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object') {
    return Object.entries(value).map(([key, v]) => `${key} ${v}`).join(' / ');
  }
  return field.unit ? `${value} ${field.unit}` : String(value);
}

export function renderDetail(container, item, workConfig) {
  container.replaceChildren();
  for (const field of workConfig.displayFields) {
    const term = document.createElement('dt');
    term.textContent = field.label;
    const description = document.createElement('dd');
    description.textContent = formatPlain(item.attributes[field.key], field);
    container.append(term, description);
  }
}
