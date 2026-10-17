// Firebase Auth email templates in the site's style, applied with the Firebase CLI's login:
//   node scripts/email-templates.cjs          (preview: writes scripts/email-preview/*.html)
//   node scripts/email-templates.cjs --apply  (tries the API; Firebase currently refuses template
//                                             edits there, so paste the files from
//                                             scripts/email-templates/ into the console)
// Email-safe: table layout, inline styles, bgcolor attributes, web-safe monospace fonts, a
// bulletproof button and the raw link as a fallback, so it reads in Gmail, Outlook and Apple
// Mail, light or dark.
const fs = require('fs');
const path = require('path');

const SITE = 'https://gtcalc.app';
const C = { bg: '#11141c', card: '#161a24', border: '#22d3ee', text: '#e2e8f0', muted: '#94a3b8', accent: '#22d3ee', yellow: '#fcd34d' };
const FONT = "'Courier New', Courier, 'Lucida Console', monospace";

function page({ title, intro, button, after }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${C.bg};" bgcolor="${C.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
    <tr><td style="padding:0 0 14px 0;font-family:${FONT};font-size:20px;font-weight:bold;letter-spacing:2px;color:${C.accent};">
      <img src="${SITE}/apple-touch-icon.png" width="28" height="28" alt="" style="vertical-align:middle;border:0;image-rendering:pixelated;">&nbsp;gtcalc
    </td></tr>
    <tr><td bgcolor="${C.card}" style="background:${C.card};border:2px solid ${C.border};padding:24px;">
      <p style="margin:0 0 14px 0;font-family:${FONT};font-size:17px;font-weight:bold;color:${C.text};">${title}</p>
      <p style="margin:0 0 20px 0;font-family:${FONT};font-size:14px;line-height:21px;color:${C.text};">${intro}</p>
      ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td bgcolor="#0e3a4a" style="background:#0e3a4a;border:2px solid ${C.border};">
          <a href="%LINK%" target="_blank" style="display:inline-block;padding:11px 22px;font-family:${FONT};font-size:14px;font-weight:bold;color:#e0fbff;text-decoration:none;letter-spacing:1px;">${button}</a>
        </td></tr></table>
      <p style="margin:18px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">Button not working? Copy this link into your browser:<br><a href="%LINK%" style="color:${C.accent};word-break:break-all;">%LINK%</a></p>` : ''}
      ${after ? `<p style="margin:18px 0 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">${after}</p>` : ''}
    </td></tr>
    <tr><td style="padding:14px 4px 0 4px;font-family:${FONT};font-size:11px;line-height:16px;color:${C.muted};">
      Sent by <a href="${SITE}" style="color:${C.accent};">gtcalc</a>, the GregTech production line calculator. You're getting this because of a change to your account. If it wasn't you, you can ignore this email.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

const TEMPLATES = {
  verifyEmailTemplate: {
    subject: 'Confirm your email for gtcalc',
    body: page({ title: 'Confirm your email', intro: 'Press the button to confirm <b style="color:#fcd34d;">%EMAIL%</b> for your gtcalc account. It lets you reset your password if you ever forget it.', button: 'CONFIRM EMAIL', after: 'The link works once and expires after a while.' }),
  },
  resetPasswordTemplate: {
    subject: 'Reset your gtcalc password',
    body: page({ title: 'Reset your password', intro: 'Someone (hopefully you) asked to reset the password for <b style="color:#fcd34d;">%EMAIL%</b>. Press the button to choose a new one.', button: 'CHOOSE NEW PASSWORD', after: 'Didn\'t ask for this? Your password stays the same; just ignore this email.' }),
  },
  changeEmailTemplate: {
    subject: 'Your gtcalc email was changed',
    body: page({ title: 'Your email was changed', intro: 'The email for your gtcalc account was changed to <b style="color:#fcd34d;">%NEW_EMAIL%</b>. If you made this change, there\'s nothing to do.', button: 'UNDO THIS CHANGE', after: 'Didn\'t change it? Press the button to switch back to %EMAIL%, then change your password.' }),
  },
  revertSecondFactorAdditionTemplate: {
    subject: 'Two-step sign-in added to your gtcalc account',
    body: page({ title: 'Two-step sign-in was added', intro: '<b style="color:#fcd34d;">%SECOND_FACTOR%</b> was added as a second sign-in step for %EMAIL%. If you did this, there\'s nothing to do.', button: 'REMOVE IT', after: 'Didn\'t add it? Press the button to remove it, then change your password.' }),
  },
};

const out = path.join(__dirname, 'email-preview');
fs.mkdirSync(out, { recursive: true });
for (const [k, t] of Object.entries(TEMPLATES)) {
  fs.writeFileSync(path.join(out, `${k}.html`), t.body.replace(/%LINK%/g, `${SITE}/#example-link`).replace(/%EMAIL%/g, 'player@example.com').replace(/%NEW_EMAIL%/g, 'new@example.com').replace(/%SECOND_FACTOR%/g, 'Phone ending 1234'));
}
// Paste-ready versions (placeholders kept) for Firebase console > Authentication > Templates.
const raw = path.join(__dirname, 'email-templates');
fs.mkdirSync(raw, { recursive: true });
for (const [k, t] of Object.entries(TEMPLATES)) fs.writeFileSync(path.join(raw, `${k}.html`), `<!-- Subject: ${t.subject} -->
${t.body}`);
console.log('previews written to', out, '; paste-ready templates in', raw);

if (process.argv.includes('--apply')) {
  const { execSync } = require('child_process');
  const root = path.join(execSync('npm prefix -g').toString().trim(), 'node_modules', 'firebase-tools', 'lib');
  const auth = require(path.join(root, 'auth.js'));
  const { configstore } = require(path.join(root, 'configstore.js'));
  (async () => {
    const token = (await auth.getAccessToken(configstore.get('tokens').refresh_token, [])).access_token;
    // Firebase only allows a custom body on some templates (anti-spam), so try each one: the full
    // design first, then just the sender name and subject.
    const call = async (k, fields, value) => {
      const mask = fields.map((f) => `notification.sendEmail.${k}.${f}`).join(',');
      const res = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/greg-calc/config?updateMask=${encodeURIComponent(mask)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': 'greg-calc' },
        body: JSON.stringify({ notification: { sendEmail: { [k]: value } } }),
      });
      return { ok: res.ok, text: res.ok ? '' : (await res.text()).match(/"message": "([^"]+)"/)?.[1] };
    };
    for (const [k, t] of Object.entries(TEMPLATES)) {
      const full = await call(k, ['senderDisplayName', 'subject', 'body', 'bodyFormat'], { senderDisplayName: 'gtcalc', subject: t.subject, body: t.body, bodyFormat: 'HTML' });
      if (full.ok) { console.log(k, ': full design applied'); continue; }
      const basic = await call(k, ['senderDisplayName', 'subject'], { senderDisplayName: 'gtcalc', subject: t.subject });
      console.log(k, ':', basic.ok ? `sender + subject only (body: ${full.text})` : `failed (${basic.text})`);
    }
  })();
}
