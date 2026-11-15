import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

/*
 * Verifies a Firebase Auth ID token as documented by Firebase
 * (https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library):
 * RS256 signature from Google's securetoken keys, audience = project id,
 * issuer = https://securetoken.google.com/<project id>, not expired, non-empty subject.
 */
const GOOGLE_SECURETOKEN_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<VerifiedUser> {
  // Local Firebase Auth emulator issues unsigned tokens. Only honoured outside production.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.NODE_ENV !== 'production' && !process.argv.includes('--prod')) {
    const claims = decodeJwt(token);
    if (claims.aud !== projectId) throw new Error('aud');
    return {
      uid: String(claims.sub || ''),
      email: String(claims.email || '').toLowerCase(),
      emailVerified: claims.email_verified === true,
    };
  }

  const { payload } = await jwtVerify(token, GOOGLE_SECURETOKEN_JWKS, {
    algorithms: ['RS256'],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  });
  if (!payload.sub) throw new Error('Token sin usuario');
  const authTime = Number(payload.auth_time);
  if (!Number.isFinite(authTime) || authTime * 1000 > Date.now() + 60_000) throw new Error('auth_time inválido');
  return {
    uid: payload.sub,
    email: String(payload.email || '').toLowerCase(),
    emailVerified: payload.email_verified === true,
  };
}
