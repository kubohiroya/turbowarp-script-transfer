import type {BlockField, JSONValue, ScriptFile, ScriptImportOptions, TargetPort, VariableType, VMBlock, VMPort, VMVariable} from './types.js';
import {extensionDependencies} from './extensions.js';
import {queueTransfer} from './queue.js';
export const FORMAT = 'turbowarp-script';
export const MAX_BYTES = 8 * 1024 * 1024;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const own = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const fields: Record<string, VariableType> = {VARIABLE: '', LIST: 'list', BROADCAST_OPTION: 'broadcast_msg'};

export function validateScript (input: unknown): ScriptFile {
    if (!record(input) || input.format !== FORMAT || input.version !== 1 ||
        !Array.isArray(input.blocks) || input.blocks.length > 10000 ||
        !Array.isArray(input.variables) || !record(input.extensionURLs)) {
        throw new Error('Unsupported .blocks3 file');
    }
    if (input.extensionIDs !== undefined && (!Array.isArray(input.extensionIDs) || input.extensionIDs.length > 1000 ||
        input.extensionIDs.some(id => typeof id !== 'string' || !/^[a-z0-9]+$/i.test(id)))) throw new Error('Invalid extension IDs');
    const ids = new Set<string>();
    for (const block of input.blocks) {
        if (!record(block) || typeof block.id !== 'string' || block.id === '__proto__' || ids.has(block.id) ||
            typeof block.opcode !== 'string' || !record(block.inputs) || !record(block.fields)) {
            throw new Error('Invalid block');
        }
        if (block.mutation && (!record(block.mutation) || !Array.isArray(block.mutation.children))) throw new Error('Invalid mutation');
        if (block.opcode.startsWith('procedures_') && !['procedures_definition', 'procedures_return'].includes(block.opcode) &&
            (!record(block.mutation) || typeof block.mutation.proccode !== 'string')) throw new Error('Invalid procedure');
        ids.add(block.id);
    }
    const blocks = input.blocks as VMBlock[];
    const links = new Map<string, string[]>(blocks.map(block => [block.id, []]));
    for (const block of blocks) {
        const children: unknown[] = [block.next];
        for (const input of Object.values(block.inputs)) {
            if (!record(input)) throw new Error('Invalid input');
            children.push(input.block, input.shadow);
        }
        for (const id of [...children, block.parent]) {
            if (id != null && (typeof id !== 'string' || !ids.has(id))) throw new Error('Dangling block reference');
        }
        links.set(block.id, children.filter((id): id is string => typeof id === 'string'));
        for (const field of Object.values(block.fields)) {
            if (!record(field) || typeof field.name !== 'string' ||
                !['string', 'number', 'boolean'].includes(typeof field.value)) throw new Error('Invalid field');
        }
    }
    // Iterative DFS also rejects cycles in untrusted JSON without overflowing the call stack.
    const visited = new Set();
    const active = new Set();
    for (const id of ids) {
        const stack: [string, boolean][] = [[id, false]];
        while (stack.length) {
            const [next, leaving] = stack.pop()!;
            if (leaving) { active.delete(next); visited.add(next); continue; }
            if (active.has(next)) throw new Error('Cyclic block graph');
            if (visited.has(next)) continue;
            active.add(next);
            stack.push([next, true]);
            for (const child of new Set(links.get(next))) stack.push([child, false]);
        }
    }
    const variables = new Set();
    for (const variable of input.variables) {
        if (!record(variable) || typeof variable.id !== 'string' || variables.has(variable.id) ||
            typeof variable.name !== 'string' || typeof variable.type !== 'string' || !['', 'list', 'broadcast_msg'].includes(variable.type) ||
            typeof variable.scope !== 'string' || !['local', 'global'].includes(variable.scope) ||
            (variable.type === 'list' && !Array.isArray(variable.value))) throw new Error('Invalid variable');
        variables.add(variable.id);
    }
    for (const block of input.blocks) {
        for (const key of Object.keys(fields)) {
            if (block.fields[key] && !variables.has(block.fields[key].id)) throw new Error('Missing variable dependency');
        }
    }
    for (const [id, url] of Object.entries(input.extensionURLs)) {
        if (!id || typeof url !== 'string') throw new Error('Invalid extension URL');
    }
    return input as unknown as ScriptFile;
}

export function parseScript (text: string): ScriptFile {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Script is too large');
    return validateScript(JSON.parse(text));
}

