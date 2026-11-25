# TurboWarp Script Transfer

English | [日本語](README.ja.md)

`@kubohiroya/turbowarp-script-transfer` provides script file transfer, copying and pasting between editor windows, and stage file transfer. It does not import GUI internals: the host supplies its VM, ScratchBlocks, workspace, Document, JSZip, and the VM's `deserializeBlocks` function.

Specifications and task tracking: [Editor #93](https://github.com/kubohiroya/turbowarp-plus-editor/issues/93), [#94](https://github.com/kubohiroya/turbowarp-plus-editor/issues/94), and [#95](https://github.com/kubohiroya/turbowarp-plus-editor/issues/95).

## API

- `attachScriptTransfer({vm, ScratchBlocks, workspace, document, locale, canUse, onError})`: attaches script/workspace context menus and Ctrl/Cmd+C/V. Call the returned `dispose()` to detach them.
- `stageTransferMenu({vm, document, locale, Zip, deserializeBlocks, onError})`: returns stage `contextItems` and backdrop-picker `backdropItems`.
- `finalizeTransferMenu(items, {addonMessages})`: call after GUI addons have added their menu items. It resolves duplicate paste commands and orders a block menu as edit/comment, cut, copy (duplicate, this block only, from here down, whole stack), save to file, tidy up leaving room below this stack (editor-devtools' make space), other addon items, delete, with a divider between groups. `addonMessages` are the GUI's addon strings, used to find editor-devtools' copy, cut and make-space items and name them by what they do. Items carry `twPlusMenuIcon` for the host's icons.
- `exportScript(vm, target, rootId)` / `importScript(vm, target, payload, options)` / `parseScript(text)`: shared format, dependency collection, and import operations.
- `exportStage(vm, stage, {Zip})` / `importStage(vm, buffer, {Zip, deserializeBlocks})`: stage ZIP operations.

The Editor host attaches these functions only when `twPlusScriptTransfer=1` is present at startup. The package does not attach itself automatically.

## `.blocks3` v1

A UTF-8 JSON file:

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

`blocks` is an array of VM block objects in the same format as standalone backpack blocks. It includes the entire stack containing the selected block and recursively includes any custom block definitions that stack calls. Each `variables` entry is `{id, name, type, scope, value}`. `type` is `""`, `"list"`, or `"broadcast_msg"`; `scope` is `"local"` or `"global"`. Broadcast messages are global.

`extensionIDs` lists extensions in dependency-first order. It is optional for compatibility with early v1 files; when omitted, the VM infers extension IDs from block opcodes. `extensionURLs` maps IDs to URLs. Embedded Plus extensions carry their actual code as data URLs so they can be transferred without network access. Approval and trust records are never transferred: imports use the destination VM's existing extension security checks. Plus-specific distribution settings are not retained; imported extensions are saved as ordinary VM extension URLs.

Variables and lists with matching names, types, and scopes reuse the destination's existing data and keep its current values. New entries receive fresh IDs and copies of their initial values. Importing into the stage converts local variables to globals. When a new local name conflicts with an existing global name, the local is given a numbered name. Cloud variables are imported as ordinary variables. Custom block definitions with conflicting names are renamed together with their imported calls.

Script input files are limited to 8 MiB and 10,000 blocks. Unknown format versions, invalid block references, cycles, and missing variable dependencies are rejected. The VM's `shareBlocksToTarget` regenerates block IDs.

## Clipboard

Same-origin windows use both BroadcastChannel and localStorage. A window opened after a copy can still retrieve the last script. The last script remains in localStorage until another copy replaces it or the site's stored data is cleared.

On supported browsers, the Async Clipboard API writes both `web application/x.turbowarp.blocks3+json` and readable scratchblocks `text/plain`. Same-origin transfer remains available when OS clipboard access is denied or custom MIME types are unsupported. Browsers without custom MIME support may still receive plain text. Reading JSON across origins requires custom MIME support and clipboard read permission.

Text is generated from the displayed block labels, dropdowns, numeric/string inputs, and nested C blocks. Complete text reproduction of extension-specific icons and syntax is not guaranteed. Ctrl/Cmd+C/V in input fields and dialogs is left to the native controls.

## `.stage3`

A ZIP with `sprite.json` and its assets, using the same structure as `.sprite3` with `isStage: true`. Extension metadata uses the same `extensionIDs` and `extensionURLs` fields described above.

Import adds contents to the current stage. Existing backdrops, sounds, scripts, and variables are retained, as are settings such as the current backdrop and tempo. Variables, lists, messages, and custom block definitions follow the same rules as script import. Conflicting backdrop and sound names receive numbered names, and literal references in backdrop/sound menus are updated. Names computed by expressions and numeric asset references are not converted automatically. Both the input file and the total expanded assets are limited to 64 MiB each.

All assets are checked before installation. If installation fails partway through, newly added blocks, variables, backdrops, and sounds are removed. Extensions that were approved and already loaded are not unloaded. Transfers into a VM are serialized.

## TypeScript and development

The implementation lives in `src/*.ts` and compiles with strict TypeScript checks. The package exports compiled ESM from `dist/index.js` and public type declarations from `dist/index.d.ts`, including the script file format and the host VM, target, workspace, and menu interfaces. GUI modules remain host-supplied ports rather than package dependencies.

```sh
npm ci
npm run typecheck
npm test
```

`npm test` builds the package before running its tests. The `prepare` script builds Git dependencies automatically. To generate the compiled output explicitly, run `npm run build`.

## Verification and rollback

`npm test` runs the clipboard, menu, extension-dependency, and real-VM transfer tests. The 12 cases in `test/format.test.mjs` and `test/stage.test.mjs` come from [Editor #741](https://github.com/kubohiroya/turbowarp-plus-editor/issues/741). They cover recursive procedures, variable scopes, extension permission refusal, concurrent imports, committed block IDs, stage archives, and rollback after asset failures. They run in Node.js without a GUI checkout, Editor build, browser, or OS input.

The test-only VM is fixed to `e623546e0e173d70e0314d06d8a17bf84c72afeb`, matching Editor's `site/source.json` and the dependency of its pinned GUI `b2e75a129546db48e6563f72c80a3d3d46d86fb5`. Storage and ZIP are also development dependencies; the published library still receives these ports from its host. Asset decoding is stubbed in the stage tests. The real GUI, rendering, and asset-decoding checks remain in Editor's `script-transfer.spec.cts` suite.

The existing CI runs these cases through `npm test`. Remove the original Editor tests only after the migration PR is merged and its CI succeeds. To undo the test migration, revert the added tests and development dependencies; the production implementation, package version, and transfer formats are unchanged.

The two migrated test files retain their original GPL-3.0-or-later license, with its text in `test/LICENSE.GPL-3.0`. They are not included in the npm archive. The library remains MPL-2.0.

To roll back, remove `twPlusScriptTransfer=1` from the startup URL and reload. Without the integration hooks, the GUI retains its original behavior. Projects containing imported content remain ordinary SB3 files.

## Release

`.github/workflows/release.yml` publishes to npm. Push a `v<version>` tag that names the
`package.json` version on a `main` commit: the workflow runs the tests, packs the archive, attaches it
to the GitHub Release, publishes it to npm and points `latest` and `next` at it. It authenticates with
npm Trusted Publishing (OIDC), not a token, and publishes with provenance. The npm settings name this
workflow file, so rename both together.

## License

This package is licensed under the [Mozilla Public License 2.0](LICENSE).
