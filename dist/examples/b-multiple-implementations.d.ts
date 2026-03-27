export type MediaStorage = {
    label: string;
    put: (key: string) => Promise<void>;
};
export declare const buildLocalMediaStorage: () => MediaStorage;
export declare const buildS3MediaStorage: () => MediaStorage;
//# sourceMappingURL=b-multiple-implementations.d.ts.map