/**
 * Email HTML templates. Plain inline-styled HTML (no framework) so it renders
 * consistently across mail clients. Brand: "MakingFlow".
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function inviteEmailHtml(opts: {
  workspaceName: string
  inviterName?: string | null
  link: string
}): string {
  const workspace = escapeHtml(opts.workspaceName)
  const inviter = opts.inviterName ? escapeHtml(opts.inviterName) : null
  const lead = inviter
    ? `${inviter} has invited you to join`
    : `You've been invited to join`
  const link = escapeHtml(opts.link)

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f6f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
    <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
      <div style="background:#fff;border:1px solid #e7e7e9;border-radius:12px;padding:32px;">
        <h1 style="margin:0 0 12px;font-size:18px;">Join ${workspace} on MakingFlow</h1>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#444;">
          ${lead} <strong>${workspace}</strong> on MakingFlow.
        </p>
        <a href="${link}"
           style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:8px;">
          Accept invitation
        </a>
        <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#888;">
          Or paste this link into your browser:<br />
          <span style="color:#555;word-break:break-all;">${link}</span>
        </p>
        <p style="margin:16px 0 0;font-size:12px;color:#aaa;">
          This invitation expires in 7 days. If you weren't expecting it, you can ignore this email.
        </p>
      </div>
    </div>
  </body>
</html>`
}
