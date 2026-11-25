# TurboWarp Script Transfer

[English](README.md) | 日本語

`@kubohiroya/turbowarp-script-transfer` は、スクリプト単位のファイル転送・ウィンドウ間のコピーと貼り付け・ステージ単位のファイル転送を実装するパッケージです。GUI内部のモジュールには依存せず、VM・ScratchBlocks・ワークスペース・Document・JSZip・VMの `deserializeBlocks` を呼び出し側から受け取ります。

関連仕様: [Editor #93](https://github.com/kubohiroya/turbowarp-plus-editor/issues/93)、[#94](https://github.com/kubohiroya/turbowarp-plus-editor/issues/94)、[#95](https://github.com/kubohiroya/turbowarp-plus-editor/issues/95)。タスク管理はこれらのIssueで行います。

## API

- `attachScriptTransfer({vm, ScratchBlocks, workspace, document, locale, canUse, onError})`: スクリプト・ワークスペースの右クリックメニューと Ctrl/Cmd+C・V を接続します。戻り値の `dispose()` で接続を解除します。
- `stageTransferMenu({vm, document, locale, Zip, deserializeBlocks, onError})`: ステージの `contextItems` と背景選択の `backdropItems` を返します。
- `finalizeTransferMenu(items, {addonMessages})`: GUIのアドオンがメニューを作った後に呼びます。ホストの貼り付けと同名の項目を統一し、ブロックのメニューを「編集・コメント → 切り取り → コピー（複製・このブロックだけ・ここから下・かたまりごと）→ ファイルに保存 → このかたまりの下を空けて整列（editor-devtools のスペースを確保）→ ほかのアドオンの項目 → 削除」の順に並べ、グループの間に仕切りを入れます。`addonMessages` はGUIのアドオンの文言で、editor-devtools のコピー・切り取り・スペースを確保の項目を見分け、何をするかが分かる名前に変えるのに使います。項目にはホストがアイコンを描くための `twPlusMenuIcon` を付けます。
- `exportScript(vm, target, rootId)` / `importScript(vm, target, payload, options)` / `parseScript(text)`: 共通の書式・依存収集・読み込みです。
- `exportStage(vm, stage, {Zip})` / `importStage(vm, buffer, {Zip, deserializeBlocks})`: ステージのZIPを扱います。

ホストは起動時に `twPlusScriptTransfer=1` が指定された場合だけ接続します。パッケージ自体は機能を自動的に接続しません。

## `.blocks3` v1

UTF-8 JSONです。

```json
{
  "format": "turbowarp-script",
  "version": 1,
  "blocks": [],
  "variables": [],
  "extensionIDs": [],
  "extensionURLs": {}
}
```

`blocks` はバックパックのstandaloneブロックJSONと同じVMブロックの配列です。選択したブロックを含むスタック全体と、そこから呼ぶブロック定義を再帰的に含みます。`variables` の各項目は `{id, name, type, scope, value}` で、`type` は `""` / `"list"` / `"broadcast_msg"`、`scope` は `"local"` / `"global"` です。メッセージはglobalとして扱います。

`extensionIDs` は依存先から順に並べたIDの配列です。初期v1ファイルとの互換性のため省略時はVMがブロックのopcodeから判断します。`extensionURLs` はIDからURLへの対応です。Plusの埋め込み拡張は実際のコードをdata URLとして含み、ネットワーク不要で持ち出せます。承認・信頼情報は転送せず、読み込み先でVMの既存の拡張セキュリティ確認を通します。Plus固有の配布設定は引き継がず、取り込んだ拡張は通常のVM拡張URLとして保存されます。

同じ名前・種類・スコープの変数やリストは既存のものへ対応付け、読み込み先の値を保持します。新規のものには新しいIDを発行し、初期値をコピーします。ステージへの読み込みではローカル変数をglobalへ変換します。ローカル名が既存global名と競合するときは新規ローカル名へ番号を付けます。cloud変数は通常変数として読み込みます。同名のブロック定義は読み込む側の定義名と呼び出しをまとめて変更します。

ファイル入力は8 MiB、ブロックは10,000個までです。不明なバージョン、不正なブロック参照、循環、欠落した変数依存を拒否します。VMの `shareBlocksToTarget` がブロックIDを再発行します。

## クリップボード

同じオリジンではBroadcastChannelとlocalStorageを併用します。後から開いたウィンドウも最後のコピーを受け取れます。localStorageには最後のスクリプトが残り、次のコピーまたはサイトデータの消去で更新・削除されます。

対応ブラウザのAsync Clipboard APIへ `web application/x.turbowarp.blocks3+json` と `text/plain` のscratchblocks記法を一緒に書きます。OSの許可がない場合やcustom MIME非対応の場合にも、同じオリジンの転送は使えます。custom MIME非対応時はテキストだけを書ける場合があります。別オリジンのJSON読み取りにはcustom MIMEの対応と読み取り許可が必要です。

テキストは表示中のブロックのラベル、ドロップダウン、数値・文字列入力とCブロックの入れ子から生成します。拡張機能の独自アイコンや独自の構文の完全なテキスト再現は保証しません。入力欄・モーダル内のCtrl/Cmd+C・Vは横取りしません。

## `.stage3`

`.sprite3` と同じ `sprite.json` とアセットのZIPで、`isStage: true` です。拡張情報は上記と同じ `extensionIDs` / `extensionURLs` を使います。

読み込みは追加方式です。既存の背景・音・スクリプト・変数を保持し、現在の背景やテンポなどの設定も維持します。変数・リスト・メッセージ・ブロック定義の規則はスクリプトと共通です。同名の背景・音には番号を付け、ブロックの背景・音メニューのリテラル名を更新します。計算式で生成するアセット名や番号による指定は自動変換しません。ファイルと展開アセットの合計の上限は各64 MiBです。

アセットをすべて検査した後に追加し、追加途中の失敗時は新規のブロック・変数・背景・音を取り消します。承認して既に読み込まれた拡張そのものはアンロードしません。1つのVMへの転送は直列化します。

## TypeScriptと開発

実装は `src/*.ts` に置き、TypeScriptの厳密な型チェックでコンパイルします。パッケージは `dist/index.js` のESMと `dist/index.d.ts` の公開型定義を提供します。ファイル形式、VM・ターゲット・ワークスペース・メニューなどのホスト側ポートも型として公開し、GUI内部のモジュールには依存しません。

```sh
npm ci
npm run typecheck
npm test
```

`npm test` はビルド後にテストを実行します。Git依存としてインストールすると `prepare` で自動ビルドします。ビルドだけを行う場合は `npm run build` を使います。

## 検証と切り戻し

`npm test` はクリップボード・メニュー・拡張依存と、実 VM での転送を検証します。`test/format.test.mjs` と `test/stage.test.mjs` の12件は [Editor #741](https://github.com/kubohiroya/turbowarp-plus-editor/issues/741) の移管対象です。再帰的なブロック定義、変数のスコープ、拡張の許可拒否、同時取り込み、確定したブロック ID、ステージの ZIP、素材の取り込み失敗時の巻戻しを確認します。Node.js で実行し、GUI checkout・Editor ビルド・ブラウザー・OS 入力は必要ありません。

テスト専用 VM は `e623546e0e173d70e0314d06d8a17bf84c72afeb` に固定し、Editor の `site/source.json` と固定 GUI `b2e75a129546db48e6563f72c80a3d3d46d86fb5` の依存に合わせます。storage と ZIP も開発依存だけに追加し、配布ライブラリでは従来どおりホストから受け取ります。ステージのテストでは素材のデコードを代役に置き換えます。実 GUI・描画・素材デコードの検証は Editor の `script-transfer.spec.cts` に残します。

既存 CI の `npm test` で移管対象も実行します。移管 PR のマージと CI 成功を確認してから、Editor の元テストを削除します。移管を取り消す場合は、追加したテストと開発依存を revert します。製品実装、パッケージの版、転送形式は変更しません。

移管した2つのテストファイルは、移管元の GPL-3.0-or-later を保持し、ライセンス本文を `test/LICENSE.GPL-3.0` に置きます。npm アーカイブには含めません。ライブラリ本体は MPL-2.0 のままです。

切り戻しは起動URLの `twPlusScriptTransfer=1` を外して再読込します。口を渡さなければGUIは元の動作を保ちます。保存済みプロジェクトは通常のSB3です。

## 公開

npm への公開は `.github/workflows/release.yml` が行う。`package.json` の版と同じ `v<版>` のタグを
`main` のコミットに push すると、テストを通したうえで npm に入れるアーカイブを作り、GitHub Release に
添付してから npm に公開し、`latest` と `next` をその版に向ける。認証はトークンではなく npm の
Trusted Publisher（OIDC）で、provenance を付けて公開する。npm 側の設定にはこのワークフローの
ファイル名をそのまま登録するため、改名するときは npm の設定も合わせる。

## ライセンス

このパッケージには [Mozilla Public License 2.0](LICENSE) が適用されます。
