import type {StageFile, StageImportOptions, TargetPort, VariableDescriptor, VMAsset, VMPort} from './types.js';
import {extensionDependencies} from './extensions.js';
import {queueTransfer} from './queue.js';
import {FORMAT, importScriptNow, validateScript} from './format.js';
const MAX_STAGE_BYTES = 64 * 1024 * 1024;

export async function exportStage (vm: VMPort, stage: TargetPort, {Zip}: Pick<StageImportOptions, 'Zip'>): Promise<Blob> {
    const blob = await vm.exportSprite(stage.id);
    const zip = await Zip.loadAsync(await blob.arrayBuffer());
    const json = JSON.parse(await zip.file('sprite.json')!.async('string'));
    Object.assign(json, extensionDependencies(vm, Object.values(stage.blocks._blocks)));
    zip.file('sprite.json', JSON.stringify(json));
    return zip.generateAsync({type: 'blob', compression: 'DEFLATE'});
}

export function importStage (vm: VMPort, buffer: ArrayBuffer | Uint8Array, options: StageImportOptions): Promise<void> {
    return queueTransfer(vm, () => importStageNow(vm, buffer, options));
}

async function importStageNow (vm: VMPort, buffer: ArrayBuffer | Uint8Array, {Zip, deserializeBlocks}: StageImportOptions): Promise<void> {
    if (buffer.byteLength > MAX_STAGE_BYTES) throw new Error('Stage file is too large');
    const zip = await Zip.loadAsync(buffer);
    const header = zip.file('sprite.json');
    if (!header || header._data.uncompressedSize > 8 * 1024 * 1024) throw new Error('Invalid .stage3 file');
    const stageJSON = JSON.parse(await header.async('string')) as StageFile;
    if (stageJSON.isStage !== true || !stageJSON.blocks ||
        !Array.isArray(stageJSON.costumes) || !Array.isArray(stageJSON.sounds)) throw new Error('Invalid stage');
    const stage = vm.runtime.getTargetForStage();
    const variables: VariableDescriptor[] = [];
    for (const [id, [name, value]] of Object.entries(stageJSON.variables || {})) {
        variables.push({id, name, type: '', scope: 'global', value});
    }
    for (const [id, [name, value]] of Object.entries(stageJSON.lists || {})) {
        variables.push({id, name, type: 'list', scope: 'global', value});
    }
    for (const [id, name] of Object.entries(stageJSON.broadcasts || {})) {
        variables.push({id, name, type: 'broadcast_msg', scope: 'global', value: name});
    }
    const script = {format: FORMAT, version: 1, variables,
        blocks: Object.values(deserializeBlocks(stageJSON.blocks)), extensionURLs: stageJSON.extensionURLs || {},
        extensionIDs: stageJSON.extensionIDs || stageJSON.extensions || []};
    validateScript(script);
    let expanded = 0;
    const assets: {kind: 'costume' | 'sound'; item: VMAsset}[] = [];
    for (const [kind, items] of [['costume', stageJSON.costumes], ['sound', stageJSON.sounds]] as const) {
        for (const item of items) {
            const file = zip.file(item.md5ext || `${item.assetId}.${item.dataFormat}`);
            if (!file) throw new Error(`Missing stage asset: ${item.name}`);
            expanded += file._data.uncompressedSize;
            if (expanded > MAX_STAGE_BYTES) throw new Error('Stage assets are too large');
            const data = await file.async('uint8array');
            const storage = vm.runtime.storage;
            const type = kind === 'sound' ? storage.AssetType.Sound :
                item.dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
            const asset = storage.createAsset(type, item.dataFormat, data, null, true);
            assets.push({kind, item: {...item, asset, assetId: asset.assetId, md5: `${asset.assetId}.${asset.dataFormat}`}});
        }
    }
    // Reserve asset names before importing the scripts that refer to them.
    const renamedAssets = {costume: new Map<string, string>(), sound: new Map<string, string>()};
    for (const kind of ['costume', 'sound'] as const) {
        const names = new Set((kind === 'costume' ? stage.getCostumes() : stage.getSounds()).map(item => item.name));
        for (const entry of assets.filter(entry => entry.kind === kind)) {
            const original = entry.item.name;
            let name = original;
            let index = 2;
            while (names.has(name)) name = `${original} (${index++})`;
            names.add(name);
            entry.item.name = name;
            renamedAssets[kind].set(original, name);
        }
    }
    for (const block of script.blocks) {
        for (const [field, kind] of [['BACKDROP', 'costume'], ['SOUND_MENU', 'sound']] as const) {
            const reference = block.fields[field];
            if (reference && renamedAssets[kind].has(String(reference.value))) reference.value = renamedAssets[kind].get(String(reference.value))!;
        }
    }
    const oldBlocks = new Set(Object.keys(stage.blocks._blocks));
    const oldVariables = new Set(Object.keys(stage.variables));
    const costumeCount = stage.getCostumes().length;
    const soundCount = stage.getSounds().length;
    const currentCostume = stage.currentCostume;
    try {
        await importScriptNow(vm, stage, validateScript(script));
        for (const {kind, item} of assets) {
            if (kind === 'costume') await vm.addCostume(item.md5, item, stage.id);
            else await vm.addSound(item, stage.id);
        }
        stage.setCostume(currentCostume);
        vm.emitTargetsUpdate();
        vm.refreshWorkspace();
    } catch (error) {
        for (const id of Object.keys(stage.blocks._blocks)) if (!oldBlocks.has(id)) stage.blocks.deleteBlock(id);
        for (const id of Object.keys(stage.variables)) if (!oldVariables.has(id)) stage.deleteVariable(id);
        while (stage.getCostumes().length > costumeCount) stage.deleteCostume(stage.getCostumes().length - 1);
        while (stage.getSounds().length > soundCount) stage.deleteSound(stage.getSounds().length - 1);
        stage.setCostume(currentCostume);
        vm.emitTargetsUpdate();
        vm.refreshWorkspace();
        throw error;
    }
}
