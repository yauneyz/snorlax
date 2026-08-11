export type PanelData<T> = { ok: true; rows: T } | { ok: false; message: string };
