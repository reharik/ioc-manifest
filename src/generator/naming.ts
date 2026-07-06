/**
 * `MediaStorage` → `mediaStorage`
 */
export const contractNameToDefaultRegistrationKey = (contractName: string): string =>
  contractName.length === 0
    ? contractName
    : contractName.charAt(0).toLowerCase() + contractName.slice(1);

/**
 * Group access keys are camelCase; the exported per-group type alias is the same key
 * with an uppercased first letter (`channels` → `Channels`).
 */
export const groupKeyToTypeAliasName = (key: string): string =>
  key.length === 0 ? key : key.charAt(0).toUpperCase() + key.slice(1);
