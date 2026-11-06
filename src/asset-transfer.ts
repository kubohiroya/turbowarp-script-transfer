import {createProjectJSONTransfer} from './project-json-transfer.js';
import type {TargetPort, VMAsset, VMPort} from './types.js';

type AssetKind = 'costume' | 'sound';
type AssetReference = {id: 'asset'; kind: AssetKind; size: number; sha256: string};
type AssetReceipt = {transferId: string; assets: [AssetReference]};
type AssetPayload = {
    name: string;
    dataFormat: string;
    bitmapResolution?: number;
    rotationCenterX?: number;
    rotationCenterY?: number;
    format?: string;
};
type Envelope = AssetReceipt & {format: 'turbowarp-asset'; version: 1; kind: AssetKind; payload: AssetPayload};

export interface ProjectAssetTransferPort {
    stage(kind: AssetKind, bytes: Uint8Array): Promise<AssetReceipt>;
    read(transferId: string, asset: AssetReference): Promise<Uint8Array>;
    discard(transferId: string): Promise<boolean>;
}

const digestPattern = /^[a-f0-9]{64}$/;
const assetLimit = 32 * 1024 * 1024;
const formats = {costume: ['svg', 'png', 'jpg', 'jpeg'], sound: ['wav', 'mp3']};

function readPayload(value: unknown, kind: AssetKind): AssetPayload {
    const data = value as AssetPayload | null;
    if (!data || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 1024 ||
        !formats[kind].includes(data.dataFormat)) throw new Error('Invalid project asset metadata.');
    const payload: AssetPayload = {name: data.name, dataFormat: data.dataFormat};
    if (kind === 'sound') {
        if (data.format === 'adpcm') payload.format = data.format;
        return payload;
    }
    for (const key of ['bitmapResolution', 'rotationCenterX', 'rotationCenterY'] as const) {
        const number = data[key];
        if (number === undefined) continue;
        if (!Number.isFinite(number) || (key === 'bitmapResolution' && number <= 0)) {
            throw new Error('Invalid costume geometry.');
        }
        payload[key] = number;
    }
    return payload;
}

function parseEnvelope(raw: string, kind: AssetKind): Envelope {
    const data = JSON.parse(raw);
    const asset = Array.isArray(data?.assets) && data.assets.length === 1 ? data.assets[0] : null;
    if (data?.format !== 'turbowarp-asset' || data.version !== 1 || data.kind !== kind ||
        typeof data.transferId !== 'string' || !digestPattern.test(data.transferId) ||
        asset?.id !== 'asset' || asset.kind !== kind || !Number.isSafeInteger(asset.size) ||
        asset.size < 1 || asset.size > assetLimit || typeof asset.sha256 !== 'string' ||
        !digestPattern.test(asset.sha256)) throw new Error('Invalid project asset transfer.');
    return {format: data.format, version: 1, kind, transferId: data.transferId,
        assets: [{id: 'asset', kind, size: asset.size, sha256: asset.sha256}], payload: readPayload(data.payload, kind)};
}

const list = (target: TargetPort, kind: AssetKind) => kind === 'costume' ? target.getCostumes() : target.getSounds();

async function importAsset(vm: VMPort, target: TargetPort, kind: AssetKind, raw: string, port: ProjectAssetTransferPort,
    current: () => boolean) {
    const {transferId, assets: [reference], payload} = parseEnvelope(raw, kind);
    const bytes = await port.read(transferId, reference);
    if (!current()) return;
    const storage = vm.runtime.storage;
    const type = kind === 'sound' ? storage.AssetType.Sound :
        payload.dataFormat === 'svg' ? storage.AssetType.ImageVector : storage.AssetType.ImageBitmap;
    const asset = storage.createAsset(type, payload.dataFormat, bytes, null, true);
    const md5 = `${asset.assetId}.${asset.dataFormat}`;
    const item = {...payload, asset, assetId: asset.assetId, dataFormat: asset.dataFormat, md5};
    const oldCostume = target.getCostumes()[target.currentCostume];
    try {
        if (kind === 'costume') await vm.addCostume(md5, item, target.id);
        else await vm.addSound(item, target.id);
        if ((item as VMAsset).broken) throw new Error('The transferred asset could not be decoded.');
    } catch (error) {
        const index = list(target, kind).indexOf(item);
        if (index >= 0 && kind === 'costume') {
            target.deleteCostume(index);
            const restore = target.getCostumes().indexOf(oldCostume);
            if (restore >= 0) target.setCostume(restore);
        } else if (index >= 0) target.deleteSound(index);
        if (index >= 0) vm.emitTargetsUpdate();
        throw error;
    }
}

