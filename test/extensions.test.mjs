// SPDX-License-Identifier: MPL-2.0

import test from 'node:test';
import assert from 'node:assert/strict';
import {extensionDependencies} from '../dist/extensions.js';

test('Plus embedded code and transitive dependencies are carried in dependency order', () => {
    const project = {turboWarpPlus: {extensions: [
        {id: 'dependent', dependencies: ['helper'], source: {type: 'embedded-file', path: 'extensions/main.js'}},
        {id: 'helper', dependencies: [], source: {type: 'embedded-data'}}
    ]}, extensionURLs: {helper: 'data:text/javascript;base64,YQ=='}};
    const bytes = new TextEncoder().encode('Scratch.extensions.register({}); // 日本語');
    const vm = {exportStandaloneBlocks: () => [], toJSON: () => JSON.stringify(project),
        saveProjectSb3DontZip: () => ({'extensions/main.js': bytes})};
    const dependencies = extensionDependencies(vm, [{opcode: 'dependent_run'}]);
    assert.deepEqual(dependencies.extensionIDs, ['helper', 'dependent']);
    assert.equal(dependencies.extensionURLs.helper, project.extensionURLs.helper);
    assert.equal(Buffer.from(dependencies.extensionURLs.dependent.split(',')[1], 'base64').toString(), new TextDecoder().decode(bytes));
});

test('unused Plus extensions are excluded and remote sources keep their original URL', () => {
    const project = {turboWarpPlus: {extensions: [
        {id: 'used', dependencies: [], source: {type: 'remote-non-cacheable', url: 'https://example.org/used.js'}},
        {id: 'unused', dependencies: [], source: {type: 'remote-cacheable', url: 'https://example.org/unused.js'}}
    ]}};
    const dependencies = extensionDependencies({exportStandaloneBlocks: () => [], toJSON: () => JSON.stringify(project)}, [{opcode: 'used_run'}]);
    assert.deepEqual(dependencies, {extensionIDs: ['used'], extensionURLs: {used: 'https://example.org/used.js'}});
});
