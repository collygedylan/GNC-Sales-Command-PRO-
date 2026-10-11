declare module '*.jsx' {
  export const StructuredBunchNote: import('react').ComponentType<Omit<import('./view-contracts').StructuredBunchNoteProps, 'accountKey' | 'revisionKey'>>;
  export const BunchNoteCardBoard: import('react').ComponentType<Omit<import('./view-contracts').BunchCardBoardProps, 'accountKey' | 'revisionKey'>>;
}
