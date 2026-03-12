import { SignJWT, jwtVerify } from 'jose'

const JWT_EXPIRY = '30d'

function getSecret() {
  const secret = process.env.MACHINE_JWT_SECRET
  if (!secret) throw new Error('MACHINE_JWT_SECRET env var is required')
  return new TextEncoder().encode(secret)
}

/**
 * Generate a Machine JWT for authenticating Vercel → Machine communication.
 * Contains projectId and tenantId claims. Expires in 30 days.
 */
export async function generateMachineJwt(projectId: string, tenantId: string): Promise<string> {
  return new SignJWT({ projectId, tenantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret())
}

/**
 * Verify a Machine JWT and return the claims.
 * Used by the broker inside a Machine to validate incoming requests.
 */
export async function verifyMachineJwt(
  token: string
): Promise<{ projectId: string; tenantId: string; iat?: number }> {
  const { payload } = await jwtVerify(token, getSecret())
  return {
    projectId: payload.projectId as string,
    tenantId: payload.tenantId as string,
    iat: payload.iat,
  }
}
