import {parseScript, validateScript} from './format.js';
export const CLIPBOARD_MIME = 'web application/x.turbowarp.blocks3+json';
const CHANNEL = 'tw-plus-script-clipboard-v1';

export function createScriptClipboard (host = globalThis) {
    let current = null;
    let channel;
    const accept = value => {
        try {
            if (value && Number.isFinite(value.time) && (!current || value.time >= current.time)) {
                validateScript(value.script);
                current = value;
            }
        } catch { /* Ignore unrelated or invalid same-origin messages. */ }
    };
    const readLocal = () => {
        try { accept(JSON.parse(host.localStorage.getItem(CHANNEL))); } catch { /* Storage may be disabled. */ }
        return current?.script || null;
    };
    try {
        channel = new host.BroadcastChannel(CHANNEL);
        channel.onmessage = event => {
            if (event.data?.request) { if (current) channel.postMessage(current); }
            else accept(event.data);
        };
        channel.postMessage({request: true});
    } catch { /* Storage still connects windows when BroadcastChannel is unavailable. */ }
    readLocal();
    const onStorage = event => { if (event.key === CHANNEL) readLocal(); };
    host.addEventListener?.('storage', onStorage);
    return {
        async copy (script, text) {
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
                    const permission = await host.navigator.permissions.query({name: 'clipboard-read'});
                    if (permission.state !== 'granted') return local;
                } catch { return local; }
            }
            try {
                for (const item of await host.navigator.clipboard.read()) {
                    if (item.types.includes(CLIPBOARD_MIME)) {
                        const script = parseScript(await (await item.getType(CLIPBOARD_MIME)).text());
                        const local = readLocal();
                        if (local && Number.isFinite(script.clipboardTime) && current.time > script.clipboardTime) return local;
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
export function scratchblocksText (root) {
    const escape = text => String(text).replace(/([\\[\]()<>])/g, '\\$1');
    const chain = (block, depth = 0) => {
        if (depth > 100) throw new Error('Script nesting is too deep');
        const lines = [];
        const seen = new Set();
        while (block && !seen.has(block.id)) {
            seen.add(block.id);
            const parts = [];
            const bodies = [];
            for (const input of block.inputList || []) {
                for (const field of input.fieldRow || []) {
                    const text = field.getText?.();
                    if (text) parts.push(typeof field.getOptions === 'function' ? `[${escape(text)} v]` : escape(text));
                }
                const child = input.connection?.targetBlock();
                if (child) {
                    if (input.type === 3) bodies.push(chain(child, depth + 1));
                    else {
                        const text = chain(child, depth + 1);
                        parts.push(child.isShadow?.() ? (/^math_/.test(child.type || '') ? `(${text})` : `[${text}]`) :
                            child.outputShape_ === 1 ? `<${text}>` : `(${text})`);
                    }
                }
            }
            lines.push(block.type === 'event_whenflagclicked' ? 'when green flag clicked' : parts.join(' '));
            if (bodies.length) {
                for (let i = 0; i < bodies.length; i++) {
                    if (i) lines.push('else');
                    lines.push(bodies[i].split('\n').map(line => `  ${line}`).join('\n'));
                }
                lines.push('end');
            }
            block = block.getNextBlock?.();
        }
        return lines.join('\n');
    };
    return chain(root);
}
