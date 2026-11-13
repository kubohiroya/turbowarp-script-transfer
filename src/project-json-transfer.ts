// SPDX-License-Identifier: MPL-2.0

import {CLIPBOARD_MIME} from './clipboard.js';
import {FORMAT, MAX_BYTES} from './format.js';

export interface ProjectJSONTransfer {
    copy(json: string | Promise<string>, text: string): Promise<void>;
    read(): Promise<string | null>;
    drag(data: DataTransfer, json: string): void;
    accepts(data: DataTransfer): boolean;
    drop(data: DataTransfer): string | null;
}

/** Desktop transfer uses the browser's OS clipboard and drag data, with no process-local cache. */
export function createProjectJSONTransfer(host: Window & typeof globalThis, kind: 'script' | 'yaml' | 'costume' | 'sound'): ProjectJSONTransfer {
    const clipboardType = kind === 'script' ? CLIPBOARD_MIME : `web application/x.turbowarp.${kind}+json`;
    const dragType = clipboardType.slice(4);
    const format = kind === 'script' ? FORMAT : kind === 'yaml' ? 'turbowarp-yaml' : 'turbowarp-asset';
    const bounded = (json: string) => {
        if (json.length > MAX_BYTES || new TextEncoder().encode(json).length > MAX_BYTES) {
            throw new Error('Project transfer is too large');
        }
        return json;
    };
    const plain = (data: DataTransfer) => {
        const json = data.getData('text/plain');
        if (!json.trimStart().startsWith('{') || json.length > MAX_BYTES) return null;
        try {
            const envelope = JSON.parse(json);
            return envelope?.format === format && (format !== 'turbowarp-asset' || envelope.kind === kind) ? bounded(json) : null;
        } catch { return null; }
    };
    return {
        async copy(json, text) {
            await host.navigator.clipboard.write([new host.ClipboardItem({
                [clipboardType]: typeof json === 'string' ? new host.Blob([bounded(json)], {type: dragType}) :
                    json.then(value => new host.Blob([bounded(value)], {type: dragType})),
                'text/plain': new host.Blob([text], {type: 'text/plain'})
            })]);
        },
        async read() {
            for (const item of await host.navigator.clipboard.read()) {
                if (!item.types.includes(clipboardType)) continue;
                const blob = await item.getType(clipboardType);
                if (blob.size > MAX_BYTES) throw new Error('Project transfer is too large');
                return await blob.text();
            }
            return null;
        },
        drag(data, json) {
            data.setData(dragType, bounded(json));
            // Some OS drop targets only expose plain text to the receiving renderer.
            data.setData('text/plain', json);
            data.effectAllowed = 'copy';
        },
        accepts(data) {
            return data.types.includes(dragType) || (!data.types.includes('Files') && data.types.includes('text/plain'));
        },
        drop(data) {
            const json = data.getData(dragType);
            return json ? bounded(json) : plain(data);
        }
    };
}
