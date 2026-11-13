// SPDX-License-Identifier: MPL-2.0

import type {
    BrowserHost, ContextMenuMethod, MenuItem, RenderedBlock, ScratchBlocksPort,
    ScriptTransferContext, StageMenus, StageTransferContext, WorkspacePort
} from './types.js';
export type * from './types.js';
import {exportScript, importScript, importScriptWithReceipt, parseScript, MAX_BYTES} from './format.js';
import {createScriptClipboard, scratchblocksText} from './clipboard.js';
import {installScriptDrag} from './script-drag.js';
import {exportStage, importStage} from './stage.js';
export * from './format.js';
export * from './clipboard.js';
export * from './stage.js';
export * from './project-json-transfer.js';

const labels = (locale = 'en') => String(locale).startsWith('ja') ? {
    export: 'スクリプトを書き出し', import: 'スクリプトを読み込み', copy: 'コピー', paste: '貼り付け',
    exportStage: 'ステージを書き出し', importStage: 'ステージを読み込み（追加）', error: '読み込み・書き出しに失敗しました'
} : {export: 'Export Script', import: 'Import Script', copy: 'Copy', paste: 'Paste',
    exportStage: 'Export Stage', importStage: 'Import Stage (add)', error: 'Transfer failed'};

function download (host: BrowserHost, data: Blob | string, filename: string, type?: string): void {
    const blob = data instanceof host.Blob ? data : new host.Blob([data], {type});
    const url = host.URL.createObjectURL(blob);
    const link = host.document.createElement('a');
    link.href = url;
    link.download = filename;
    host.document.body.append(link);
    link.click();
    link.remove();
    host.setTimeout(() => host.URL.revokeObjectURL(url), 1000);
}

function pick (host: BrowserHost, accept: string, read: (file: File) => Promise<void>, onError: (error: unknown) => void): void {
    const input = host.document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
        const file = input.files?.[0];
        input.remove();
        if (file) Promise.resolve().then(() => read(file)).catch(onError);
    };
    input.oncancel = () => input.remove();
    host.document.body.append(input);
    input.click();
}

type MenuOwner = RenderedBlock | WorkspacePort;
interface MenuContext {menu(owner: MenuOwner, items: MenuItem[], isBlock: boolean): void}
interface MenuInstallation {
    contexts: Map<WorkspacePort, MenuContext>;
    release(): void;
}
const installations = new WeakMap<ScratchBlocksPort, MenuInstallation>();
function installMenus (ScratchBlocks: ScratchBlocksPort): MenuInstallation {
    if (installations.has(ScratchBlocks)) return installations.get(ScratchBlocks)!;
    const contexts = new Map<WorkspacePort, MenuContext>();
    const originals: (() => void)[] = [];
    const wrap = (object: {showContextMenu_: ContextMenuMethod}, name: 'showContextMenu_', isBlock: boolean) => {
        const original = object[name];
        const wrapped: ContextMenuMethod = function (this: MenuOwner, ...args: unknown[]) {
            const context = contexts.get(isBlock ? (this as RenderedBlock).workspace : this as WorkspacePort);
            if (!context) return original.apply(this, args);
            const show = ScratchBlocks.ContextMenu.show;
            const owner = this;
            ScratchBlocks.ContextMenu.show = function (this: ScratchBlocksPort['ContextMenu'], event: Event, items: MenuItem[], rtl?: boolean) {
                context.menu(owner, items, isBlock);
                return show.call(this, event, items, rtl);
            };
            try { return original.apply(this, args); }
            finally { ScratchBlocks.ContextMenu.show = show; }
        };
        object[name] = wrapped;
        originals.push(() => { if (object[name] === wrapped) object[name] = original; });
    };
    wrap(ScratchBlocks.BlockSvg.prototype, 'showContextMenu_', true);
    wrap(ScratchBlocks.WorkspaceSvg.prototype, 'showContextMenu_', false);
    const installed = {contexts, release () {
        if (contexts.size) return;
        for (const restore of originals) restore();
        installations.delete(ScratchBlocks);
    }};
    installations.set(ScratchBlocks, installed);
    return installed;
}

