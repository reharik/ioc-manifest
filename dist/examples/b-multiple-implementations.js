export const buildLocalMediaStorage = () => {
    return {
        label: "local",
        put: async () => {
            /* noop */
        },
    };
};
export const buildS3MediaStorage = () => {
    return {
        label: "s3",
        put: async () => {
            /* noop */
        },
    };
};
//# sourceMappingURL=b-multiple-implementations.js.map