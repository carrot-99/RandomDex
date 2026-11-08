// One Piece Wiki（https://onepiece.fandom.com/ 、CC BY-SA）から works/onePiece/items.json を生成する
// 使い方: node scripts/onePiece/buildItems.mjs
//   --refresh  キャッシュを無視して取得し直す
//
// - 対象：Wiki の Male Characters / Female Characters カテゴリ（原作キャラ）のうち、懸賞金が判明しているキャラ
//   buildRules.json の include / exclude で個別に追加・除外できる
// - 文章（キャラ紹介など）は取らず、事実の項目だけを取る
// - 取得結果は scripts/onePiece/.cache/ に保存する（コミットしない）
// - 実行後に scripts/onePiece/buildReport.md に検証レポートを出す

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../..');
const cacheDir = path.join(scriptDir, '.cache');
const outputPath = path.join(rootDir, 'works/onePiece/items.json');
const reportPath = path.join(scriptDir, 'buildReport.md');
const buildRulesPath = path.join(scriptDir, 'buildRules.json');
const manualItemsPath = path.join(scriptDir, 'manualItems.json');

const apiUrl = 'https://onepiece.fandom.com/api.php';
const requestIntervalMs = 1000;
const batchSize = 50;
const refresh = process.argv.includes('--refresh');

const characterCategories = { 'Male Characters': '男性', 'Female Characters': '女性' };
const devilFruitTypes = { Paramecia: '超人系', Zoan: '動物系', Logia: '自然系' };
const months = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};
// 現在の所属ではないことを示す注記
const pastAffiliationPattern = /\((?:[^)]*\b)?(former|formerly|disbanded|defected|dissolved|deceased|retired|fired|expelled|left|ex)\b[^)]*\)/i;

// ---------------------------------------------------------------------------
// 取得（キャッシュ付き・間隔を空けて順に取得）
// ---------------------------------------------------------------------------

let lastRequestAt = 0;
let networkCount = 0;

