import type {VMBlock, VMPort} from './types.js';
const core = new Set(['argument', 'colour', 'control', 'data', 'event', 'looks', 'math', 'motion',
    'operator', 'procedures', 'sensing', 'sound', 'text']);
const carrier = (bytes: Uint8Array) => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return `data:text/javascript;base64,${btoa(binary)}`;
};

// Plus registrations are intentionally absent from the VM's native URL map. Carry their actual
// source too, so importing into another project still goes through the VM's security review.
export function extensionDependencies (vm: VMPort, blocks: VMBlock[]): {extensionIDs: string[]; extensionURLs: Record<string, string>} {
    const requested = new Set(blocks.map(block => block.opcode.split('_')[0]).filter(id => !core.has(id)));
    const standalone = vm.exportStandaloneBlocks(blocks);
    const extensionURLs: Record<string, string> = Array.isArray(standalone) ? {} : {...standalone.extensionURLs};
    if (!requested.size) return {extensionIDs: [], extensionURLs};
    const project = JSON.parse(vm.toJSON()) as {
        extensionURLs?: Record<string, string>;
        turboWarpPlus?: {extensions: {id: string; dependencies?: string[]; source: {type: string; url?: string; path?: string}}[]};
    };
    const specs = new Map((project.turboWarpPlus?.extensions || []).map(spec => [spec.id, spec]));
    const visited = new Set<string>();
    const active = new Set<string>();
    const extensionIDs: string[] = [];
    let files: Record<string, Uint8Array> | undefined;
    const visit = (id: string): void => {
        if (visited.has(id)) return;
        if (active.has(id)) throw new Error('Cyclic extension dependency');
        active.add(id);
        const spec = specs.get(id);
        if (spec) {
            for (const dependency of spec.dependencies || []) visit(dependency);
            if (spec.source.type === 'embedded-file') {
                files ||= vm.saveProjectSb3DontZip();
                const bytes = files[spec.source.path!];
                if (!bytes) throw new Error(`Missing extension source: ${id}`);
                extensionURLs[id] = carrier(bytes);
            } else if (spec.source.type === 'embedded-data') {
                extensionURLs[id] = project.extensionURLs?.[id] ?? '';
                if (!extensionURLs[id]?.startsWith('data:text/javascript;base64,')) throw new Error(`Missing extension source: ${id}`);
            } else {
                if (typeof spec.source.url !== 'string') throw new Error(`Missing extension source: ${id}`);
                extensionURLs[id] = spec.source.url;
            }
        } else if (project.extensionURLs?.[id]) extensionURLs[id] = project.extensionURLs[id];
        active.delete(id);
        visited.add(id);
        extensionIDs.push(id);
    };
    for (const id of requested) visit(id);
    return {extensionIDs, extensionURLs};
}
