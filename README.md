# TurboWarp Script Transfer

`@kubohiroya/turbowarp-script-transfer` は、スクリプト単位のファイル転送・ウィンドウ間のコピーと貼り付け・ステージ単位のファイル転送を実装するパッケージです。GUI内部のモジュールには依存せず、VM・ScratchBlocks・ワークスペース・Document・JSZip・VMの `deserializeBlocks` を呼び出し側から受け取ります。

関連仕様: [Editor #93](https://github.com/kubohiroya/turbowarp-plus-editor/issues/93)、[#94](https://github.com/kubohiroya/turbowarp-plus-editor/issues/94)、[#95](https://github.com/kubohiroya/turbowarp-plus-editor/issues/95)。タスク管理はこれらのIssueで行います。

## API

- `attachScriptTransfer({vm, ScratchBlocks, workspace, document, locale, canUse, onError})`: スクリプト・ワークスペースの右クリックメニューと Ctrl/Cmd+C・V を接続します。戻り値の `dispose()` で接続を解除します。
- `stageTransferMenu({vm, document, locale, Zip, deserializeBlocks, onError})`: ステージの `contextItems` と背景選択の `backdropItems` を返します。
- `finalizeTransferMenu(items)`: GUIのアドオンがメニューを作った後、ホストの貼り付けと同名の項目を統一します。
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

## 検証と切り戻し

`npm test` は依存不要のクリップボード・拡張依存テストです。実VM・GUI・アセットデコードの検証はEditorリポジトリの `test/script-transfer` と `script-transfer.spec.cts` で行います。

切り戻しは起動URLの `twPlusScriptTransfer=1` を外して再読込します。口を渡さなければGUIは元の動作を保ちます。保存済みプロジェクトは通常のSB3です。
