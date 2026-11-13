// SPDX-License-Identifier: MPL-2.0

import type {ClipboardHost, RenderedBlock, ScriptFile} from './types.js';
import {parseScript, validateScript} from './format.js';
export const CLIPBOARD_MIME = 'web application/x.turbowarp.blocks3+json';
const CHANNEL = 'tw-plus-script-clipboard-v1';

export function createScriptClipboard (host: ClipboardHost = globalThis as unknown as ClipboardHost) {
    let current: {time: number; script: ScriptFile} | null = null;
    let channel: BroadcastChannel | undefined;
    const accept = (input: unknown) => {
        const value = input as {time: number; script: ScriptFile} | null;
        try {
            if (value && Number.isFinite(value.time) && (!current || value.time >= current.time)) {
                validateScript(value.script);
                current = value;
            }
        } catch { /* Ignore unrelated or invalid same-origin messages. */ }
    };
    const readLocal = () => {
        try { accept(JSON.parse(host.localStorage.getItem(CHANNEL) || 'null')); } catch { /* Storage may be disabled. */ }
        return current?.script || null;
    };
    try {
        channel = new host.BroadcastChannel(CHANNEL);
        channel.onmessage = event => {
            if (event.data?.request) { if (current) channel?.postMessage(current); }
            else accept(event.data);
        };
        channel.postMessage({request: true});
    } catch { /* Storage still connects windows when BroadcastChannel is unavailable. */ }
    readLocal();
    const onStorage = (event: StorageEvent) => { if (event.key === CHANNEL) readLocal(); };
    host.addEventListener?.('storage', onStorage);
    return {
        async copy (script: ScriptFile, text: string) {
            validateScript(script);
            readLocal();
            current = {time: Math.max(Date.now(), (current?.time || 0) + 1), script};
            try { host.localStorage.setItem(CHANNEL, JSON.stringify(current)); } catch { /* Quota or private browsing. */ }
            try { channel?.postMessage(current); } catch { /* A closed channel must not break local copying. */ }
            try {
                const item = new host.ClipboardItem({
                    [CLIPBOARD_MIME]: new host.Blob([JSON.stringify({...script, clipboardTime: current.time})], {type: 'application/x.turbowarp.blocks3+json'}),
                    'text/plain': new host.Blob([text], {type: 'text/plain'})
                });
                await host.navigator.clipboard.write([item]);
            } catch {
                try { await host.navigator?.clipboard?.writeText(text); } catch { /* Same-origin copy already succeeded. */ }
            }
        },
        async read () {
            // Same-origin pastes must not open an OS permission prompt. Consult the system only
            // when permission was already granted, or when there is no same-origin script.
            const local = readLocal();
            if (local) {
                try {
                    const permission = await host.navigator.permissions.query({name: 'clipboard-read' as PermissionName});
                    if (permission.state !== 'granted') return local;
                } catch { return local; }
            }
            try {
                for (const item of await host.navigator.clipboard.read()) {
                    if (item.types.includes(CLIPBOARD_MIME)) {
                        const script = parseScript(await (await item.getType(CLIPBOARD_MIME)).text());
                        const local = readLocal();
                        if (local && Number.isFinite(script.clipboardTime) && current!.time > script.clipboardTime!) return local;
                        delete script.clipboardTime;
                        return script;
                    }
                    if (item.types.includes('text/plain')) {
                        const text = await (await item.getType('text/plain')).text();
                        if (text.trimStart().startsWith('{')) {
                            try { return parseScript(text); } catch { /* Plain text belongs to another app. */ }
                        }
                    }
                }
            } catch { /* Permission denial falls back to same-origin transport. */ }
            return readLocal();
        },
        dispose () {
            channel?.close();
            host.removeEventListener?.('storage', onStorage);
        }
    };
}

// Use the visible labels, inputs and nesting of the supplied ScratchBlocks instance. This also
// handles extension blocks and localized labels without importing a second block-definition table.
export function scratchblocksText (root: RenderedBlock): string {
    const escape = (text: string) => String(text).replace(/([\\[\]()<>])/g, '\\$1');
    const chain = (initial: RenderedBlock, depth = 0): string => {
        let block: RenderedBlock | null = initial;
        if (depth > 100) throw new Error('Script nesting is too deep');
        const lines: string[] = [];
        const seen = new Set<string>();
        while (block && !seen.has(block.id)) {
            seen.add(block.id);
            let parts: string[] = [];
            const blockLines: string[] = [];
            let statements = 0;
            const flush = () => {
                if (parts.length) blockLines.push(parts.join(' '));
                parts = [];
            };
            for (const input of block.inputList || []) {
                for (const field of input.fieldRow || []) {
                    // FieldImage alt text includes rendering-only icons such as the repeat arrow.
                    if (typeof field.src_ === 'string') continue;
                    const text = field.getText?.();
                    if (text) parts.push(typeof field.getOptions === 'function' ? `[${escape(text)} v]` : escape(text));
                }
                const child = input.connection?.targetBlock();
                if (input.type === 3) {
                    statements++;
                    flush();
                    if (child) blockLines.push(chain(child, depth + 1).split('\n').map(line => `  ${line}`).join('\n'));
                } else if (child) {
                    const text = chain(child, depth + 1);
                    parts.push(child.isShadow?.() ? (/^math_/.test(child.type || '') ? `(${text})` : `[${text}]`) :
                        child.outputShape_ === 1 ? `<${text}>` : `(${text})`);
                } else if (input.type === 1 && input.connection) {
                    parts.push(input.connection.check_?.includes('Boolean') ? '<>' : '()');
                }
            }
            flush();
            if (block.type === 'event_whenflagclicked') blockLines[0] = 'when green flag clicked';
            if (statements) blockLines.push('end');
            lines.push(...blockLines);
            block = block.getNextBlock?.() ?? null;
        }
        return lines.join('\n');
    };
    return chain(root);
}
