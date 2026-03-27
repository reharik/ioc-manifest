export const buildMemoryCache = () => {
    const store = new Map();
    return {
        get: (k) => store.get(k),
    };
};
//# sourceMappingURL=d-grouping.js.map