export function exportScript (vm: VMPort, target: TargetPort, rootId: string): ScriptFile {
    // A transfer represents a complete stack, even when its context menu was opened on a child.
    const ancestors = new Set();
    while (target.blocks.getBlock(rootId)?.parent) {
        if (ancestors.has(rootId)) throw new Error('Cyclic block graph');
        ancestors.add(rootId);
        rootId = target.blocks.getBlock(rootId)!.parent!;
    }
    const blocks = new Map<string, VMBlock>();
    const pending: (string | null | undefined)[] = [rootId];
    while (pending.length) {
        const id = pending.pop();
        if (!id || blocks.has(id)) continue;
        const block = target.blocks.getBlock(id);
        if (!block) throw new Error(`Missing block: ${id}`);
        blocks.set(id, clone(block));
        pending.push(block.next);
        for (const input of Object.values(block.inputs)) pending.push(input.block, input.shadow);
        if (block.opcode === 'procedures_call') {
            const definition = target.blocks.getProcedureDefinition(block.mutation!.proccode!);
            if (!definition) throw new Error(`Missing definition: ${block.mutation!.proccode!}`);
            pending.push(definition);
        }
    }
    // A stack selected in the middle is exported as its own top-level script.
    const root = blocks.get(rootId)!;
    root.parent = null;
    root.topLevel = true;
    const stage = vm.runtime.getTargetForStage();
    const variables = new Map<string, ScriptFile['variables'][number]>();
    for (const block of blocks.values()) {
        for (const [key, type] of Object.entries(fields)) {
            const field = block.fields[key];
            if (!field || !field.id || variables.has(field.id)) continue;
            const local = own(target.variables, field.id) && target.variables[field.id];
            const variable = local || stage.variables[field.id];
            variables.set(field.id, {
                id: field.id, name: variable ? variable.name : String(field.value), type,
                scope: local && !target.isStage && type !== 'broadcast_msg' ? 'local' : 'global',
                value: clone(variable ? variable.value : (type === 'list' ? [] : 0))
            });
        }
    }
    const list = [...blocks.values()];
    return validateScript({format: FORMAT, version: 1, blocks: list,
        variables: [...variables.values()], ...extensionDependencies(vm, list)});
}

const unused = (name: string, occupied: Set<string>) => {
    let result = name;
    let i = 2;
    while (occupied.has(result)) result = `${name} (${i++})`;
    occupied.add(result);
    return result;
};

export function importScript (vm: VMPort, target: TargetPort, input: unknown, options?: ScriptImportOptions): Promise<ScriptFile> {
    // Snapshot the caller's mutable input before an earlier import gets a chance to finish.
    const script = clone(validateScript(input));
    return queueTransfer(vm, () => importScriptNow(vm, target, script, options));
}

export async function importScriptNow (vm: VMPort, target: TargetPort, input: ScriptFile, {position, uid = () => globalThis.crypto.randomUUID()}: ScriptImportOptions = {}): Promise<ScriptFile> {
    if (vm.runtime.getTargetById(target.id) !== target) throw new Error('The destination no longer exists');
    const payload = clone(validateScript(input));
    const stage = vm.runtime.getTargetForStage();
    const created: (VMVariable & {owner: TargetPort})[] = [];
    const replacements = new Map<string, VMVariable>();
    // Reserve against both scopes, including IDs belonging to unrelated variables.
    const occupiedIds = new Set(vm.runtime.targets.flatMap(t => Object.keys(t.variables)));
    for (const variable of payload.variables) {
        const owner = variable.scope === 'global' || target.isStage ? stage : target;
        let found = Object.values(owner.variables).find(v => v.name === variable.name && v.type === variable.type);
        if (!found) found = created.find(v => v.owner === owner && v.name === variable.name && v.type === variable.type);
        if (!found) {
            const names = new Set([...Object.values(owner.variables), ...created.filter(v => v.owner === owner)]
                .filter(v => v.type === variable.type).map(v => v.name));
            if (owner !== stage) for (const v of Object.values(stage.variables)) if (v.type === variable.type) names.add(v.name);
            let id;
            do { id = uid(); } while (occupiedIds.has(id));
            occupiedIds.add(id);
            const added = {owner, id, name: unused(variable.name, names), type: variable.type, value: clone(variable.value)};
            created.push(added);
            found = added;
        }
        replacements.set(variable.id, found);
    }
    for (const block of payload.blocks) {
        for (const key of Object.keys(fields)) {
            const field = block.fields[key];
            if (field) {
                const variable = replacements.get(field.id!)!;
                field.id = variable.id;
                field.value = variable.name;
            }
        }
    }
    // Definitions must not replace or ambiguously shadow the destination's existing procedures.
    const codes = new Set(Object.values(target.blocks._blocks).filter(b => b.opcode === 'procedures_prototype')
        .map(b => b.mutation?.proccode).filter((code): code is string => typeof code === 'string'));
    const renamed = new Map<string, string>();
    for (const block of payload.blocks) {
        if (block.opcode === 'procedures_prototype') {
            const code = block.mutation!.proccode!;
            renamed.set(code, unused(code, codes));
        }
    }
    for (const block of payload.blocks) {
        if (block.mutation && renamed.has(block.mutation!.proccode!)) block.mutation!.proccode! = renamed.get(block.mutation!.proccode!)!;
        if (position && block.topLevel) { block.x = position.x; block.y = position.y; position = {...position, y: position.y + 120}; }
    }
    // The VM regenerates block IDs and applies its extension security checks before installing.
    if (payload.extensionIDs?.length) {
        for (const id of payload.extensionIDs) await vm._loadExtensions(new Set([id]), new Map(Object.entries(payload.extensionURLs)));
    }
    if (vm.runtime.getTargetById(target.id) !== target) throw new Error('The destination no longer exists');
    await vm.shareBlocksToTarget({blocks: payload.blocks, extensionURLs: payload.extensionURLs}, target.id);
    if (vm.runtime.getTargetById(target.id) !== target) throw new Error('The destination no longer exists');
    for (const variable of created) {
        variable.owner.createVariable(variable.id, variable.name, variable.type, false);
        variable.owner.variables[variable.id].value = variable.value;
    }
    vm.runtime.emitProjectChanged();
    vm.refreshWorkspace();
    return payload;
}
