import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

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
