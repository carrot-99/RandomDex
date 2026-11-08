// PokeAPI から works/pokemon/items.json を生成するスクリプト
// 使い方: node scripts/pokemon/buildItems.mjs
//   --refresh  キャッシュを無視して取得し直す
//
// 取得結果は scripts/pokemon/.cache/ に保存する（コミットしない）。
// 実行後に scripts/pokemon/buildReport.md に検証レポートを出力する。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '../..');
const cacheDir = path.join(scriptDir, '.cache');
const outputPath = path.join(rootDir, 'works/pokemon/items.json');
const reportPath = path.join(scriptDir, 'buildReport.md');
const manualItemsPath = path.join(scriptDir, 'manualItems.json');
// 除外する姿・ラベルの上書き・分類の補完など、作成者の判断を書くファイル
const buildRulesPath = path.join(scriptDir, 'buildRules.json');

const genderLabels = { 'オスのすがた': 'オス', 'メスのすがた': 'メス' };

const apiBase = 'https://pokeapi.co/api/v2';
const requestIntervalMs = 60;
const expectedSpeciesCount = 1025;
const refresh = process.argv.includes('--refresh');

// ---------------------------------------------------------------------------
// 固定の対応表
// ---------------------------------------------------------------------------

const typeNameJa = {
  normal: 'ノーマル', fire: 'ほのお', water: 'みず', electric: 'でんき', grass: 'くさ', ice: 'こおり',
  fighting: 'かくとう', poison: 'どく', ground: 'じめん', flying: 'ひこう', psychic: 'エスパー', bug: 'むし',
  rock: 'いわ', ghost: 'ゴースト', dragon: 'ドラゴン', dark: 'あく', steel: 'はがね', fairy: 'フェアリー',
};

const statKeys = {
  hp: 'hp', attack: 'attack', defense: 'defense',
  'special-attack': 'spAttack', 'special-defense': 'spDefense', speed: 'speed',
};

const generationNumber = {
  'generation-i': 1, 'generation-ii': 2, 'generation-iii': 3, 'generation-iv': 4, 'generation-v': 5,
  'generation-vi': 6, 'generation-vii': 7, 'generation-viii': 8, 'generation-ix': 9,
};

// 登場ソフトの表示名（発売順）。キーは PokeAPI の version-group 名。
// 追加コンテンツや海外版は本編の表示名にまとめる。
// nationalMaxGen：全国図鑑があるソフトで、図鑑に載る最大の世代（BDSPは第4世代まで）。
// コロシアム・XD は図鑑が無いため対象外。
const gameList = [
  { name: '赤・緑', nationalMaxGen: 1, groups: ['red-green-japan', 'red-blue'] },
  { name: '青', nationalMaxGen: 1, groups: ['blue-japan'] },
  { name: 'ピカチュウ', nationalMaxGen: 1, groups: ['yellow'] },
  { name: '金・銀', nationalMaxGen: 2, groups: ['gold-silver'] },
  { name: 'クリスタル', nationalMaxGen: 2, groups: ['crystal'] },
  { name: 'ルビー・サファイア', nationalMaxGen: 3, groups: ['ruby-sapphire'] },
  { name: 'ファイアレッド・リーフグリーン', nationalMaxGen: 3, groups: ['firered-leafgreen'] },
  { name: 'エメラルド', nationalMaxGen: 3, groups: ['emerald'] },
  { name: 'ダイヤモンド・パール', nationalMaxGen: 4, groups: ['diamond-pearl'] },
  { name: 'プラチナ', nationalMaxGen: 4, groups: ['platinum'] },
  { name: 'ハートゴールド・ソウルシルバー', nationalMaxGen: 4, groups: ['heartgold-soulsilver'] },
  { name: 'ブラック・ホワイト', nationalMaxGen: 5, groups: ['black-white'] },
  { name: 'ブラック2・ホワイト2', nationalMaxGen: 5, groups: ['black-2-white-2'] },
  { name: 'X・Y', nationalMaxGen: 6, groups: ['x-y'] },
  { name: 'オメガルビー・アルファサファイア', nationalMaxGen: 6, groups: ['omega-ruby-alpha-sapphire'] },
  { name: 'サン・ムーン', nationalMaxGen: 7, groups: ['sun-moon'] },
  { name: 'ウルトラサン・ウルトラムーン', nationalMaxGen: 7, groups: ['ultra-sun-ultra-moon'] },
  { name: "Let's Go! ピカチュウ・Let's Go! イーブイ", groups: ['lets-go-pikachu-lets-go-eevee'] },
  { name: 'ソード・シールド', groups: ['sword-shield', 'the-isle-of-armor', 'the-crown-tundra'] },
  { name: 'ブリリアントダイヤモンド・シャイニングパール', nationalMaxGen: 4, groups: ['brilliant-diamond-shining-pearl'] },
  { name: 'Pokémon LEGENDS アルセウス', groups: ['legends-arceus'] },
  { name: 'スカーレット・バイオレット', groups: ['scarlet-violet', 'the-teal-mask', 'the-indigo-disk'] },
  { name: 'Pokémon LEGENDS Z-A', groups: ['legends-za', 'mega-dimension'] },
  { name: 'Pokémon Champions', groups: ['champions'] },
];

