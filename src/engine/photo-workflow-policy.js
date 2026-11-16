export function isPhotoMutationSurface(prefix, sourceView = '') {
    const source = String(sourceView || activeDetailSourceView || lastView || '').trim().toLowerCase();
    if (prefix === 'req-') return source === 'request';
    return ['ssn-','lsn-','na-','global-'].includes(prefix) && source === 'drive';
}

export function assertPhotoMutationSurface(prefix, sourceView = '') {
    if (!isPhotoMutationSurface(prefix, sourceView)) throw new Error('Open Drive Mode or Que to update photos.');
}

