import { timingSafeEqual } from 'node:crypto';

function tokensEqual(provided, expected) {
  const providedBuffer = Buffer.from(String(provided ?? ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected ?? ''), 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function requireBearerToken(environmentVariable) {
  return function atlasBearerAuth(req, res, next) {
    const expected = process.env[environmentVariable];
    if (!expected) {
      return res.status(503).json({
        error: `Atlas route authentication is not configured: ${environmentVariable}`,
      });
    }

    const authorization = req.get('authorization') || '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match || !tokensEqual(match[1], expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return next();
  };
}