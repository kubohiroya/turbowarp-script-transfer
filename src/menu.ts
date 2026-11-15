// SPDX-License-Identifier: MPL-2.0

import type {MenuItem} from './types.js';

export type MenuLocaleLabels = Record<'cutBlock' | 'copyBlock' | 'copyBelow', string>;
type Role = 'edit' | 'comment' | 'cutBlock' | 'duplicate' | 'copyBlock' | 'copyBelow' | 'copyStack' |
    'save' | 'space' | 'delete';

/** What a block's right-click menu holds, by the step a user takes with it. */
const groups: Role[][] = [
    ['edit', 'comment'],
    ['cutBlock'],
    ['duplicate', 'copyBlock', 'copyBelow', 'copyStack'],
    ['save'],
    ['space']
];
// Items this package does not know keep their order between the known groups and deletion.

const coreMessages: [string, Role][] = [
    ['EDIT_PROCEDURE', 'edit'], ['ADD_COMMENT', 'comment'], ['REMOVE_COMMENT', 'comment'],
    ['DUPLICATE', 'duplicate'], ['DELETE_BLOCK', 'delete'], ['DELETE_X_BLOCKS', 'delete']
];
const devtoolsMessages: [string, Role][] = [
    ['editor-devtools/make-space', 'space'], ['editor-devtools/copy-all', 'copyBelow'],
    ['editor-devtools/copy-block', 'copyBlock'], ['editor-devtools/cut-block', 'cutBlock']
];
const icons: Partial<Record<Role, string>> = {cutBlock: 'cut', copyBlock: 'copy', copyBelow: 'copy'};

const matches = (text: string, message: unknown) => {
    if (typeof message !== 'string') return false;
    if (text === message) return true;
    const [prefix, suffix] = message.split('%1');
    return suffix !== undefined && text.length > prefix.length + suffix.length &&
        text.startsWith(prefix) && text.endsWith(suffix);
};

/** Name Blockly's own block items while their labels are still Blockly's. */
export function markCoreMenuItems (items: MenuItem[], messages: Record<string, unknown> = {}): void {
    for (const item of items) {
        if (item._twPlusMenuRole || typeof item.text !== 'string') continue;
        const role = coreMessages.find(([id]) => matches(item.text, messages[id]))?.[1];
        if (role) item._twPlusMenuRole = role;
    }
}

/**
 * Put a block menu in the order cut, copy, save, arrange, delete, with a divider between groups,
 * and name the editor-devtools copy and cut items by the range they take. A menu without this
 * package's block items (a workspace or palette menu) is left as it is.
 */
export function orderBlockMenu<T extends MenuItem> (items: T[], addonMessages: Record<string, unknown> = {}): T[] {
    const labels = items.find(item => item._twPlusMenuLabels)?._twPlusMenuLabels as MenuLocaleLabels | undefined;
    if (!labels) return items;
    const roles = new Map(items.map(item => [item, (item._twPlusMenuRole as Role | undefined) ||
        devtoolsMessages.find(([id]) => typeof item.text === 'string' && matches(item.text, addonMessages[id]))?.[1]]));
    const order = groups.flat();
    const known = groups.map(() => [] as T[]);
    const others: T[] = [];
    const deletion: T[] = [];
    for (const item of items) {
        const role = roles.get(item);
        if (role && role in labels) {
            item.text = labels[role as keyof MenuLocaleLabels];
            item.twPlusMenuIcon = icons[role];
        }
        if (role === 'delete') deletion.push(item);
        else {
            const index = role ? groups.findIndex(group => group.includes(role)) : -1;
            (index < 0 ? others : known[index]).push(item);
        }
    }
    for (const group of known) group.sort((a, b) => order.indexOf(roles.get(a)!) - order.indexOf(roles.get(b)!));
    const ordered: T[] = [];
    for (const group of [...known, others, deletion]) {
        group.forEach((item, index) => {
            // Unknown items keep the dividers their addons gave them.
            if (index === 0) item.separator = ordered.length > 0;
            else if (group !== others) item.separator = false;
            ordered.push(item);
        });
    }
    return ordered;
}