export function createAssetTransferPanel(vm: VMPort, kind: AssetKind, locale: string, port: ProjectAssetTransferPort) {
    const ja = /^ja(?:-|$)/i.test(locale);
    let selected: {target: TargetPort; item: object | undefined} | undefined;
    let refresh: (() => void) | undefined;
    return {
        remember(target: object, item: object | undefined) {
            selected = {target: target as TargetPort, item};
            refresh?.();
        },
        mount(root: HTMLElement, surface: HTMLElement) {
            const doc = root.ownerDocument;
            const host = doc.defaultView as Window & typeof globalThis;
            const transport = createProjectJSONTransfer(host, kind);
            const button = (label: string) => {
                const element = doc.createElement('button');
                element.type = 'button';
                element.textContent = label;
                return element;
            };
            const copy = button(ja ? '素材をコピー' : 'Copy asset');
            const paste = button(ja ? '素材を貼り付け' : 'Paste asset');
            const prepare = button(ja ? 'ドラッグを準備' : 'Prepare asset drag');
            const handle = button(ja ? '素材をドラッグ' : 'Drag asset');
            const cancel = button(ja ? '準備を取り消す' : 'Cancel asset drag');
            const status = doc.createElement('span');
            status.setAttribute('role', 'status');
            root.dataset.projectAssetTransfer = kind;
            Object.assign(root.style, {
                display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', padding: '4px 8px',
                background: 'var(--ui-secondary, #f2f4f7)', color: 'var(--text-primary, #333)'
            });
            for (const element of [copy, paste, prepare, handle, cancel]) {
                Object.assign(element.style, {
                    padding: '4px 8px', borderRadius: '4px', background: 'var(--ui-primary, white)',
                    color: 'inherit', border: '1px solid var(--ui-black-transparent, #999)'
                });
            }
            handle.draggable = true;
            root.append(copy, paste, prepare, handle, cancel, status);
            let mounted = true;
            let busy = false;
            let prepared: {source: object; bytes: Uint8Array; envelope: Envelope} | undefined;
            const matches = (receipt: typeof prepared, current: ReturnType<typeof source>) =>
                Boolean(receipt && current && receipt.source === current.item && receipt.bytes === current.bytes &&
                    JSON.stringify(receipt.envelope.payload) === JSON.stringify(current.payload));
            const target = () => {
                const current = vm.editingTarget;
                return current && vm.runtime.getTargetById(current.id) === current ? current : undefined;
            };
            const source = () => {
                const current = target();
                if (!current || selected?.target !== current) return;
                const item = list(current, kind).find(item => item === selected?.item) as
                    (VMAsset & {asset?: {data?: Uint8Array}}) | undefined;
                if (!item || item.broken || !(item.asset?.data instanceof Uint8Array)) return;
                try { return {item, bytes: item.asset.data, payload: readPayload(item, kind)}; }
                catch { return; }
            };
            const stage = async (current: NonNullable<ReturnType<typeof source>>): Promise<Envelope> =>
                ({format: 'turbowarp-asset', version: 1, kind, payload: current.payload, ...await port.stage(kind, current.bytes)});
            const clear = (revoke: boolean) => {
                const previous = prepared;
                prepared = undefined;
                if (revoke && previous) void port.discard(previous.envelope.transferId).catch(() => {});
            };
            const update = () => {
                const current = source();
                if (prepared && !matches(prepared, current)) clear(true);
                copy.disabled = prepare.disabled = busy || !current;
                paste.disabled = busy || !target();
                prepare.hidden = Boolean(prepared);
                handle.hidden = cancel.hidden = !prepared;
            };
            refresh = update;
            const run = async (action: () => Promise<void>) => {
                if (!mounted || busy) return;
                busy = true;
                status.textContent = '';
                update();
                try { await action(); }
                catch (error) {
                    if (mounted) status.textContent = error instanceof Error ? error.message : String(error);
                } finally {
                    busy = false;
                    if (mounted) update();
                }
            };
            copy.onclick = () => {
                const current = source();
                if (!current) return;
                void run(async () => {
                    const envelope = stage(current);
                    try {
                        await transport.copy(envelope.then(JSON.stringify), current.item.name);
                        if (mounted) status.textContent = ja ? '素材をコピーしました' : 'Asset copied';
                    } catch (error) {
                        const receipt = await envelope.catch(() => null);
                        if (receipt) await port.discard(receipt.transferId).catch(() => {});
                        throw error;
                    }
                });
            };
            prepare.onclick = () => {
                const current = source();
                if (!current) return;
                void run(async () => {
                    const envelope = await stage(current);
                    const receipt = {source: current.item, bytes: current.bytes, envelope};
                    if (!mounted || !matches(receipt, source())) {
                        await port.discard(envelope.transferId);
                        return;
                    }
                    prepared = receipt;
                });
            };
            cancel.onclick = () => { clear(true); update(); };
            handle.ondragstart = event => {
                update();
                if (!event.isTrusted || !event.dataTransfer || !prepared) return event.preventDefault();
                transport.drag(event.dataTransfer, JSON.stringify(prepared.envelope));
                // The receiving window may resolve the reference after this panel closes.
                clear(false);
            };
            handle.ondragend = update;
            const receive = (read: () => Promise<string | null>) => {
                const destination = target();
                if (!destination) return;
                void run(async () => {
                    const raw = await read();
                    if (raw === null) return;
                    const current = () => mounted && target() === destination;
                    if (!current()) return;
                    await importAsset(vm, destination, kind, raw, port, current);
                });
            };
            paste.onclick = () => receive(() => transport.read());
            const dragover = (event: DragEvent) => {
                if (!event.isTrusted || !event.dataTransfer || !target() || busy || !transport.accepts(event.dataTransfer)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
            };
            const drop = (event: DragEvent) => {
                if (!event.isTrusted || !event.dataTransfer || !target() || busy || !transport.accepts(event.dataTransfer)) return;
                const data = event.dataTransfer;
                try {
                    const raw = transport.drop(data);
                    if (raw === null) return;
                    event.preventDefault();
                    event.stopPropagation();
                    receive(async () => raw);
                } catch (error) {
                    event.preventDefault();
                    void run(async () => { throw error; });
                }
            };
            surface.addEventListener('dragover', dragover);
            surface.addEventListener('drop', drop);
            update();
            return () => {
                mounted = false;
                refresh = undefined;
                surface.removeEventListener('dragover', dragover);
                surface.removeEventListener('drop', drop);
                clear(true);
                root.replaceChildren();
            };
        }
    };
}
