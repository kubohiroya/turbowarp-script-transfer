const pending = new WeakMap();

// All entry points share one queue per VM, so awaiting extension approval cannot race two pastes
// or allow a stage rollback to remove another transfer's content.
export function queueTransfer (vm, action) {
    const previous = pending.get(vm) || Promise.resolve();
    const result = previous.catch(() => {}).then(action);
    pending.set(vm, result);
    result.finally(() => { if (pending.get(vm) === result) pending.delete(vm); }).catch(() => {});
    return result;
}
