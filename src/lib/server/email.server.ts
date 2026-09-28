/**
 * Transactional email (verification and password reset) through Resend's
 * HTTP API. Optional: without RESEND_API_KEY the app still works, but new
 * password accounts cannot verify their address and passwords cannot be
 * reset by email — the login page says so.
 */
export function emailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!emailEnabled()) throw new Error("Email is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status}`);
}
