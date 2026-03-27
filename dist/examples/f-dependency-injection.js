export const buildAlbumService = ({ mediaStorage }) => {
    return {
        describe: () => `albums backed by ${mediaStorage.label}`,
    };
};
//# sourceMappingURL=f-dependency-injection.js.map