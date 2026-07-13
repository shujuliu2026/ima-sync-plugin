'use strict'

/**
 * 产品身份 SSOT — 独立产品化时优先改 product-manifest.json。
 * @see docs/design/ima-sync-product/README.md
 */
const manifest = require('../product-manifest.json')

/**
 * @param {object} m product-manifest.json
 * @returns {ReturnType<typeof fromManifest>}
 */
function fromManifest (m) {
  /**
   * @param {string} [pathSuffix]
   * @returns {string}
   */
  function siteUrl (pathSuffix = '') {
    const base = String(m.brand?.siteBaseUrl || `https://${m.brand.siteHost}`).replace(/\/$/, '')
    if (!pathSuffix) return base
    const suffix = pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`
    return `${base}${suffix}`
  }

  /** @returns {string[]} */
  function sponsorBases () {
    const host = m.brand.siteHost
    const assetPath = m.distribution.sponsorAssetPath
    const protocols = m.distribution.sponsorProtocolOrder || ['https']
    return protocols.map((proto) => `${proto}://${host}${assetPath}`)
  }

  const bases = sponsorBases()
  const licenseBasePath = String(m.license?.cloud?.apiBasePath || '/api/v1/ima-sync/license').replace(/\/$/, '')
  const activatePath = String(m.license?.cloud?.activatePath || '/activate')
  const entitlementsPath = String(m.license?.cloud?.entitlementsPath || '/entitlements')
  const licenseApiBase = siteUrl(licenseBasePath)
  return {
    manifest: m,
    productId: m.productId,
    brandSiteHost: m.brand.siteHost,
    brandSiteUrl: siteUrl(),
    sponsorAssetPath: m.distribution.sponsorAssetPath,
    sponsorBases: bases,
    sponsorBase: bases[0],
    defaultAnalyticsEventsUrl: m.analytics.defaultEventsUrl,
    clientChannel: m.analytics.clientChannel,
    analyticsTenantId: m.analytics.tenantId || '',
    licenseActivateUrl: `${licenseApiBase}${activatePath}`,
    licenseEntitlementsUrl: `${licenseApiBase}${entitlementsPath}`,
    siteUrl
  }
}

module.exports = { ...fromManifest(manifest), fromManifest }
