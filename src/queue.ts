const pending = new WeakMap<object, Promise<unknown>>();

// All entry points share one queue per VM, so awaiting extension approval cannot race two pastes
// or allow a stage rollback to remove another transfer's content.
export function queueTransfer<T> (vm: object, action: () => T | PromiseLike<T>): Promise<T> {
    const previous = pending.get(vm) || Promise.resolve();
    const result = previous.catch(() => {}).then(action);
    pending.set(vm, result);
    result.finally(() => { if (pending.get(vm) === result) pending.delete(vm); }).catch(() => {});
    return result;
}
