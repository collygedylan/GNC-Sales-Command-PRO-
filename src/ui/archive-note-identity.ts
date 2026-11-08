/** Identical notes use a content-local occurrence, so unrelated insertions retain keys. */
export function archiveNoteIdentities(rowId: string, notes: string[]) {
  const occurrences = new Map<string, number>();
  return notes.map(note => {
    const occurrence = occurrences.get(note) || 0;
    occurrences.set(note, occurrence + 1);
    return { note, key: JSON.stringify([rowId, note, occurrence]) };
  });
}
