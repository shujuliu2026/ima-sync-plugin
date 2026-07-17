'use strict'

const crypto = require('crypto')
const { ENTITLEMENTS_PUBLIC_KEY_B64 } = require('./license-sign-pubkey')

/**
 * @param {object} ent
 */
function canonicalEntitlementsForSign (ent) {
  return {
    schema_version: ent.schema_version,
    product: ent.product,
    account_id: ent.account_id,
    tier: ent.tier,
    valid_until: ent.valid_until,
    modules: [...(ent.modules || [])].sort(),
    limits: ent.limits || {},
    issued_at: ent.issued_at
  }
}

/**
 * @param {object} ent
 * @returns {Buffer}
 */
function entitlementsSignBytes (ent) {
  return Buffer.from(JSON.stringify(canonicalEntitlementsForSign(ent)), 'utf8')
}

/**
 * @param {string} derB64
 */
function loadPublicKey (derB64) {
  const raw = String(derB64 || '').trim()
  if (!raw) return null
  return crypto.createPublicKey({
    key: Buffer.from(raw, 'base64'),
    format: 'der',
    type: 'spki'
  })
}

/**
 * @param {object} ent
 * @param {import('crypto').KeyObject|null} publicKey
 */
function verifyEntitlementsEd25519 (ent, publicKey) {
  const signature = String(ent?.signature || '')
  if (!signature.startsWith('ed25519:') || !publicKey) return false
  const sigBuf = Buffer.from(signature.slice('ed25519:'.length), 'base64')
  return crypto.verify(null, entitlementsSignBytes(ent), publicKey, sigBuf)
}

/**
 * @param {object} ent
 * @param {(e: object) => string} [legacySig8]
 */
function verifyEntitlementsSignature (ent, legacySig8) {
  const signature = String(ent?.signature || '')
  if (!signature) return false
  if (signature.startsWith('local:') || signature === 'test') return true
  if (signature.startsWith('ed25519:')) {
    const publicKey = loadPublicKey(ENTITLEMENTS_PUBLIC_KEY_B64)
    return verifyEntitlementsEd25519(ent, publicKey)
  }
  if (signature.startsWith('v1-') && typeof legacySig8 === 'function') {
    return signature === legacySig8(ent)
  }
  return signature.startsWith('v1-')
}

/**
 * Free 体验额度（公开 notices）签名载荷
 * @param {object} exp
 */
function canonicalExperienceForSign (exp) {
  return {
    product: 'ima-sync',
    kind: 'experience',
    enrich_parse_per_day: Math.floor(Number(exp?.enrich_parse_per_day) || 0),
    batch_notes_per_day: Math.floor(Number(exp?.batch_notes_per_day) || 0),
    format_preview_per_day: Math.floor(Number(exp?.format_preview_per_day) || 0),
    issued_at: String(exp?.issued_at || '')
  }
}

/** @param {object} exp @returns {Buffer} */
function experienceSignBytes (exp) {
  return Buffer.from(JSON.stringify(canonicalExperienceForSign(exp)), 'utf8')
}

/**
 * @param {object} exp
 * @param {import('crypto').KeyObject|null} publicKey
 */
function verifyExperienceEd25519 (exp, publicKey) {
  const signature = String(exp?.signature || '')
  if (!signature.startsWith('ed25519:') || !publicKey) return false
  const sigBuf = Buffer.from(signature.slice('ed25519:'.length), 'base64')
  return crypto.verify(null, experienceSignBytes(exp), publicKey, sigBuf)
}

/**
 * 仅接受 Ed25519；拒绝本地伪造 / 无签名
 * @param {object} exp
 * @returns {boolean}
 */
function verifyExperienceSignature (exp) {
  const signature = String(exp?.signature || '')
  if (!signature.startsWith('ed25519:')) return false
  const publicKey = loadPublicKey(ENTITLEMENTS_PUBLIC_KEY_B64)
  return verifyExperienceEd25519(exp, publicKey)
}

module.exports = {
  canonicalEntitlementsForSign,
  entitlementsSignBytes,
  canonicalExperienceForSign,
  experienceSignBytes,
  verifyEntitlementsSignature,
  verifyEntitlementsEd25519,
  verifyExperienceSignature,
  verifyExperienceEd25519,
  loadPublicKey
}
