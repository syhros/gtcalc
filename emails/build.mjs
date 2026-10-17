// Account emails the site sends itself (/api/account-email, through Brevo SMTP from noreply@gtcalc.app).
// `node emails/build.mjs` writes api/_emails.ts (what the function sends) and an HTML preview of
// each email here. Images live in public/email and are drawn by promo/email.mjs.
//
// Email apps are picky, so the layout sticks to what Outlook (Word renderer), Gmail and Apple Mail
// all handle: nested tables, inline styles, bgcolor attributes. Headings and buttons are images in
// the site's pixel font, because web fonts don't load in Outlook or Gmail. Backgrounds are image
// tiles as well as colours: dark modes recolour background colours but leave images alone.
// The function fills in %NAME%, %EMAIL% and %LINK%.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = 'https://gtcalc.app';
const IMG = `${SITE}/email`;
const size = JSON.parse(fs.readFileSync(path.join(here, 'image-sizes.json'), 'utf8'));
const C = { page: '#12161f', card: '#161a24', strip: '#14303f', cyan: '#22d3ee', green: '#10b981', text: '#cbd5e1', dim: '#8b98ab', title: '#f1f5f9' };
const SANS = "'Segoe UI', Roboto, 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** A wire of the flow line around the button: a 4px bar in a table cell (Outlook-safe). */
const wire = (color, width) => `<td width="${width}" style="width:${width}px;font-size:0;line-height:0;" valign="middle"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="4" bgcolor="${color}" style="height:4px;font-size:0;line-height:0;background:${color};">&nbsp;</td></tr></table></td>`;
/** A port square at the end of a wire. */
const port = (color) => `<td width="12" style="width:12px;font-size:0;line-height:0;" valign="middle"><table role="presentation" width="12" cellpadding="0" cellspacing="0" border="0"><tr><td width="12" height="12" bgcolor="${color}" style="width:12px;height:12px;font-size:0;line-height:0;background:${color};">&nbsp;</td></tr></table></td>`;
const img = (name, alt, extra = '') => `<img src="${IMG}/${name}.png" width="${size[name].w}" height="${size[name].h}" alt="${alt}" style="display:block;border:0;width:${size[name].w}px;height:${size[name].h}px;font-family:${SANS};font-size:18px;font-weight:700;line-height:24px;color:${C.title};${extra}" />`;
const p = (text, style = '') => `<p style="margin:0 0 12px 0;font-family:${SANS};font-size:15px;line-height:23px;color:${C.text};${style}">${text}</p>`;
const strong = (text) => `<strong style="color:${C.title};">${text}</strong>`;

// The flow wraps around the email: inputs in the header wire into the card's top-left corner along
// the title line, and the output leaves its bottom-right corner, down past the footer text to OUT.
const FLOW = { header: `${IMG}/flow-header.png?v=4`, footer: `${IMG}/flow-footer.png?v=4`, wireFooter: true };
function layout({ preheader, label, heading, headingAlt, button, buttonAlt, intro, after }, flow = FLOW) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${headingAlt}</title>
<style>
  body { margin: 0; padding: 0; background: ${C.page} url('${IMG}/grid.png'); }
  a { color: ${C.cyan}; }
  @media (max-width: 620px) { .px { padding-left: 20px !important; padding-right: 20px !important; } .wire { width: 14px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page} url('${IMG}/grid.png');" bgcolor="${C.page}" background="${IMG}/grid.png">
<!--[if gte mso 9]><v:background fill="t"><v:fill type="tile" src="${IMG}/grid.png" color="${C.page}" /></v:background><![endif]-->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};">${preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" background="${IMG}/grid.png" style="background:${C.page} url('${IMG}/grid.png');">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <tr><td style="font-size:0;line-height:0;">
      <a href="${SITE}" style="text-decoration:none;"><img src="${flow ? flow.header : `${IMG}/header.png?v=2`}" width="600" alt="gtcalc: GregTech calculator" style="display:block;width:100%;max-width:600px;height:auto;border:0;color:${C.cyan};font-family:${SANS};font-size:22px;font-weight:700;line-height:30px;" /></a>
    </td></tr>
