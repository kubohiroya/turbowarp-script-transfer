// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import {markCoreMenuItems} from '../dist/menu.js';
import {finalizeTransferMenu} from '../dist/index.js';

const blockly = {ADD_COMMENT: 'コメントを追加', DELETE_BLOCK: 'ブロックを削除', DELETE_X_BLOCKS: '%1 個のブロックを削除',
    EDIT_PROCEDURE: '編集', DUPLICATE: '複製'};
const addonMessages = {'editor-devtools/make-space': 'スペースを確保', 'editor-devtools/copy-all': 'すべてコピー',
    'editor-devtools/copy-block': 'ブロックをコピー', 'editor-devtools/cut-block': 'ブロックを切り取り'};
const item = (text, extra = {}) => ({text, enabled: true, callback () {}, ...extra});
const labels = {cutBlock: 'このブロックだけ切り取り', copyBlock: 'このブロックだけコピー', copyBelow: 'ここから下をコピー'};
// The order a block menu reaches the GUI in: Blockly, this package, then editor-devtools.
const blockMenu = core => {
    const items = core.map(text => item(text));
    markCoreMenuItems(items, blockly);
    return [...items,
        item('かたまりをファイルに保存…', {_twPlusMenuRole: 'save'}),
        item('かたまりごとコピー', {_twPlusMenuRole: 'copyStack', _twPlusMenuLabels: labels}),
        item('スペースを確保', {separator: true}), item('すべてコピー'), item('ブロックをコピー'), item('ブロックを切り取り')];
};
const shown = items => items.map(({text, separator}) => separator ? `--- ${text}` : text);

test('a definition block menu goes edit, cut, copy, save, arrange, delete with dividers between', () => {
    const items = finalizeTransferMenu(blockMenu(['コメントを追加', 'ブロックを削除', '編集']), {addonMessages});
    assert.deepEqual(shown(items), [
        '編集', 'コメントを追加',
        '--- このブロックだけ切り取り',
        '--- このブロックだけコピー', 'ここから下をコピー', 'かたまりごとコピー',
        '--- かたまりをファイルに保存…',
        '--- スペースを確保',
        '--- ブロックを削除'
    ]);
    assert.deepEqual(items.slice(2, 5).map(entry => entry.twPlusMenuIcon), ['cut', 'copy', 'copy']);
});

test('duplicate joins the copies, and the count in a delete label still finds it', () => {
    const items = finalizeTransferMenu(blockMenu(['複製', 'コメントを追加', '3 個のブロックを削除']), {addonMessages});
    assert.deepEqual(shown(items).slice(2, 7),
        ['--- 複製', 'このブロックだけコピー', 'ここから下をコピー', 'かたまりごとコピー', '--- かたまりをファイルに保存…']);
    assert.equal(shown(items).at(-1), '--- 3 個のブロックを削除');
});

test('items from other addons stay in their order, with their dividers, before deletion', () => {
    const items = blockMenu(['コメントを追加', 'ブロックを削除']);
    items.push(item('PNG として保存', {separator: true}), item('SVG として保存'), item('定義へ移動'));
    assert.deepEqual(shown(finalizeTransferMenu(items, {addonMessages})).slice(-4),
        ['--- PNG として保存', 'SVG として保存', '定義へ移動', '--- ブロックを削除']);
});

test('without the GUI addon strings, editor-devtools items keep their labels and stay together', () => {
    const items = finalizeTransferMenu(blockMenu(['コメントを追加', 'ブロックを削除']));
    assert.deepEqual(shown(items).slice(-5),
        ['--- スペースを確保', 'すべてコピー', 'ブロックをコピー', 'ブロックを切り取り', '--- ブロックを削除']);
});

test('a workspace menu keeps its order and the host paste replaces the addon one of the same name', () => {
    const items = [item('整理する'), item('貼り付け'), item('ファイルから読み込み…'), item('貼り付け', {_twPlusTransfer: true})];
    assert.deepEqual(shown(finalizeTransferMenu(items, {addonMessages})), ['整理する', 'ファイルから読み込み…', '貼り付け']);
});
