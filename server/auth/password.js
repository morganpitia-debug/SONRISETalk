import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export function passwordMeetsPolicy(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 256
}

export function createRecoveryToken() {
  return randomBytes(32).toString('hex')
}

export function hashRecoveryToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = await scrypt(password, salt, 64)
  return `scrypt:${salt}:${hash.toString('hex')}`
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, encodedHash] = storedHash.split(':')
  if (algorithm !== 'scrypt' || !salt || !encodedHash || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/i.test(encodedHash)) return false
  const expectedHash = Buffer.from(encodedHash, 'hex')
  const actualHash = await scrypt(password, salt, expectedHash.length)
  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash)
}
