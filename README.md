# RandomDex

ランダムでキャラが選ばれる、スマホ向けの個人用Webアプリ。

- 公開URL: https://carrot-99.github.io/RandomDex/
- 設計書: [docs/designDoc.md](docs/designDoc.md)

## ローカルで動かす

ビルド工程はありません。リポジトリ直下で静的サーバーを起動してブラウザで開きます。

```bash
npx serve .
```

## ポケモンデータの生成

PokeAPI から `works/pokemon/items.json` を作り直します（Node.js 18 以上）。

```bash
node scripts/pokemon/buildItems.mjs
```

- 取得結果は `scripts/pokemon/.cache/` にキャッシュされます（コミットしません）。取り直すときは `--refresh` を付けます。
- 実行後、`scripts/pokemon/buildReport.md` に検証レポートが出ます。
- 除外する姿・ラベルの上書き・分類の補完は `scripts/pokemon/buildRules.json`、PokeAPI に無いデータの手入力は `scripts/pokemon/manualItems.json` に書きます。

## 公開前にバージョンを更新する

GitHub Pages はファイルごとに10分キャッシュされるため、更新直後に新旧のファイルが混ざってエラーになることがあります。公開する変更をコミットする前に、次を実行して `index.html` のバージョン（`?v=`）を更新してください。

```bash
node scripts/bumpVersion.mjs
```

JS ファイルを追加したときは、`index.html` の importmap にも1行追加します。

## ホーム画面に追加する

- iPhone（Safari）：共有ボタン →「ホーム画面に追加」
- Android（Chrome）：メニュー →「ホーム画面に追加」または「アプリをインストール」

アイコンは `node scripts/makeIcons.mjs` で `icons/` に生成します（外部ライブラリ不要）。

## 作品を追加する

1. `works/<作品ID>/workConfig.json` に表示項目（displayFields）・一覧の項目（listFields）・絞り込み（filters）を書く
2. `works/<作品ID>/items.json` を用意する。手作りの CSV からは次で変換できる

   ```bash
   node scripts/csvToItems.mjs <入力.csv> works/<作品ID>/items.json
   ```

   CSV は `id,name,subName,images,<属性>...` の列を持つ。属性の列名に `:number`（数値）や `:list`（`|` 区切りの配列）を付けられる。画像が無くても動く（抽選中は名前、結果は名前の1文字目を表示）
3. `works/workList.json` に作品を追加する。作品が2つ以上になるとヘッダーに切り替えが出る