async function api(params) {
  const query = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const url = `${apiUrl}?${query}`;
  const cacheFile = path.join(cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`);
  if (!refresh && existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, 'utf8'));

  const wait = lastRequestAt + requestIntervalMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      lastRequestAt = Date.now();
      const response = await fetch(url, { headers: { 'User-Agent': 'RandomDex-buildItems (personal, non-commercial)' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (json.error) throw new Error(json.error.info);
      await writeFile(cacheFile, JSON.stringify(json));
      networkCount += 1;
      return json;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw lastError;
}

async function categoryMembers(category) {
  const titles = [];
  let cont = {};
  do {
    const json = await api({ action: 'query', list: 'categorymembers', cmtitle: `Category:${category}`, cmlimit: '500', cmnamespace: '0', ...cont });
    titles.push(...json.query.categorymembers.map((member) => member.title));
    cont = json.continue ? { cmcontinue: json.continue.cmcontinue } : null;
  } while (cont);
  return titles;
}

// 複数ページの本文（wikitext）をまとめて取得。リダイレクトは転送先の本文になる
async function fetchWikitexts(titles) {
  const result = new Map();
  const unique = [...new Set(titles)];
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    const json = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', titles: batch.join('|') });
    const redirects = new Map((json.query.redirects ?? []).map((r) => [r.from, r.to]));
    const normalized = new Map((json.query.normalized ?? []).map((n) => [n.from, n.to]));
    const byTitle = new Map(json.query.pages.map((page) => [page.title, page.revisions?.[0]?.slots?.main?.content ?? null]));
    for (const title of batch) {
      let resolved = normalized.get(title) ?? title;
      resolved = redirects.get(resolved) ?? resolved;
      result.set(title, { title: resolved, text: byTitle.get(resolved) ?? null });
    }
    if (unique.length > batchSize) console.log(`  …${Math.min(i + batchSize, unique.length)}/${unique.length}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// wikitext の読み取り
// ---------------------------------------------------------------------------

// {{Name ...}} の範囲を、入れ子の {{ }} を数えて取り出す
export function findTemplate(text, name) {
  const start = text.search(new RegExp(`\\{\\{\\s*${name.replace(/ /g, '[ _]')}\\s*[|\\n}]`));
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length - 1; i += 1) {
    if (text[i] === '{' && text[i + 1] === '{') { depth += 1; i += 1; }
    else if (text[i] === '}' && text[i + 1] === '}') {
      depth -= 1;
      i += 1;
      if (depth === 0) return text.slice(start + 2, i - 1);
    }
  }
  return null;
}

// テンプレートの中身を、入れ子を考慮して | で区切る
function splitTopLevel(body) {
  const parts = [];
  let depthCurly = 0;
  let depthSquare = 0;
  let current = '';
  for (let i = 0; i < body.length; i += 1) {
    const two = body.slice(i, i + 2);
    if (two === '{{') { depthCurly += 1; current += two; i += 1; continue; }
    if (two === '}}') { depthCurly -= 1; current += two; i += 1; continue; }
    if (two === '[[') { depthSquare += 1; current += two; i += 1; continue; }
    if (two === ']]') { depthSquare -= 1; current += two; i += 1; continue; }
    if (body[i] === '|' && depthCurly === 0 && depthSquare === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += body[i];
  }
  parts.push(current);
  return parts;
}

export function templateParams(body) {
  const params = {};
  for (const part of splitTopLevel(body).slice(1)) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    params[part.slice(0, separator).trim().toLowerCase()] = part.slice(separator + 1).trim();
  }
  return params;
}

// 一番外側のテンプレートを1つずつ置き換える
function replaceTemplates(text, replacer) {
  let output = '';
  let i = 0;
  while (i < text.length) {
    if (text.startsWith('{{', i)) {
      let depth = 0;
      let j = i;
      for (; j < text.length - 1; j += 1) {
        if (text.startsWith('{{', j)) { depth += 1; j += 1; }
        else if (text.startsWith('}}', j)) { depth -= 1; j += 1; if (depth === 0) break; }
      }
      const inner = text.slice(i + 2, j - 1);
      const parts = splitTopLevel(inner);
      output += replacer(parts[0].trim(), parts.slice(1).map((p) => p.trim()));
      i = j + 1;
    } else {
      output += text[i];
      i += 1;
    }
  }
  return output;
}

// wikitext → 表示用の文字列
export function cleanText(text) {
  if (!text) return '';
  let s = text.replace(/<ref[^>]*\/>/gi, '').replace(/<ref[\s\S]*?<\/ref>/gi, '');
  s = s.replace(/<s>[\s\S]*?<\/s>/gi, '');
  s = replaceTemplates(s, (name, args) => {
    const key = name.toLowerCase();
    if (key === 'ruby') return args[0] ?? '';
    if (key === 'nihongo') return args[1] ?? args[0] ?? '';
    if (key === 'w') return (args[1] ?? args[0] ?? '').replace(/^.*\|/, '');
    return '';
  });
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  s = s.replace(/'''?/g, '');
  return s.replace(/[ \t]+/g, ' ').trim();
}

function firstLinkTarget(text) {
  const match = /\[\[([^\]|#]+)/.exec(text ?? '');
  return match ? match[1].trim() : null;
}

// 項目の値を「<br />」「;」で区切った要素に分ける（参照や注記は残したまま）
function splitEntries(value) {
  const withoutRefs = (value ?? '').replace(/<ref[\s\S]*?<\/ref>/gi, '');
  const cleaned = replaceTemplates(withoutRefs, (name, args) => {
    const key = name.toLowerCase();
    if (key === 'qref' || key === 'web ref' || key === 'b') return '';
    if (key === 'status') return `(${args[0] ?? ''})`;
    return `{{${[name, ...args].join('|')}}}`;
  });
  return cleaned.split(/<br\s*\/?>|;/i).map((part) => part.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 各項目
// ---------------------------------------------------------------------------

export function parseBounty(value) {
  // 取り消し線（<s>）の無い最初の金額が現在の懸賞金。
  // すべて取り消し線（故人など）の場合は、最初に書かれている金額（最終の懸賞金）を使う
  let struck = null;
  for (const entry of (value ?? '').split(/<br\s*\/?>|\n/i)) {
    const text = entry.replace(/<ref[\s\S]*?<\/ref>/gi, '').replace(/<\/?s>/gi, '');
    const withoutTemplates = replaceTemplates(text, () => '');
    const match = /(\d{1,3}(?:,\d{3})+|\d+)/.exec(withoutTemplates);
    if (!match) continue;
    const amount = Number(match[1].replace(/,/g, ''));
    if (!/<s>/i.test(entry)) return amount;
    struck ??= amount;
  }
  return struck;
}

function parseHeight(value) {
  const matches = [...cleanText(value).matchAll(/(\d+(?:\.\d+)?)\s*cm/g)];
  // 子ども時代などの値も並ぶため、最も大きい値（大人になってからの身長）を使う
  return matches.length ? Math.max(...matches.map((m) => Number(m[1]))) : null;
}

function parseBirthday(value) {
  const match = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/.exec(cleanText(value));
  return match ? `${months[match[1]]}月${Number(match[2])}日` : '';
}

function parseFirstChapter(value) {
  const match = /Chapter\s+(\d+)/.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

function parseEpithet(value) {
  const nihongo = findTemplate(value ?? '', 'Nihongo');
  if (nihongo) return cleanText(splitTopLevel(nihongo)[2] ?? '');
  return '';
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

// ページ本文から Box（Char Box など）を探す。主要キャラは「〇〇 Tabs Top」テンプレートの中にある
async function resolveBoxes(pages, boxName) {
  const boxes = new Map();
  const needTemplate = new Map();
  for (const [title, page] of pages) {
    const body = page.text ? findTemplate(page.text, boxName) : null;
    if (body) {
      boxes.set(title, templateParams(body));
      continue;
    }
    const tabs = /\{\{\s*([^{}|]+?Tabs Top)\s*[|}]/.exec(page.text ?? '');
    if (tabs) needTemplate.set(title, `Template:${tabs[1].trim()}`);
  }
  const templates = await fetchWikitexts([...needTemplate.values()]);
  for (const [title, templateTitle] of needTemplate) {
    const text = templates.get(templateTitle)?.text;
    const body = text ? findTemplate(text, boxName) : null;
    if (body) boxes.set(title, templateParams(body));
  }
  return boxes;
}

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const rules = existsSync(buildRulesPath) ? JSON.parse(await readFile(buildRulesPath, 'utf8')) : {};
  const includeTitles = new Set(rules.include ?? []);
  const excludeTitles = new Set(Object.keys(rules.exclude ?? {}));
  const nameOverrides = rules.names ?? {};

  console.log('キャラクター一覧を取得中…');
  const genderByTitle = new Map();
  for (const [category, gender] of Object.entries(characterCategories)) {
    for (const title of await categoryMembers(category)) genderByTitle.set(title, gender);
  }
  for (const title of includeTitles) if (!genderByTitle.has(title)) genderByTitle.set(title, '');
  console.log(`キャラクター ${genderByTitle.size} 件の本文を取得中…`);
  const characterPages = await fetchWikitexts([...genderByTitle.keys()]);
  const charBoxes = await resolveBoxes(characterPages, 'Char Box');

  const report = { noBox: [], noJapaneseName: [], excluded: [], unresolvedAffiliations: new Map(), unresolvedFruits: new Set() };
  const candidates = [];
  for (const [title, gender] of genderByTitle) {
    const box = charBoxes.get(title);
    if (!box) {
      report.noBox.push(title);
      continue;
    }
    const bounty = parseBounty(box.bounty);
    if (excludeTitles.has(title)) {
      report.excluded.push(`${title}（${rules.exclude[title]}）`);
      continue;
    }
    if (bounty === null && !includeTitles.has(title)) continue;
    candidates.push({ title, gender, box, bounty });
  }

  // 所属・悪魔の実の日本語名は、それぞれのページの jname / Box から取る
  const affiliationTargets = new Map(); // title -> [entry]
  for (const candidate of candidates) {
    candidate.affiliationTitles = [];
    for (const entry of splitEntries(candidate.box.affiliation)) {
      if (pastAffiliationPattern.test(entry) || /noncanon/i.test(entry)) continue;
      const target = firstLinkTarget(entry);
      if (target) candidate.affiliationTitles.push(target);
    }
    candidate.fruitTitle = firstLinkTarget(candidate.box.dfname);
    for (const target of candidate.affiliationTitles) affiliationTargets.set(target, true);
  }
  console.log(`所属 ${affiliationTargets.size} 件の日本語名を取得中…`);
  const affiliationPages = await fetchWikitexts([...affiliationTargets.keys()]);
  const japaneseNameOf = new Map();
  const needBox = new Map();
  for (const [title, page] of affiliationPages) {
    const jname = /\|\s*jname\s*=\s*([^\n]*)/.exec(page.text ?? '');
    if (jname && cleanText(jname[1])) japaneseNameOf.set(title, cleanText(jname[1]));
    else needBox.set(title, page);
  }
  for (const boxName of ['Crew Box', 'Organization Box', 'Location Box', 'Ship Box', 'Char Box']) {
    if (needBox.size === 0) break;
    const boxes = await resolveBoxes(needBox, boxName);
    for (const [title, params] of boxes) {
      const jname = cleanText(params.jname ?? '');
      if (jname) {
        japaneseNameOf.set(title, jname);
        needBox.delete(title);
      }
    }
  }

  const fruitTitles = [...new Set(candidates.map((c) => c.fruitTitle).filter(Boolean))];
  console.log(`悪魔の実 ${fruitTitles.length} 件の日本語名を取得中…`);
  const fruitPages = await fetchWikitexts(fruitTitles);
  const fruitBoxes = await resolveBoxes(fruitPages, 'Devil Fruit Box');
  const fruitNameOf = new Map();
  for (const title of fruitTitles) {
    const params = fruitBoxes.get(title);
    const jname = cleanText(params?.jname ?? params?.jpname ?? '');
    if (jname) fruitNameOf.set(title, jname);
  }

  const items = [];
  for (const { title, gender, box, bounty, affiliationTitles, fruitTitle } of candidates) {
    const name = nameOverrides[title] ?? cleanText(box.jname);
    if (!name) {
      report.noJapaneseName.push(title);
      continue;
    }
    const affiliations = [];
    for (const target of affiliationTitles) {
      const ja = japaneseNameOf.get(target);
      if (ja) {
        if (!affiliations.includes(ja)) affiliations.push(ja);
      } else {
        report.unresolvedAffiliations.set(target, (report.unresolvedAffiliations.get(target) ?? 0) + 1);
      }
    }
    let devilFruit = '';
    if (fruitTitle) {
      devilFruit = fruitNameOf.get(fruitTitle) ?? '';
      if (!devilFruit) report.unresolvedFruits.add(fruitTitle);
    }
    const typeMatch = /\[\[(Paramecia|Zoan|Logia)/.exec(box.dftype ?? '');
    items.push({
      id: title.replace(/ /g, '_'),
      name,
      subName: '',
      images: [],
      attributes: {
        epithet: parseEpithet(box.epithet),
        bounty,
        affiliations,
        devilFruit,
        devilFruitType: fruitTitle ? devilFruitTypes[typeMatch?.[1]] ?? '不明' : 'なし',
        gender,
        birthday: parseBirthday(box.birth),
        heightCm: parseHeight(box.height),
        firstChapter: parseFirstChapter(box.first),
      },
    });
  }

  // 手入力の補正（同じ id は attributes ごと上書き、無ければ追加）
  let manualCount = 0;
  if (existsSync(manualItemsPath)) {
    for (const manual of JSON.parse(await readFile(manualItemsPath, 'utf8'))) {
      const index = items.findIndex((item) => item.id === manual.id);
      if (index >= 0) items[index] = { ...items[index], ...manual, attributes: { ...items[index].attributes, ...manual.attributes } };
      else items.push(manual);
      manualCount += 1;
    }
  }

  // 懸賞金の高い順（同額・不明は初登場順）
  items.sort((a, b) => (b.attributes.bounty ?? -1) - (a.attributes.bounty ?? -1)
    || (a.attributes.firstChapter ?? 9999) - (b.attributes.firstChapter ?? 9999));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `[\n${items.map((item) => JSON.stringify(item)).join(',\n')}\n]\n`);
  await writeFile(reportPath, buildReport({ total: genderByTitle.size, items, report, manualCount }));
  console.log(`完了: ${items.length} 件を出力（ネットワーク取得 ${networkCount} 件）`);
  console.log(`レポート: ${path.relative(rootDir, reportPath)}`);
}

function buildReport({ total, items, report, manualCount }) {
  const count = (predicate) => items.filter(predicate).length;
  const lines = [
    '# ONE PIECE items.json 検証レポート', '',
    'このファイルは `node scripts/onePiece/buildItems.mjs` が自動生成する。データ元：One Piece Wiki（CC BY-SA）。', '',
    '## 概要', '',
    '| 項目 | 値 |', '| --- | --- |',
    `| Wiki の原作キャラ（男性・女性カテゴリ） | ${total} |`,
    `| 出力件数（懸賞金が判明しているキャラ＋include） | ${items.length} |`,
    `| 異名あり | ${count((i) => i.attributes.epithet)} |`,
    `| 悪魔の実の能力者 | ${count((i) => i.attributes.devilFruitType !== 'なし')} |`,
    `| 所属なし（解決できなかった含む） | ${count((i) => i.attributes.affiliations.length === 0)} |`,
    `| 誕生日あり | ${count((i) => i.attributes.birthday)} |`,
    `| 身長あり | ${count((i) => i.attributes.heightCm)} |`,
    `| 初登場話あり | ${count((i) => i.attributes.firstChapter)} |`,
    `| manualItems.json から反映 | ${manualCount} |`,
    '',
    '## 懸賞金トップ20', '',
    '| 名前 | 懸賞金 | 所属 |', '| --- | --- | --- |',
    ...items.slice(0, 20).map((i) => `| ${i.name} | ${i.attributes.bounty?.toLocaleString('ja-JP') ?? '—'} | ${i.attributes.affiliations.slice(0, 3).join('、')} |`),
    '',
    '## 日本語名が無く除外したキャラ', '',
    report.noJapaneseName.length ? report.noJapaneseName.map((t) => `- ${t}`).join('\n') : 'なし',
    '',
    '## buildRules.json で除外', '',
    report.excluded.length ? report.excluded.map((t) => `- ${t}`).join('\n') : 'なし',
    '',
    '## 日本語名を解決できなかった所属（件数順）', '',
    ...[...report.unresolvedAffiliations].sort((a, b) => b[1] - a[1]).map(([title, n]) => `- ${title}（${n}）`),
    '',
    '## 日本語名を解決できなかった悪魔の実', '',
    ...([...report.unresolvedFruits].map((t) => `- ${t}`)),
    '',
    `## Char Box が見つからなかったページ（${report.noBox.length}件、先頭50件）`, '',
    ...report.noBox.slice(0, 50).map((t) => `- ${t}`),
    '',
  ];
  return lines.join('\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
