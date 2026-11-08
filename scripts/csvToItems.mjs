// 手作りの CSV から items.json を作る（PokeAPI のような公開データが無い作品用）
// 使い方: node scripts/csvToItems.mjs <入力.csv> <出力 items.json>
//
// CSV の1行目は列名。決まった列と、それ以外（attributes に入る列）に分かれる。
//   id        必須。一意なID（例：luffy）
//   name      必須。表示名
//   subName   任意。補足名（例：ギア5）
//   images    任意。「ラベル=URL」を | で区切る。URL だけでもよい（ラベルは「通常」）
//   その他    attributes に入る。列名の後ろに型を付けられる
//             「bounty:number」→ 数値、「affiliation:list」→ | 区切りの配列、型なし → 文字列
// 空のセルは、文字列なら ""、数値なら null、配列なら [] になる。
// Excel / スプレッドシートの「CSV（UTF-8）」で保存したファイルを想定（先頭の BOM は無視する）。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixedColumns = new Set(['id', 'name', 'subName', 'images']);

// ダブルクォート・改行・カンマを含むセルに対応した CSV 読み取り
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // 空行は捨てる
  return rows.filter((r) => r.some((value) => value.trim() !== ''));
}

function parseImages(value) {
  return value.split('|').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf('=');
    // 「ラベル=https://...」の形。URL 自体に = が含まれることがあるので http の前の = だけを区切りとみなす
    if (separator > 0 && !part.slice(0, separator).includes('://')) {
      return { label: part.slice(0, separator).trim(), url: part.slice(separator + 1).trim() };
    }
    return { label: '通常', url: part };
  });
}

function convertValue(raw, type, where) {
  const value = raw.trim();
  if (type === 'number') {
    if (value === '') return null;
    const number = Number(value.replace(/,/g, ''));
    if (Number.isNaN(number)) throw new Error(`${where}: 数値ではありません「${value}」`);
    return number;
  }
  if (type === 'list') return value === '' ? [] : value.split('|').map((part) => part.trim()).filter(Boolean);
  return value;
}

export function csvToItems(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('CSV が空です');
  const columns = header.map((name) => {
    const [key, type = 'string'] = name.trim().split(':');
    if (!['string', 'number', 'list'].includes(type)) throw new Error(`列「${name}」の型「${type}」は使えません（number / list / なし）`);
    return { key, type };
  });
  for (const required of ['id', 'name']) {
    if (!columns.some((column) => column.key === required)) throw new Error(`必須の列「${required}」がありません`);
  }

  const seenIds = new Set();
  return rows.map((cells, index) => {
    const line = index + 2; // 1行目は列名
    const item = { id: '', name: '', subName: '', images: [], attributes: {} };
    columns.forEach((column, columnIndex) => {
      const raw = cells[columnIndex] ?? '';
      const where = `${line}行目「${column.key}」`;
      if (column.key === 'images') item.images = parseImages(raw);
      else if (fixedColumns.has(column.key)) item[column.key] = raw.trim();
      else item.attributes[column.key] = convertValue(raw, column.type, where);
    });
    if (!item.id) throw new Error(`${line}行目: id が空です`);
    if (!item.name) throw new Error(`${line}行目: name が空です`);
    if (seenIds.has(item.id)) throw new Error(`${line}行目: id「${item.id}」が重複しています`);
    seenIds.add(item.id);
    return item;
  });
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('使い方: node scripts/csvToItems.mjs <入力.csv> <出力 items.json>');
    process.exit(1);
  }
  const items = csvToItems(await readFile(input, 'utf8'));
  await mkdir(path.dirname(output), { recursive: true });
  // 1件1行の JSON（ポケモンの items.json と同じ形式）
  await writeFile(output, `[\n${items.map((item) => JSON.stringify(item)).join(',\n')}\n]\n`);
  const withoutImage = items.filter((item) => item.images.length === 0).length;
  console.log(`${items.length} 件を出力しました（画像なし ${withoutImage} 件）: ${output}`);
}

// コマンドとして実行されたときだけ main を動かす（他のスクリプトから import しても動かない）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`エラー: ${error.message}`);
    process.exit(1);
  });
}
