// SPDX-License-Identifier: GPL-3.0-or-later
// From turbowarp-plus-editor/test/script-transfer/format.test.ts at 83bd60f.
// The original test license is retained; see LICENSE.GPL-3.0 in this directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {exportScript, importScript, importScriptWithReceipt, parseScript, validateScript} from '../dist/index.js';
const require = createRequire(import.meta.url);
const VM = require('scratch-vm');
const blank = isStage => ({isStage, name: isStage ? 'Stage' : 'Sprite', variables: {}, lists: {}, broadcasts: {},
    blocks: {}, comments: {}, costumes: [], sounds: [], currentCostume: 0, volume: 100, layerOrder: isStage ? 0 : 1});
const makeVM = async t => {
    const vm = new VM();
    t.after(() => vm.runtime.dispose());
    await vm.loadProject(JSON.stringify({targets: [blank(true), blank(false)], monitors: [], extensions: [], meta: {semver: '3.0.0'}}));
    return vm;
};
const block = (id, opcode, options = {}) => ({id, opcode, inputs: {}, fields: {}, parent: null,
    next: null, topLevel: true, shadow: false, x: 10, y: 20, ...options});
const field = (name, id, value) => ({name, id, value});
const source = vm => {
    const sprite = vm.editingTarget;
    const stage = vm.runtime.getTargetForStage();
    stage.createVariable('global', 'score', ''); stage.variables.global.value = 23;
    stage.createVariable('message', 'go', 'broadcast_msg');
    sprite.createVariable('local', 'items', 'list'); sprite.variables.local.value = ['あ', 2];
    for (const b of [
        block('call', 'procedures_call', {mutation: {tagName: 'mutation', children: [], proccode: 'work', argumentids: '[]', warp: 'false'}, next: 'broadcast'}),
        block('broadcast', 'event_broadcast', {parent: 'call', topLevel: false,
            inputs: {BROADCAST_INPUT: {name: 'BROADCAST_INPUT', block: 'messageblock', shadow: 'messageblock'}}}),
        block('messageblock', 'event_broadcast_menu', {parent: 'broadcast', topLevel: false, shadow: true,
            fields: {BROADCAST_OPTION: field('BROADCAST_OPTION', 'message', 'go')}}),
        block('def', 'procedures_definition', {inputs: {custom_block: {name: 'custom_block', block: 'prototype', shadow: 'prototype'}}, next: 'set'}),
        block('prototype', 'procedures_prototype', {parent: 'def', topLevel: false, shadow: true,
            mutation: {tagName: 'mutation', children: [], proccode: 'work', argumentids: '[]', argumentnames: '[]', argumentdefaults: '[]', warp: 'false'}}),
        block('set', 'data_setvariableto', {parent: 'def', topLevel: false, next: 'list', fields: {VARIABLE: field('VARIABLE', 'global', 'score')}}),
        block('list', 'data_deletealloflist', {parent: 'set', topLevel: false, fields: {LIST: field('LIST', 'local', 'items')}})
    ]) sprite.blocks.createBlock(b);
    return sprite;
};

test('a script includes recursive procedure dependencies and preserves variable scopes and Unicode', async t => {
    const vm = await makeVM(t);
    const script = exportScript(vm, source(vm), 'call');
    assert.equal(script.blocks.length, 7);
    assert.deepEqual(script.variables.map(v => [v.name, v.type, v.scope]).sort(),
        [['go', 'broadcast_msg', 'global'], ['items', 'list', 'local'], ['score', '', 'global']]);
    assert.deepEqual(parseScript(JSON.stringify(script)), script);
    // A recursive definition is included once, without recursively following it forever.
    vm.editingTarget.blocks.getBlock('list').next = 'recursive';
    vm.editingTarget.blocks.createBlock(block('recursive', 'procedures_call', {parent: 'list', topLevel: false,
        mutation: {tagName: 'mutation', children: [], proccode: 'work', argumentids: '[]', warp: 'false'}}));
    assert.equal(exportScript(vm, vm.editingTarget, 'call').blocks.length, 8);
});

