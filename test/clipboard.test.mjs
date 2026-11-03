import assert from 'node:assert/strict';
import test from 'node:test';
import {createScriptClipboard, CLIPBOARD_MIME, scratchblocksText} from '../index.js';
const script = {format: 'turbowarp-script', version: 1, blocks: [], variables: [], extensionURLs: {}};
const host = (storage, overrides = {}) => ({
    localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)},
    navigator: {clipboard: {async read () { throw new Error('Permission denied'); }, async write () { throw new Error('Permission denied'); }}},
    ...overrides
});

test('late-opening same-origin windows paste even when OS clipboard access is denied', async () => {
    const storage = new Map();
    const a = createScriptClipboard(host(storage));
    await a.copy(script, 'say [こんにちは]');
    const b = createScriptClipboard(host(storage));
    assert.deepEqual(await b.read(), script);
    a.dispose(); b.dispose();
});

test('OS clipboard carries both block JSON and readable scratchblocks; another origin can read it', async () => {
    let items;
    class ClipboardItem {
        constructor (types) { this.types = Object.keys(types); this.values = types; }
        getType (type) { return this.values[type]; }
    }
    const clipboard = {async write (value) { items = value; }, async read () { return items; }};
    const a = createScriptClipboard(host(new Map(), {Blob, ClipboardItem, navigator: {clipboard}}));
    await a.copy(script, 'say [こんにちは]');
    assert.deepEqual(items[0].types.sort(), [CLIPBOARD_MIME, 'text/plain'].sort());
    assert.equal(await items[0].values['text/plain'].text(), 'say [こんにちは]');
    const b = createScriptClipboard(host(new Map(), {navigator: {clipboard}}));
    assert.deepEqual(await b.read(), script);
    a.dispose(); b.dispose();
});

test('BroadcastChannel works with storage disabled and closes on dispose', async () => {
    const channels = new Set();
    class Channel {
        constructor () { channels.add(this); }
        postMessage (data) { for (const channel of channels) if (channel !== this) channel.onmessage?.({data}); }
        close () { channels.delete(this); }
    }
    const makeHost = () => host(new Map(), {BroadcastChannel: Channel,
        localStorage: {getItem () { throw new Error('disabled'); }, setItem () { throw new Error('disabled'); }}});
    const a = createScriptClipboard(makeHost());
    await a.copy(script, 'hello');
    const b = createScriptClipboard(makeHost());
    // Channel reply happens before the new listener is installed only in this synchronous fake;
    // publish once more to model asynchronous browser delivery.
    await a.copy(script, 'hello');
    assert.deepEqual(await b.read(), script);
    a.dispose(); b.dispose();
    assert.equal(channels.size, 0);
});

test('readable text includes nested C blocks and escaped literal text', () => {
    const field = text => ({getText: () => text});
    const body = {id: 'body', inputList: [{fieldRow: [field('say'), field('hello [world]')]}]};
    const root = {id: 'root', inputList: [{fieldRow: [field('repeat')]},
        {fieldRow: [], type: 3, connection: {targetBlock: () => body}}]};
    assert.equal(scratchblocksText(root), 'repeat\n  say hello \\[world\\]\nend');
});


test('the host paste replaces a duplicate addon item while unrelated commands retain their order', async () => {
    const {finalizeTransferMenu} = await import('../index.js');
    const host = {text: 'Paste', _twPlusTransfer: true};
    const other = {text: 'Copy All'};
    assert.deepEqual(finalizeTransferMenu([host, {text: 'Paste', enabled: false}, other]), [host, other]);
    const upstream = [{text: 'Paste'}];
    assert.deepEqual(finalizeTransferMenu(upstream), upstream);
});


test('same-origin paste does not request OS read permission when it would prompt', async () => {
    let reads = 0;
    const storage = new Map();
    const clipboard = createScriptClipboard(host(storage, {navigator: {
        permissions: {async query () { return {state: 'prompt'}; }},
        clipboard: {async read () { reads++; throw new Error('would prompt'); }}
    }}));
    await clipboard.copy(script, 'hello');
    assert.deepEqual(await clipboard.read(), script);
    assert.equal(reads, 0);
    clipboard.dispose();
});
