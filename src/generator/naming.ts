/**
 * `MediaStorage` → `mediaStorage`
 */
export const contractNameToDefaultRegistrationKey = (contractName: string): string =>
  contractName.length === 0
    ? contractName
    : contractName.charAt(0).toLowerCase() + contractName.slice(1);
