import { prisma } from '../db.js'

export async function requireAdmin(request, response, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: request.auth.userId },
      select: { isAdmin: true },
    })
    if (!user?.isAdmin) {
      response.status(403).json({ error: { code: 'ADMIN_REQUIRED', message: 'Admin privileges are required.' } })
      return
    }
    next()
  } catch (error) {
    next(error)
  }
}
