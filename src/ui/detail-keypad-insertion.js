export function resolveDetailKeypadInsertion(type, { value, start, end }, key) {
    let inserted = String(key || '');
    if (type === 'spec' && inserted && ['', 'N/A', '-'].includes(value.trim().toUpperCase())) {
        value = '';
        start = end = 0;
    }
    if (['spec', 'caliper'].includes(type) && ['H', 'W', 'x', 'HxW'].includes(inserted)) {
        const prefix = start > 0 && !/\s/.test(value[start - 1]) ? ' ' : '';
        const suffix = inserted === 'x' && !/^\s/.test(value.slice(end)) ? ' ' : '';
        inserted = prefix + inserted + suffix;
    }
    return { nextValue: value.slice(0, start) + inserted + value.slice(end), nextCursor: start + inserted.length };
}
