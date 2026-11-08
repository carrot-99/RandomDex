// 公開ファイルのバージョンを更新する（ブラウザのキャッシュ対策）
// GitHub Pages はファイルごとに10分キャッシュされるため、更新直後に
// 新しい index.html と古い JS が混ざることがある。index.html の data-version と
// すべての ?v= を同じ値に書き換え、JS・CSS・JSON をまとめて取り直させる。
//
// 使い方: node scripts/bumpVersion.mjs   （公開する変更をコミットする前に実行）

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = path.join(rootDir, 'index.html');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const version = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;

const html = await readFile(indexPath, 'utf8');
const updated = html
  .replace(/data-version="[^"]*"/, `data-version="${version}"`)
  .replace(/\?v=[0-9A-Za-z]+/g, `?v=${version}`);
await writeFile(indexPath, updated);
console.log(`version: ${version}`);