test('VM import merges globals by name and type, retains destination values and gives locals fresh IDs', async t => {
    const a = await makeVM(t); const b = await makeVM(t);
    const script = exportScript(a, source(a), 'call');
    const stage = b.runtime.getTargetForStage();
    stage.createVariable('different-id', 'score', ''); stage.variables['different-id'].value = 99;
    stage.createVariable('local', 'unrelated', '');
    await importScript(b, b.editingTarget, script);
    assert.equal(stage.variables['different-id'].value, 99);
    assert.equal(stage.variables.local.name, 'unrelated');
    const local = Object.values(b.editingTarget.variables).find(v => v.name === 'items');
    assert.deepEqual(local.value, ['あ', 2]);
    assert.notEqual(local.id, 'local');
    const imported = Object.values(b.editingTarget.blocks._blocks);
    assert.equal(imported.length, 7);
    assert.equal(imported.find(b => b.opcode === 'data_setvariableto').fields.VARIABLE.id, 'different-id');
    assert.equal(imported.some(b => script.blocks.some(s => s.id === b.id)), false);
    await importScript(b, b.editingTarget, script);
    assert.equal(new Set(Object.values(b.editingTarget.blocks._blocks).filter(b => b.opcode === 'procedures_prototype')
        .map(b => b.mutation.proccode)).size, 2);
    assert.equal(script.blocks[0].id, 'call', 'import must not mutate the file or clipboard');
});

test('local variables become globals on stage and retain list/scalar distinctions', async t => {
    const a = await makeVM(t); const b = await makeVM(t);
    const stage = b.runtime.getTargetForStage();
    stage.createVariable('scalar', 'items', '');
    await importScript(b, stage, exportScript(a, source(a), 'call'));
    assert.deepEqual(Object.values(stage.variables).find(v => v.name === 'items' && v.type === 'list').value, ['あ', 2]);
    assert.equal(stage.variables.scalar.type, '');
});

test('extension URLs go through the VM permission check; rejection adds no blocks or variables', async t => {
    const vm = await makeVM(t);
    const target = source(vm);
    const script = exportScript(vm, target, 'call');
    script.blocks.push(block('extension', 'unsafe_run'));
    script.extensionURLs.unsafe = 'https://example.org/extension.js';
    const b = await makeVM(t);
    const urls = [];
    b.securityManager.canLoadExtensionFromProject = async url => { urls.push(url); return false; };
    await assert.rejects(importScript(b, b.editingTarget, script), /Permission.*denied/);
    assert.deepEqual(urls, ['https://example.org/extension.js']);
    assert.deepEqual(Object.keys(b.editingTarget.blocks._blocks), []);
    assert.deepEqual(Object.keys(b.editingTarget.variables), []);
});

test('malformed, cyclic, unsupported and incomplete files are rejected', async t => {
    const vm = await makeVM(t);
    const script = exportScript(vm, source(vm), 'call');
    const mutate = fn => { const input = structuredClone(script); fn(input); return () => validateScript(input); };
    assert.throws(mutate(s => { s.version = 2; }), /Unsupported/);
    assert.throws(mutate(s => { s.blocks[0].next = 'missing'; }), /Dangling/);
    assert.throws(mutate(s => { s.blocks[0].next = 'call'; }), /Cyclic/);
    assert.throws(mutate(s => { s.variables = []; }), /Missing variable/);
    assert.throws(mutate(s => { s.blocks.push(s.blocks[0]); }), /Invalid block/);
});

test('concurrent pastes serialize variable and procedure conflict resolution', async t => {
    const a = await makeVM(t); const b = await makeVM(t);
    const script = exportScript(a, source(a), 'call');
    await Promise.all([importScript(b, b.editingTarget, script), importScript(b, b.editingTarget, script)]);
    assert.equal(Object.values(b.editingTarget.variables).filter(v => v.name === 'items').length, 1);
    const definitions = Object.values(b.editingTarget.blocks._blocks).filter(b => b.opcode === 'procedures_prototype');
    assert.deepEqual(definitions.map(b => b.mutation.proccode).sort(), ['work', 'work (2)']);
});


test('receipt import uses the VM-assigned IDs without selecting the destination', async t => {
    const vm = await makeVM(t);
    const sprite = source(vm);
    const stage = vm.runtime.getTargetForStage();
    const input = exportScript(vm, sprite, 'call');
    const sourceIds = Object.keys(sprite.blocks._blocks);
    let committed;
    const result = await importScriptWithReceipt(vm, stage, input, {
        onCommitted(receipt) {
            committed = receipt;
            assert.deepEqual(new Set(receipt.blockIds), new Set(Object.keys(stage.blocks._blocks)));
        }
    });
    assert.equal(result, committed);
    assert.deepEqual(result.rootBlockIds, stage.blocks.getScripts());
    assert.equal(result.blockIds.length, input.blocks.length);
    assert.ok(result.blockIds.every(id => !sourceIds.includes(id)));
    assert.deepEqual(Object.keys(sprite.blocks._blocks), sourceIds);
    assert.equal(vm.editingTarget, sprite);
    assert.equal(vm.runtime.getEditingTarget(), sprite);
});
