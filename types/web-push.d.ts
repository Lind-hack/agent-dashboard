// Minimal types for the parts of web-push 3.6.7 we use (the package ships none).
declare module "web-push" {
  export type PushSubscription = { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } };
  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function sendNotification(
    subscription: PushSubscription,
    payload?: string | Buffer | null,
    options?: { vapidDetails?: { subject: string; publicKey: string; privateKey: string }; TTL?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string; timeout?: number },
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
  const _default: { generateVAPIDKeys: typeof generateVAPIDKeys; sendNotification: typeof sendNotification };
  export default _default;
}
