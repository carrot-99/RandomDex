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
