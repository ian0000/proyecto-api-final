import { createHmac, timingSafeEqual } from 'node:crypto';
export function signWebhook(secret: string, timestamp: string, raw: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
}
export function verifyWebhook(
  secret: string,
  timestamp: string,
  raw: string,
  signature: string,
  now = Date.now(),
) {
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300_000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signWebhook(secret, timestamp, raw), 'hex'),
    Buffer.from(signature, 'hex'),
  );
}
