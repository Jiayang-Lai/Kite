export type DatabaseMutationAction = 'create' | 'rename' | 'drop';
export type DatabaseMutationRequest = { name?: string };
export type ColumnMutationAction = 'rename' | 'change-type' | 'drop';
