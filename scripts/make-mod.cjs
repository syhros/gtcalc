// Make an account a username moderator (or take it away), using your Firebase CLI login:
//   node scripts/make-mod.cjs <username>          add
//   node scripts/make-mod.cjs <username> --remove  remove
// Moderators can't be added from the site: the rules only let the admin login write mods/{uid}.
const path = require('path');
const { execSync } = require('child_process');
const root = path.join(execSync('npm prefix -g').toString().trim(), 'node_modules', 'firebase-tools', 'lib');
const auth = require(path.join(root, 'auth.js'));
const { configstore } = require(path.join(root, 'configstore.js'));
const DB = 'https://firestore.googleapis.com/v1/projects/greg-calc/databases/(default)/documents';
const [username, flag] = process.argv.slice(2);
if (!username) { console.log('usage: node scripts/make-mod.cjs <username> [--remove]'); process.exit(1); }
(async () => {
  const t = (await auth.getAccessToken(configstore.get('tokens').refresh_token, [])).access_token;
  const h = { Authorization: `Bearer ${t}`, 'x-goog-user-project': 'greg-calc', 'Content-Type': 'application/json' };
  const claim = await (await fetch(`${DB}/usernames/${username.toLowerCase()}`, { headers: h })).json();
  const uid = claim.fields?.uid?.stringValue;
  if (!uid) { console.log(`No account is called "${username}"`); process.exit(1); }
  const r = flag === '--remove'
    ? await fetch(`${DB}/mods/${uid}`, { method: 'DELETE', headers: h })
    : await fetch(`${DB}/mods/${uid}`, { method: 'PATCH', headers: h, body: JSON.stringify({ fields: {} }) });
  console.log(r.ok ? `${claim.fields.username.stringValue} is ${flag === '--remove' ? 'no longer' : 'now'} a moderator (log out and back in to see Moderation in the profile window)` : `Failed: ${r.status}`);
})();
