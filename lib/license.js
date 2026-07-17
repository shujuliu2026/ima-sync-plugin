'use strict'

const {
  isProActive,
  canUseTrust,
  canUseGovern,
  canUseFormatFull,
  canUseEnrich,
  canUseGovernLlm,
  canUseStructure,
  canUseWhiteLabel,
  trustVerifyAllowed,
  trustDedupAllowed,
  syncDirectoriesMax,
  canAddSyncDirectory,
  effectiveSyncFolders,
  kbLibrariesMax,
  canAddKbLibrary,
  effectiveKbLibraries,
  getEffectiveEntitlements,
  summarizeEntitlements,
  buildEntitlementBarModel
} = require('./entitlements')
const { PRO_TEST_KEYS, verifyProLicenseKey, sig8 } = require('./license-key')

module.exports = {
  PRO_TEST_KEYS,
  verifyProLicenseKey,
  sig8,
  isProActive,
  canUseTrust,
  canUseGovern,
  canUseFormatFull,
  canUseEnrich,
  canUseGovernLlm,
  canUseStructure,
  canUseWhiteLabel,
  trustVerifyAllowed,
  trustDedupAllowed,
  syncDirectoriesMax,
  canAddSyncDirectory,
  effectiveSyncFolders,
  kbLibrariesMax,
  canAddKbLibrary,
  effectiveKbLibraries,
  getEffectiveEntitlements,
  summarizeEntitlements
}
