/**
 * `MediaStorage` → `mediaStorage`
 */
export const contractNameToDefaultRegistrationKey = (contractName) => contractName.length === 0
    ? contractName
    : contractName.charAt(0).toLowerCase() + contractName.slice(1);
const pluralizeWord = (word) => {
    if (word.length === 0)
        return word;
    const lower = word.toLowerCase();
    const last = lower[lower.length - 1];
    const secondLast = lower.length >= 2 ? lower[lower.length - 2] : "";
    if (last === "y" && !"aeiou".includes(secondLast)) {
        return word.slice(0, -1) + "ies";
    }
    if (last === "s" ||
        last === "x" ||
        (last === "h" && (secondLast === "s" || secondLast === "c"))) {
        return word + "es";
    }
    return word + "s";
};
/**
 * Splits PascalCase / consecutive capitals into word chunks, e.g. `MediaStorage` → [`Media`,`Storage`].
 */
const splitPascalWords = (name) => {
    const m = name.match(/([A-Z][a-z]*|[A-Z]+(?=[A-Z][a-z]|\b))/g);
    return m ?? [name];
};
/**
 * `MediaStorage` → `mediaStorages`; `Logger` → `loggers`.
 */
export const contractNameToCollectionRegistrationKey = (contractName) => {
    const parts = splitPascalWords(contractName);
    if (parts.length === 0) {
        return contractNameToDefaultRegistrationKey(contractName) + "s";
    }
    const pluralLast = pluralizeWord(parts[parts.length - 1]);
    const merged = [...parts.slice(0, -1), pluralLast];
    return merged
        .map((segment, index) => index === 0
        ? segment.charAt(0).toLowerCase() + segment.slice(1)
        : segment.charAt(0).toUpperCase() + segment.slice(1))
        .join("");
};
//# sourceMappingURL=naming.js.map