${flow ? '' : '    <tr><td height="20" style="height:20px;font-size:0;line-height:0;">&nbsp;</td></tr>\n'}    <tr><td bgcolor="${C.cyan}" style="background:${C.cyan};padding:3px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" background="${IMG}/card.png" style="background:${C.card} url('${IMG}/card.png');">
        <tr><td class="px" bgcolor="${C.strip}" background="${IMG}/strip.png" style="background:${C.strip} url('${IMG}/strip.png');padding:9px 28px;border-bottom:1px solid #1f6f86;font-family:${SANS};font-size:11px;line-height:16px;font-weight:700;letter-spacing:2px;color:#a5f3fc;text-transform:uppercase;">${label}</td></tr>
        <tr><td class="px" style="padding:28px 28px 18px 28px;">${img(heading, headingAlt)}</td></tr>
        <tr><td class="px" style="padding:0 28px 10px 28px;">
          ${p('Hi %NAME%,')}
          ${intro}
        </td></tr>
        <tr><td class="px" style="padding:6px 28px 4px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            ${port(C.green)}${wire(C.green, 26).replace('<td ', '<td class="wire" ')}
            <td style="font-size:0;line-height:0;"><a href="%LINK%" style="text-decoration:none;display:block;">${img(button, buttonAlt, `background:${C.strip};`)}</a></td>
            ${wire(C.cyan, 26).replace('<td ', '<td class="wire" ')}${port(C.cyan)}
          </tr></table>
        </td></tr>
        <tr><td class="px" style="padding:22px 28px 26px 28px;">
          ${after}
          <p style="margin:16px 0 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${C.dim};">Button not working? Copy this link into your browser:<br /><a href="%LINK%" style="color:${C.cyan};word-break:break-all;">%LINK%</a></p>
        </td></tr>
      </table>
    </td></tr>
${flow && !flow.wireFooter ? `    <tr><td style="font-size:0;line-height:0;"><img src="${flow.footer}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></td></tr>\n` : ''}    <tr><td class="px" align="center" style="padding:22px 28px 8px 28px;font-family:${SANS};font-size:12px;line-height:18px;color:${C.dim};${flow?.wireFooter ? `border-right:3px dashed ${C.cyan};` : ''}">
      <a href="${SITE}" style="color:${C.cyan};text-decoration:none;font-weight:700;">gtcalc.app</a><br />
      GregTech calculator and production planner<br />
      You got this because this address has an account on gtcalc. <a href="${SITE}/privacy" style="color:${C.dim};">Privacy</a>
    </td></tr>
${flow?.wireFooter ? `    <tr><td style="font-size:0;line-height:0;"><img src="${flow.footer}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;" /></td></tr>` : ''}
  </table>
