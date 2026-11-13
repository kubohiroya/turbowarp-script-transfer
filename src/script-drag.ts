// SPDX-License-Identifier: MPL-2.0

import {exportScript, parseScript} from './format.js';
import type {ProjectJSONTransfer} from './project-json-transfer.js';
import type {RenderedBlock, ScriptFile, ScriptTransferContext, TargetPort} from './types.js';

type Context = Pick<ScriptTransferContext, 'vm' | 'workspace' | 'ScratchBlocks' | 'document' | 'locale'> & {
    canUse(): boolean;
    projectTransfer: ProjectJSONTransfer;
};

export function installScriptDrag({vm, workspace, ScratchBlocks, document, locale, canUse, projectTransfer}: Context,
    receive: (target: TargetPort, script: ScriptFile) => Promise<unknown>, report: (error: unknown) => void) {
    const surface = workspace.getInjectionDiv?.();
    if (!surface) return;
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.draggable = true;
    handle.textContent = String(locale).startsWith('ja') ? '選択したスクリプトをドラッグ' : 'Drag selected script';
    handle.className = 'tw-plus-script-transfer-drag';
    Object.assign(handle.style, {
        position: 'absolute', bottom: '24px', right: '72px', zIndex: '2',
        background: 'var(--ui-secondary, white)', color: 'var(--text-primary, black)',
        padding: '4px 8px', border: '1px solid var(--ui-black-transparent, #aaa)', borderRadius: '4px',
        cursor: 'grab'
    });
    let selection: {block: RenderedBlock; target: TargetPort} | null = null;
    const active = () => canUse() && ScratchBlocks.getMainWorkspace() === workspace;
    const selected = () => {
        const block = ScratchBlocks.selected, target = vm.editingTarget;
        if (block?.workspace === workspace && !block.isInFlyout && !block.isShadow() && target.blocks.getBlock(block.id)) {
            return {block, target};
        }
        return null;
    };
    handle.addEventListener('pointerdown', () => { selection = selected(); });
    handle.addEventListener('dragend', () => { selection = null; });
    handle.addEventListener('dragstart', event => {
        const source = selection ?? selected();
        if (!event.isTrusted || !source || source.target !== vm.editingTarget || !event.dataTransfer || !active()) {
            event.preventDefault();
            return;
        }
        try {
            projectTransfer.drag(event.dataTransfer, JSON.stringify(exportScript(vm, source.target, source.block.id)));
        } catch (error) {
            event.preventDefault();
            report(error);
        }
    });
    const dragover = (event: DragEvent) => {
        if (event.isTrusted && active() && event.dataTransfer && projectTransfer.accepts(event.dataTransfer)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
        }
    };
    const drop = (event: DragEvent) => {
        if (!event.isTrusted || !active() || !event.dataTransfer) return;
        try {
            const raw = projectTransfer.drop(event.dataTransfer);
            if (raw === null) return;
            event.preventDefault();
            event.stopPropagation();
            void receive(vm.editingTarget, parseScript(raw)).catch(report);
        } catch (error) {
            report(error);
        }
    };
    surface.append(handle);
    surface.addEventListener('dragover', dragover);
    surface.addEventListener('drop', drop);
    return () => {
        surface.removeEventListener('dragover', dragover);
        surface.removeEventListener('drop', drop);
        handle.remove();
    };
}
