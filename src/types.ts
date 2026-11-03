export type JSONValue = string | number | boolean | null | JSONValue[] | {[key: string]: JSONValue};
export type VariableType = '' | 'list' | 'broadcast_msg';
export interface BlockField {
    name: string;
    value: string | number | boolean;
    id?: string;
}
export interface BlockInput {
    name?: string;
    block?: string | null;
    shadow?: string | null;
}
export interface BlockMutation {
    children: unknown[];
    proccode?: string;
    [key: string]: unknown;
}
export interface VMBlock {
    id: string;
    opcode: string;
    inputs: Record<string, BlockInput>;
    fields: Record<string, BlockField>;
    mutation?: BlockMutation;
    next?: string | null;
    parent?: string | null;
    topLevel?: boolean;
    shadow?: boolean;
    x?: number;
    y?: number;
    [key: string]: unknown;
}
export interface VariableDescriptor {
    id: string;
    name: string;
    type: VariableType;
    scope: 'local' | 'global';
    value: JSONValue;
}
export interface ScriptFile {
    format: 'turbowarp-script';
    version: 1;
    blocks: VMBlock[];
    variables: VariableDescriptor[];
    extensionIDs?: string[];
    extensionURLs: Record<string, string>;
    clipboardTime?: number;
}
export interface VMVariable {
    id: string;
    name: string;
    type: VariableType;
    value: JSONValue;
}
export interface AssetDescriptor {
    name: string;
    assetId: string;
    dataFormat: string;
    md5ext?: string;
    [key: string]: unknown;
}
export interface StoredAsset {
    assetId: string;
    dataFormat: string;
}
export interface VMAsset extends AssetDescriptor {
    asset: StoredAsset;
    md5: string;
}
export interface BlocksPort {
    _blocks: Record<string, VMBlock>;
    getBlock(id: string): VMBlock | undefined;
    getProcedureDefinition(code: string): string | null;
    deleteBlock(id: string): void;
}
export interface TargetPort {
    id: string;
    isStage: boolean;
    blocks: BlocksPort;
    variables: Record<string, VMVariable>;
    currentCostume: number;
    createVariable(id: string, name: string, type: VariableType, isCloud: boolean): void;
    deleteVariable(id: string): void;
    getCostumes(): AssetDescriptor[];
    getSounds(): AssetDescriptor[];
    setCostume(index: number): void;
    deleteCostume(index: number): void;
    deleteSound(index: number): void;
}
export interface RuntimePort {
    targets: TargetPort[];
    getTargetForStage(): TargetPort;
    getTargetById(id: string): TargetPort | undefined;
    emitProjectChanged(): void;
    storage: {
        AssetType: {Sound: unknown; ImageVector: unknown; ImageBitmap: unknown};
        createAsset(type: unknown, format: string, data: Uint8Array, id: null, generateId: boolean): StoredAsset;
    };
}
export interface VMPort {
    runtime: RuntimePort;
    editingTarget: TargetPort;
    exportStandaloneBlocks(blocks: VMBlock[]): VMBlock[] | {blocks: VMBlock[]; extensionURLs: Record<string, string>};
    _loadExtensions(ids: Set<string>, urls: Map<string, string>): Promise<unknown>;
    shareBlocksToTarget(blocks: {blocks: VMBlock[]; extensionURLs: Record<string, string>}, targetId: string): Promise<unknown>;
    exportSprite(targetId: string): Promise<Blob>;
    toJSON(targetId?: string): string;
    saveProjectSb3DontZip(): Record<string, Uint8Array>;
    addCostume(md5: string, costume: VMAsset, targetId: string): Promise<unknown>;
    addSound(sound: VMAsset, targetId: string): Promise<unknown>;
    emitTargetsUpdate(): void;
    refreshWorkspace(): void;
}
export interface ScriptImportOptions {
    position?: {x: number; y: number};
    uid?: () => string;
}
export interface ZipEntry {
    _data: {uncompressedSize: number};
    async(type: 'string'): Promise<string>;
    async(type: 'uint8array'): Promise<Uint8Array<ArrayBuffer>>;
}
export interface ZipArchive {
    file(name: string): ZipEntry | null;
    file(name: string, contents: string): ZipArchive;
    generateAsync(options: {type: 'blob'; compression: string}): Promise<Blob>;
}
export interface StageImportOptions {
    Zip: {loadAsync(buffer: ArrayBuffer | Uint8Array): Promise<ZipArchive>};
    deserializeBlocks(blocks: Record<string, unknown>): Record<string, VMBlock>;
}
export interface StageFile {
    isStage: true;
    blocks: Record<string, unknown>;
    variables?: Record<string, [string, JSONValue]>;
    lists?: Record<string, [string, JSONValue[]]>;
    broadcasts?: Record<string, string>;
    costumes: AssetDescriptor[];
    sounds: AssetDescriptor[];
    extensionURLs?: Record<string, string>;
    extensionIDs?: string[];
    extensions?: string[];
}
export interface WorkspacePort {
    scale: number;
    getMetrics(): {viewLeft: number; viewTop: number};
}
export interface RenderedField {
    getText?(): string;
    getOptions?(): unknown;
    src_?: string;
}
export interface RenderedBlock {
    id: string;
    type?: string;
    workspace: WorkspacePort;
    isInFlyout?: boolean;
    outputShape_?: number;
    inputList: {
        type?: number;
        fieldRow: RenderedField[];
        connection?: {targetBlock(): RenderedBlock | null; check_?: string[]};
    }[];
    isShadow(): boolean;
    getNextBlock?(): RenderedBlock | null;
    getRootBlock(): RenderedBlock;
}
export interface MenuItem {
    text: string;
    enabled: boolean;
    callback(): void;
    _twPlusTransfer?: boolean;
    [key: string]: unknown;
}
export type ContextMenuMethod = (this: RenderedBlock | WorkspacePort, ...args: unknown[]) => unknown;
export interface ScratchBlocksPort {
    BlockSvg: {prototype: {showContextMenu_: ContextMenuMethod}};
    WorkspaceSvg: {prototype: {showContextMenu_: ContextMenuMethod}};
    ContextMenu: {show(event: Event, items: MenuItem[], rtl?: boolean): unknown};
    selected: RenderedBlock | null;
    getMainWorkspace(): WorkspacePort;
    onKeyDown_(event: KeyboardEvent): void;
}
export interface ClipboardHost {
    localStorage: Storage;
    navigator: Navigator;
    BroadcastChannel: typeof BroadcastChannel;
    ClipboardItem: typeof ClipboardItem;
    Blob: typeof Blob;
    addEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
    removeEventListener(type: 'storage', listener: (event: StorageEvent) => void): void;
}
export interface BrowserHost extends ClipboardHost {
    document: Document;
    URL: typeof URL;
    alert(message: string): void;
    setTimeout(callback: () => void, delay: number): unknown;
}
export interface ScriptTransferContext {
    vm: VMPort;
    workspace: WorkspacePort;
    ScratchBlocks: ScratchBlocksPort;
    document: Document;
    locale?: string;
    canUse?: () => boolean;
    onError?: (error: unknown) => void;
}
export interface ActivationEvent {stopPropagation(): void}
export interface StageMenuItem {
    label: string;
    onClick(event: ActivationEvent): void;
}
export interface StageMenus {
    contextItems: StageMenuItem[];
    backdropItems: StageMenuItem[];
}
export interface StageTransferContext extends StageImportOptions {
    vm: VMPort;
    document: Document;
    locale?: string;
    onError?: (error: unknown) => void;
}