export function attachScriptTransfer ({vm, workspace, ScratchBlocks, document, locale = 'en',
    canUse = () => true, projectTransfer, onError = () => {}}: ScriptTransferContext): {dispose(): void} {
    const host = document.defaultView as unknown as BrowserHost;
    const text = labels(locale);
    const report = (error: unknown) => { onError(error); host.alert(`${text.error}: ${error instanceof Error ? error.message : String(error)}`); };
    const clipboard = projectTransfer ? null : createScriptClipboard(host);
    let disposed = false;
    const run = (action: () => unknown) => () => { Promise.resolve().then(action).catch(report); };
    const copy = (block: RenderedBlock) => {
        const script = exportScript(vm, vm.editingTarget, block.id);
        const plain = scratchblocksText(block.getRootBlock());
        return projectTransfer ? projectTransfer.copy(JSON.stringify(script), plain) : clipboard!.copy(script, plain);
    };
    const position = () => {
        const metrics = workspace.getMetrics();
        return {x: (metrics.viewLeft + 30) / workspace.scale, y: (metrics.viewTop + 30) / workspace.scale};
    };
    const paste = async () => {
        const target = vm.editingTarget;
        const script = projectTransfer ? await projectTransfer.read().then(raw => raw === null ? null : parseScript(raw)) :
            await clipboard!.read();
        if (disposed || target !== vm.editingTarget || !canUse()) return true;
        if (!script) return false;
        if (projectTransfer) await receive(target, script);
        else await importScript(vm, target, script, {position: position()});
        return true;
    };
    const receive = (target: ScriptTransferContext['vm']['editingTarget'], script: ReturnType<typeof parseScript>) =>
        importScriptWithReceipt(vm, target, script, {position: position(),
            canCommit: () => !disposed && target === vm.editingTarget && canUse()});
    const detachDrag = projectTransfer && installScriptDrag({vm, workspace, ScratchBlocks, document, locale,
        canUse, projectTransfer}, receive, report);
    const install = installMenus(ScratchBlocks);
    install.contexts.set(workspace, {menu (owner, items, isBlock) {
        const block = owner as RenderedBlock;
        if (!canUse()) return;
        if (isBlock) {
            if (block.isInFlyout || block.isShadow() || !vm.editingTarget.blocks.getBlock(block.id)) return;
            items.push({text: text.export, enabled: true, callback: run(() => {
                const data = exportScript(vm, vm.editingTarget, block.id);
                download(host, JSON.stringify(data, null, 2), 'script.blocks3', 'application/json');
            })});
            items.push({text: text.copy, enabled: true, callback: run(() => copy(block))});
        } else {
            items.push({text: text.import, enabled: true, callback: () => {
                const target = vm.editingTarget;
                pick(host, '.blocks3', async file => {
                    if (file.size > MAX_BYTES) throw new Error('Script is too large');
                    const script = parseScript(await file.text());
                    if (!disposed && target === vm.editingTarget && canUse()) await importScript(vm, target, script, {position: position()});
                }, report);
            }});
            items.push({_twPlusTransfer: true, text: text.paste, enabled: true, callback: run(paste)});
        }
    }});
    const onKey = (event: KeyboardEvent) => {
        if (disposed || !canUse() || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.repeat) return;
        if ((event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
        if (ScratchBlocks.getMainWorkspace() !== workspace) return;
        const key = (event.key || '').toLowerCase();
        const block = ScratchBlocks.selected;
        if (key === 'c' && block?.workspace === workspace && !block.isInFlyout && vm.editingTarget.blocks.getBlock(block.id)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            // Begin the OS write in the user gesture, before yielding.
            copy(block).catch(report);
        } else if (key === 'v') {
            event.preventDefault();
            event.stopImmediatePropagation();
            paste().then(handled => { if (!handled && !disposed) ScratchBlocks.onKeyDown_(event); }).catch(report);
        }
    };
    document.addEventListener('keydown', onKey, true);
    return {dispose () {
        disposed = true;
        document.removeEventListener('keydown', onKey, true);
        clipboard?.dispose();
        detachDrag?.();
        install.contexts.delete(workspace);
        install.release();
    }};
}

export function stageTransferMenu ({vm, locale, document, deserializeBlocks, Zip, onError = () => {}}: StageTransferContext): StageMenus {
    const host = document.defaultView as unknown as BrowserHost;
    const text = labels(locale);
    const report = (error: unknown) => { onError(error); host.alert(`${text.error}: ${error instanceof Error ? error.message : String(error)}`); };
    return {
        contextItems: [{label: text.exportStage, onClick: () => {
            exportStage(vm, vm.runtime.getTargetForStage(), {Zip})
                .then(blob => download(host, blob, 'stage.stage3')).catch(report);
        }}],
        backdropItems: [{label: text.importStage, onClick: event => {
            event.stopPropagation();
            pick(host, '.stage3', async file => {
                if (file.size > 64 * 1024 * 1024) throw new Error('Stage file is too large');
                await importStage(vm, await file.arrayBuffer(), {Zip, deserializeBlocks});
            }, report);
        }}]
    };
}


// The GUI calls this after its addons have offered their menu items. Keep the host's script
// paste when an addon also offers the window-local clipboard under the same label.
export function finalizeTransferMenu<T extends {text: string; _twPlusTransfer?: boolean}> (items: T[]): T[] {
    const labels = new Set(items.filter(item => item._twPlusTransfer).map(item => item.text));
    return items.filter(item => item._twPlusTransfer || !labels.has(item.text));
}

export {createAssetTransferPanel, type ProjectAssetTransferPort} from './asset-transfer.js';
