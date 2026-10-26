import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { hashPassword } from '../auth/password.js'

const prompt = createInterface({ input: stdin, output: stdout })
try {
  const password = await prompt.question('Admin promotion passphrase (minimum 16 characters): ')
  if (password.length < 16 || password.length > 256) {
    throw new Error('The passphrase must be between 16 and 256 characters.')
  }
  console.log(await hashPassword(password))
} finally {
  prompt.close()
}