const gameIndexByGroup = new Map();
gameList.forEach((game, index) => game.groups.forEach((group) => gameIndexByGroup.set(group, index)));

// 日本語名が PokeAPI に無いバージョンの補完
const versionNameFallback = {
  'mega-dimension': 'Pokémon LEGENDS Z-A M次元ラッシュ',
  champions: 'Pokémon Champions',
};

// ---------------------------------------------------------------------------
// 取得（キャッシュ付き・順番に間隔を空けて取得）
// ---------------------------------------------------------------------------

let lastRequestAt = 0;
let networkCount = 0;

function cacheFileFor(url) {
  const key = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9.-]+/g, '_');
  return path.join(cacheDir, `${key}.json`);
}

async function getJson(url) {
  const cacheFile = cacheFileFor(url);
  if (!refresh && existsSync(cacheFile)) {
    return JSON.parse(await readFile(cacheFile, 'utf8'));
  }
  const wait = lastRequestAt + requestIntervalMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      lastRequestAt = Date.now();
      const response = await fetch(url, { headers: { 'User-Agent': 'RandomDex-buildItems' } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
      const json = await response.json();
      await writeFile(cacheFile, JSON.stringify(json));
      networkCount += 1;
      if (networkCount % 100 === 0) console.log(`  …${networkCount}件取得`);
      return json;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
  throw lastError;
}

const api = (endpoint) => getJson(endpoint.startsWith('http') ? endpoint : `${apiBase}/${endpoint}`);

// ---------------------------------------------------------------------------
// 補助関数
// ---------------------------------------------------------------------------

function pickJa(entries, field = 'name') {
  if (!entries) return '';
  const ja = entries.find((entry) => entry.language.name === 'ja');
  const kana = entries.find((entry) => entry.language.name === 'ja-hrkt');
  return (ja ?? kana)?.[field] ?? '';
}

function cleanFlavorText(text, language) {
  // 改行は語句の区切りなので全角スペースにする
  const joiner = '　';
  return text.replace(/­\n/g, '').replace(/[\n\f\r]+/g, joiner).replace(/　{2,}/g, '　').trim();
}

function pad4(number) {
  return String(number).padStart(4, '0');
}

function fileNameOf(url) {
  return url ? decodeURIComponent(url.split('/').pop()) : '';
}

function statsOf(pokemon) {
  const stats = {};
  for (const entry of pokemon.stats) stats[statKeys[entry.stat.name]] = entry.base_stat;
  stats.total = Object.values(stats).reduce((sum, value) => sum + value, 0);
  return stats;
}

function typesOf(pokemon) {
  return [...pokemon.types].sort((a, b) => a.slot - b.slot).map((entry) => typeNameJa[entry.type.name] ?? entry.type.name);
}

// ---------------------------------------------------------------------------
// HOME 画像の存在確認（PokeAPI/sprites リポジトリのファイル一覧を取得）
// ---------------------------------------------------------------------------

async function loadHomeImageIndex() {
  const githubApi = 'https://api.github.com/repos/PokeAPI/sprites';
  const otherDir = await getJson(`${githubApi}/contents/sprites/pokemon/other`);
  const homeSha = otherDir.find((entry) => entry.name === 'home').sha;
  const homeTree = await getJson(`${githubApi}/git/trees/${homeSha}`);
  const femaleSha = homeTree.tree.find((entry) => entry.path === 'female').sha;
  const femaleTree = await getJson(`${githubApi}/git/trees/${femaleSha}`);
  return {
    normal: new Set(homeTree.tree.filter((e) => e.type === 'blob').map((e) => e.path)),
    female: new Set(femaleTree.tree.filter((e) => e.type === 'blob').map((e) => e.path)),
  };
}

function homeImageExists(index, url) {
  if (!url) return false;
  const fileName = fileNameOf(url);
  return url.includes('/home/female/') ? index.female.has(fileName) : index.normal.has(fileName);
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

async function main() {
  await mkdir(cacheDir, { recursive: true });
  const buildRules = existsSync(buildRulesPath) ? JSON.parse(await readFile(buildRulesPath, 'utf8')) : {};
  const excludeNames = new Set(Object.keys(buildRules.exclude ?? {}));
  const labelOverrides = buildRules.labels ?? {};
  const categoryOverrides = buildRules.categories ?? {};

  console.log('バージョン情報を取得中…');
  const versionGroupInfo = new Map(); // name -> { generation }
  const versionInfo = new Map(); // name -> { group, nameJa }
  for (const ref of (await api('version-group?limit=200')).results) {
    const group = await api(ref.url);
    versionGroupInfo.set(group.name, {
      generation: generationNumber[group.generation.name],
      pokedexes: group.pokedexes.map((p) => p.name),
    });
  }
  for (const ref of (await api('version?limit=200')).results) {
    const version = await api(ref.url);
    versionInfo.set(version.name, {
      group: version.version_group.name,
      nameJa: pickJa(version.names) || versionNameFallback[version.name] || version.name,
    });
  }
  const groupsByPokedex = new Map();
  for (const [groupName, info] of versionGroupInfo) {
    for (const dex of info.pokedexes) {
      if (!groupsByPokedex.has(dex)) groupsByPokedex.set(dex, new Set());
      groupsByPokedex.get(dex).add(groupName);
    }
  }
  const unknownGroups = [...versionGroupInfo.keys()].filter((g) => !gameIndexByGroup.has(g));

  console.log('HOME画像の一覧を取得中…');
  const homeIndex = await loadHomeImageIndex();

  const report = {
    excluded: [], // { id, name, reason }
    separateForms: [], // item
    mergedImages: [], // { item, labels }
    missingHome: [], // { id, label, url, fallback }
    missingJa: [], // { id, field }
    noGames: [],
    emptyFlavor: [],
  };

  const speciesRefs = (await api('pokemon-species?limit=2000')).results;
  console.log(`種族 ${speciesRefs.length} 件を処理します`);
  const items = [];

  for (const [speciesIndex, speciesRef] of speciesRefs.entries()) {
    const species = await api(speciesRef.url);
    if ((speciesIndex + 1) % 100 === 0) console.log(`種族 ${speciesIndex + 1}/${speciesRefs.length}`);

    const dexNo = species.id;
    const nameJa = pickJa(species.names);
    const categoryJa = pickJa(species.genera, 'genus');
    if (!nameJa) report.missingJa.push({ id: pad4(dexNo), field: '名前' });
    if (!categoryJa) report.missingJa.push({ id: pad4(dexNo), field: categoryOverrides[dexNo] ? `分類（buildRules.json で補完：${categoryOverrides[dexNo]}）` : '分類' });

    // 図鑑説明文：日本語がある中で最新のソフト。同じソフトなら漢字（ja）を優先
    let flavor = null;
    for (const entry of species.flavor_text_entries) {
      const language = entry.language.name;
      if (language !== 'ja' && language !== 'ja-hrkt') continue;
      const version = versionInfo.get(entry.version.name);
      const gameIndex = gameIndexByGroup.get(version?.group) ?? -1;
      // 同じソフト内ではバージョンIDが大きいもの（後発・追加コンテンツ）を優先
      const rank = Number(entry.version.url.match(/(\d+)\/$/)[1]);
      const better = !flavor || gameIndex > flavor.gameIndex
        || (gameIndex === flavor.gameIndex && language === 'ja' && flavor.language !== 'ja')
        || (gameIndex === flavor.gameIndex && language === flavor.language && rank > flavor.rank);
      if (better) {
        flavor = { gameIndex, rank, language, text: cleanFlavorText(entry.flavor_text, language), game: version?.nameJa ?? entry.version.name };
      }
    }
    if (!flavor) report.emptyFlavor.push(pad4(dexNo));

    // 種族として登場するソフト（version-group）：地方図鑑 + 説明文
    const speciesGroups = new Set();
    for (const dex of species.pokedex_numbers) {
      for (const group of groupsByPokedex.get(dex.pokedex.name) ?? []) speciesGroups.add(group);
    }
    for (const entry of species.flavor_text_entries) {
      const group = versionInfo.get(entry.version.name)?.group;
      if (group) speciesGroups.add(group);
    }

    // varieties を既定の姿から順に処理し、タイプ＋種族値が同じものを1件にまとめる
    const varieties = [...species.varieties].sort((a, b) => Number(b.is_default) - Number(a.is_default));
    const groups = []; // { key, pokemon, form, item, imageUrls:Set }

    for (const variety of varieties) {
      const pokemon = await api(variety.pokemon.url);
      const forms = [];
      for (const formRef of pokemon.forms) forms.push(await api(formRef.url));
      const mainForm = forms.find((f) => f.is_default) ?? forms[0];
      const varietyId = variety.is_default ? pad4(dexNo) : `${pad4(dexNo)}-${pokemon.name.replace(`${species.name}-`, '')}`;

      // 除外判定
      let excludeReason = '';
      if (excludeNames.has(pokemon.name)) excludeReason = `手動除外：${buildRules.exclude[pokemon.name]}`;
      else if (mainForm.is_mega || pokemon.name.includes('-mega')) excludeReason = 'メガシンカ';
      else if (pokemon.name.endsWith('-gmax')) excludeReason = 'キョダイマックス';
      else if (pokemon.name.includes('-primal')) excludeReason = 'ゲンシカイキ';
      else if (mainForm.is_battle_only) excludeReason = '戦闘中のみ';
      else if (pokemon.name.includes('-totem')) excludeReason = 'ぬしポケモン';
      if (excludeReason) {
        report.excluded.push({ id: varietyId, name: pokemon.name, nameJa: `${nameJa} ${pickJa(mainForm.form_names)}`.trim(), reason: excludeReason });
        continue;
      }

      const types = typesOf(pokemon);
      const stats = statsOf(pokemon);
      const key = JSON.stringify([types, stats]);

      // この姿の画像（姿に属する見た目違いとメスを含む）
      const images = [];
      // メスが別の姿として登録されている種族（ニャオニクス、イエッサン等）は front_female を使わない
      const hasFemaleImages = species.has_gender_differences
        && !species.varieties.some((v) => v.pokemon.name.endsWith('-female'));
      for (const form of forms) {
        // メスのフォルム（プルリル等）は HOME の front_female と重複するので使わない
        if (hasFemaleImages && form !== mainForm && genderLabels[pickJa(form.form_names)] === 'メス') continue;
        if (form !== mainForm && (form.is_battle_only || form.is_mega || excludeNames.has(form.name))) {
          report.excluded.push({ id: varietyId, name: form.name, nameJa: `${nameJa} ${pickJa(form.form_names)}`.trim(), reason: excludeNames.has(form.name) ? '手動除外（buildRules.json）' : form.is_mega ? 'メガシンカ' : '戦闘中のみ（見た目違い）' });
          continue;
        }
        const home = form.sprites?.other?.home ?? {};
        const pokemonHome = pokemon.sprites?.other?.home ?? {};
        const rawLabel = labelOverrides[form.name] ?? pickJa(form.form_names);
        // 「オスのすがた」「メスのすがた」は性別として扱う
        const formGender = genderLabels[rawLabel] ?? null;
        const formLabel = formGender ? '' : rawLabel;
        const defaultUrl = home.front_default ?? (form === mainForm ? pokemonHome.front_default : null);
        const fallbackUrl = form === mainForm
          ? pokemon.sprites?.other?.['official-artwork']?.front_default
          : null;
        const femaleUrl = hasFemaleImages ? home.front_female ?? (form === mainForm ? pokemonHome.front_female : null) : null;
        images.push({ formLabel, gender: formGender ?? (femaleUrl ? 'オス' : null), url: defaultUrl, fallbackUrl, isMain: form === mainForm, pokemonName: pokemon.name });
        if (femaleUrl) images.push({ formLabel, gender: 'メス', url: femaleUrl, fallbackUrl: null, isMain: false, pokemonName: pokemon.name });
      }

      const existing = groups.find((group) => group.key === key);
      if (existing) {
        existing.images.push(...images);
        existing.mergedNames.push(pokemon.name);
        continue;
      }

      const formIntroGroup = mainForm.version_group?.name;
      const generation = variety.is_default
        ? generationNumber[species.generation.name]
        : versionGroupInfo.get(formIntroGroup)?.generation ?? generationNumber[species.generation.name];

      groups.push({
        key,
        isDefault: variety.is_default,
        id: varietyId,
        pokemonName: pokemon.name,
        mergedNames: [],
        subName: pickJa(mainForm.form_names),
        formIntroGroup,
        images,
        attributes: {
          dexNo,
          category: categoryJa,
          types,
          heightM: pokemon.height / 10,
          weightKg: pokemon.weight / 10,
          stats,
          flavorText: flavor?.text ?? '',
          flavorTextGame: flavor?.game ?? '',
          games: [],
          generation,
        },
      });
    }

    for (const group of groups) {
      // 登場ソフト
      // - 全国図鑑があるソフト：その件の世代が図鑑の範囲内なら登場
      // - それ以外：地方図鑑・説明文に載っているソフト。別の姿はフォルム初登場以降に絞る（近似）
      const introIndex = group.isDefault ? -1 : gameIndexByGroup.get(group.formIntroGroup) ?? -1;
      const gameIndexes = new Set();
      gameList.forEach((game, index) => {
        if (game.nationalMaxGen && group.attributes.generation <= game.nationalMaxGen) gameIndexes.add(index);
      });
      for (const versionGroup of speciesGroups) {
        const index = gameIndexByGroup.get(versionGroup);
        if (index !== undefined && index >= introIndex) gameIndexes.add(index);
      }
      if (!group.isDefault && introIndex >= 0) gameIndexes.add(introIndex);
      group.attributes.games = [...gameIndexes].sort((a, b) => a - b).map((index) => gameList[index].name);
      if (group.attributes.games.length === 0) report.noGames.push(group.id);

      // 画像の確定
      // - HOME画像が無い場合：その件の先頭画像だけ代替（official-artwork）を使い、見た目違いは載せない
      // - 同じラベルの画像は同じ見た目とみなして1枚にする（例：きずなへんげゲッコウガ、メテノの流星の姿）
      const isCosmetic = new Set(group.images.map((image) => image.formLabel)).size > 1;
      const hasBothGenders = group.images.some((image) => image.gender === 'メス') && group.images.some((image) => image.gender === 'オス');
      const seenLabels = new Set();
      const finalImages = [];
      for (const image of group.images) {
        const base = isCosmetic ? image.formLabel : '';
        const gender = hasBothGenders ? image.gender : null;
        const label = base && gender ? `${base}（${gender}）` : base || gender || '通常';
        if (seenLabels.has(label)) continue;
        let url = image.url;
        if (!homeImageExists(homeIndex, url)) {
          const useFallback = finalImages.length === 0 && image.fallbackUrl;
          report.missingHome.push({ id: group.id, label, url: fileNameOf(url) || '(URLなし)', fallback: useFallback ? fileNameOf(image.fallbackUrl) : '載せない' });
          url = useFallback ? image.fallbackUrl : null;
        }
        if (!url) continue;
        seenLabels.add(label);
        finalImages.push({ label, url });
      }

      // id は別名の中で最も短い PokeAPI 名から作る（例：zygarde-10-power-construct より zygarde-10）
      let itemId = group.id;
      if (!group.isDefault) {
        const shortest = [group.pokemonName, ...group.mergedNames].sort((a, b) => a.length - b.length)[0];
        itemId = `${pad4(group.attributes.dexNo)}-${shortest.replace(`${species.name}-`, '')}`;
      }
      let subName = group.subName;
      if (finalImages.length > 1 && (isCosmetic || (hasBothGenders && genderLabels[subName]))) subName = '';

      const attributes = { ...group.attributes };
      if (categoryOverrides[dexNo] && !attributes.category) attributes.category = categoryOverrides[dexNo];
      const item = {
        id: itemId,
        name: nameJa,
        subName,
        images: finalImages,
        attributes,
      };
      items.push(item);
      if (!group.isDefault) report.separateForms.push(item);
      if (finalImages.length > 1) report.mergedImages.push({ item, mergedNames: group.mergedNames });
    }
  }

  // 手入力の補完データをマージ（同じ id は上書き、無ければ追加）
  let manualCount = 0;
  if (existsSync(manualItemsPath)) {
    const manualItems = JSON.parse(await readFile(manualItemsPath, 'utf8'));
    for (const manual of manualItems) {
      const index = items.findIndex((item) => item.id === manual.id);
      if (index >= 0) items[index] = manual;
      else items.push(manual);
      manualCount += 1;
    }
  }
  items.sort((a, b) => a.attributes.dexNo - b.attributes.dexNo || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 1件1行の JSON として出力（差分が読みやすく、サイズも抑えられる）
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `[\n${items.map((item) => JSON.stringify(item)).join(',\n')}\n]\n`);

  await writeFile(reportPath, buildReport({ speciesCount: speciesRefs.length, items, report, manualCount, unknownGroups }));
  console.log(`完了: ${items.length} 件を出力（ネットワーク取得 ${networkCount} 件）`);
  console.log(`レポート: ${path.relative(rootDir, reportPath)}`);
}

function buildReport({ speciesCount, items, report, manualCount, unknownGroups }) {
  const lines = [];
  const dexNos = new Set(items.map((item) => item.attributes.dexNo));
  const byGeneration = {};
  for (const item of items) byGeneration[item.attributes.generation] = (byGeneration[item.attributes.generation] ?? 0) + 1;

  lines.push('# items.json 検証レポート', '');
  lines.push('このファイルは `node scripts/pokemon/buildItems.mjs` が自動生成する。', '');
  lines.push('## 概要', '');
  lines.push('| 項目 | 値 |', '| --- | --- |');
  lines.push(`| PokeAPI の種族数 | ${speciesCount}（想定 ${expectedSpeciesCount}）${speciesCount === expectedSpeciesCount ? '' : ' ⚠'} |`);
  lines.push(`| items.json の図鑑No種類数 | ${dexNos.size} |`);
  lines.push(`| 総件数（別ポケモン扱いのフォルム含む） | ${items.length} |`);
  lines.push(`| 別ポケモン扱いのフォルム | ${report.separateForms.length} |`);
  lines.push(`| 見た目違いの画像を持つ件数 | ${report.mergedImages.length} |`);
  lines.push(`| 除外した姿 | ${report.excluded.length} |`);
  lines.push(`| HOME画像が無かった画像 | ${report.missingHome.length} |`);
  lines.push(`| 日本語の欠け | ${report.missingJa.length} |`);
  lines.push(`| 図鑑説明文なし | ${report.emptyFlavor.length} |`);
  lines.push(`| 登場ソフトなし | ${report.noGames.length} |`);
  lines.push(`| manualItems.json から反映 | ${manualCount} |`);
  lines.push('');
  lines.push('世代別件数: ' + Object.entries(byGeneration).map(([g, n]) => `第${g}世代 ${n}`).join(' / '), '');
  if (unknownGroups.length) lines.push(`⚠ 表示名が未定義の version-group: ${unknownGroups.join(', ')}`, '');

  lines.push('## 除外した姿', '');
  lines.push('| id | PokeAPI名 | 日本語 | 理由 |', '| --- | --- | --- | --- |');
  for (const e of report.excluded) lines.push(`| ${e.id} | ${e.name} | ${e.nameJa} | ${e.reason} |`);
  lines.push('');

  lines.push('## 別ポケモン扱いのフォルム', '');
  lines.push('| id | 名前 | フォルム名 | 世代 | タイプ | 合計 |', '| --- | --- | --- | --- | --- | --- |');
  for (const item of report.separateForms) {
    lines.push(`| ${item.id} | ${item.name} | ${item.subName} | ${item.attributes.generation} | ${item.attributes.types.join('/')} | ${item.attributes.stats.total} |`);
  }
  lines.push('');

  lines.push('## 見た目違いとしてまとめた画像', '');
  lines.push('| id | 名前 | 画像ラベル | まとめた姿 |', '| --- | --- | --- | --- |');
  for (const { item, mergedNames } of report.mergedImages) {
    lines.push(`| ${item.id} | ${item.name} ${item.subName} | ${item.images.map((i) => i.label).join('、')} | ${mergedNames.join(', ')} |`);
  }
  lines.push('');

  lines.push('## HOME画像が無かったもの', '');
  lines.push('代替（official-artwork 等）がある場合は暫定でそれを使用。「なし」は画像から除外した。', '');
  lines.push('| id | ラベル | HOMEのファイル | 代替 |', '| --- | --- | --- | --- |');
  for (const m of report.missingHome) lines.push(`| ${m.id} | ${m.label} | ${m.url} | ${m.fallback} |`);
  lines.push('');

  lines.push('## 日本語の欠け', '');
  for (const m of report.missingJa) lines.push(`- ${m.id}: ${m.field}`);
  if (report.emptyFlavor.length) lines.push(`- 図鑑説明文なし: ${report.emptyFlavor.join(', ')}`);
  if (report.noGames.length) lines.push(`- 登場ソフトなし: ${report.noGames.join(', ')}`);
  if (!report.missingJa.length && !report.emptyFlavor.length && !report.noGames.length) lines.push('なし');
  lines.push('');

  lines.push('## 既知の制約', '');
  lines.push('- 登場ソフトは「全国図鑑があるソフト（赤・緑〜USUM、BDSPは第4世代まで）で世代が範囲内」＋「地方図鑑・図鑑説明文に載っているソフト」。PokeAPI の game_indices は新作でもほぼ全種が入っているため使っていない。');
  lines.push('- 地方図鑑は種族単位のため、別ポケモン扱いのフォルムは「フォルム初登場ソフト以降」に絞った近似（例：アローラライチュウに BDSP・LEGENDS アルセウスが含まれる）。');
  lines.push('- PokeAPI に日本語の図鑑説明文が無い種族は説明文が空になる（主に第8世代後半〜第9世代）。');
  lines.push('- HOME画像が無い見た目違い（おきがえピカチュウ等）は載せていない。件の先頭画像が無い場合のみ official-artwork で代替する。');
  lines.push('- 図鑑説明文は種族単位のため、フォルムも既定の姿と同じ説明文になる。');
  lines.push('');
  return lines.join('\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