</td></tr>
</table>
</body>
</html>
`;
}

const footer = '\n\ngtcalc.app - GregTech calculator and production planner';
const RESET_ARGS = {
      preheader: 'Pick a new password for your gtcalc account.',
      label: 'Account &middot; password reset',
      heading: 'h-reset', headingAlt: 'Reset your password',
      button: 'btn-reset', buttonAlt: 'Reset password',
      intro: p(`Someone asked to reset the password for your gtcalc account, ${strong('%NAME%')}. Use the button to pick a new one.`),
      after: p('The link works once and stops working after an hour.', 'font-size:14px;') + p("Didn't ask for this? Ignore this email and your password stays the same.", 'font-size:14px;margin-bottom:0;'),
    };
const templates = {
  RESET_PASSWORD: {
    subject: 'Reset your gtcalc password',
    html: layout(RESET_ARGS),
    text: 'Hi %NAME%,\n\nSomeone asked to reset the password for your gtcalc account, %NAME%. Open this link to pick a new one:\n\n%LINK%\n\nThe link works once and stops working after an hour. Didn\'t ask for this? Ignore this email and your password stays the same.' + footer,
  },
  VERIFY_EMAIL: {
    subject: 'Confirm your email for gtcalc',
    html: layout({
      preheader: 'One click to confirm your email address.',
      label: 'Account &middot; confirm email',
      heading: 'h-verify', headingAlt: 'Confirm your email',
      button: 'btn-verify', buttonAlt: 'Confirm email',
      intro: p(`Thanks for signing up to gtcalc. Confirm that ${strong('%EMAIL%')} is your address, so you can reset your password if you ever forget it.`),
      after: p("Didn't sign up? Ignore this email and nothing happens.", 'font-size:14px;margin-bottom:0;'),
    }),
    text: 'Hi %NAME%,\n\nThanks for signing up to gtcalc. Confirm that %EMAIL% is your address, so you can reset your password if you ever forget it:\n\n%LINK%\n\nDidn\'t sign up? Ignore this email and nothing happens.' + footer,
  },
  CHANGE_EMAIL: {
    subject: 'Confirm your new email for gtcalc',
    html: layout({
      preheader: 'Confirm the new email address for your gtcalc account.',
      label: 'Account &middot; new email',
      heading: 'h-verify', headingAlt: 'Confirm your email',
      button: 'btn-verify', buttonAlt: 'Confirm email',
      intro: p(`You asked to use ${strong('%EMAIL%')} for your gtcalc account. Confirm it and it becomes the address you log in with and get password resets at.`),
      after: p("Didn't ask for this? Ignore this email and your account stays as it is.", 'font-size:14px;margin-bottom:0;'),
    }),
    text: 'Hi %NAME%,\n\nYou asked to use %EMAIL% for your gtcalc account. Open this link to confirm it; it then becomes the address you log in with and get password resets at:\n\n%LINK%\n\nDidn\'t ask for this? Ignore this email and your account stays as it is.' + footer,
  },
};

const sample = { '%NAME%': 'Syhros', '%EMAIL%': 'you@example.com', '%LINK%': 'https://gtcalc.app/auth/action?mode=resetPassword&amp;oobCode=EXAMPLE' };
for (const f of fs.readdirSync(here)) if (f.endsWith('.html')) fs.unlinkSync(path.join(here, f));
for (const [name, t] of Object.entries(templates)) {
  fs.writeFileSync(path.join(here, `${name.toLowerCase().replaceAll('_', '-')}.preview.html`), t.html.replace(/%NAME%|%EMAIL%|%LINK%/g, (m) => sample[m]));
}
fs.writeFileSync(path.join(here, '..', 'api', '_emails.ts'), '// Generated by emails/build.mjs. Edit that file and run `node emails/build.mjs`.\n'
  + Object.entries(templates).map(([name, t]) => `export const ${name} = ${JSON.stringify(t)};\n`).join(''));
const variantsDir = path.join(here, '..', 'public', 'email', 'variants');
if (fs.existsSync(variantsDir)) for (const v of ['a', 'b', 'c', 'd']) {
  if (!fs.existsSync(path.join(variantsDir, `${v}-header.png`))) continue;
  const html = layout(RESET_ARGS, { header: `/email/variants/${v}-header.png`, footer: `/email/variants/${v}-footer.png`, wireFooter: v === 'd' })
    .replaceAll(`${IMG}/`, '/email/').replace(/%NAME%|%EMAIL%|%LINK%/g, (m) => sample[m]);
  fs.writeFileSync(path.join(variantsDir, `${v}.html`), html);
}
const old = path.join(here, 'subjects.json');
if (fs.existsSync(old)) fs.unlinkSync(old);
console.log('wrote', Object.keys(templates).join(', '));
