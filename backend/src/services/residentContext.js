const { db } = require('../db/schema');
const { themeState } = require('./worldTheme');
async function residentContext(userId, char) {
  if (char.user_id !== userId) throw new Error('Resident ownership mismatch');
  const settings = await themeState(userId);
  const fingerprint = JSON.stringify([settings?.interests, settings?.theme_version, char.personality, char.interests, char.reply_style, char.bio, char.delay_profile, char.participation_role, settings?.mode]);
  let row = (await db.execute({ sql: 'SELECT profile FROM resident_profiles WHERE user_id=? AND character_id=?', args: [userId, char.id] })).rows[0];
  let stored;
  try { stored = row && JSON.parse(row.profile); } catch (_) {}
  if (!stored || stored.fingerprint !== fingerprint) {
    const profile = {
      version: 3, fingerprint, mode: settings?.mode, participation: char.participation_role || '', theme: settings?.interests, traits: String(char.personality).slice(0, 100),
      topics: String(char.interests).split(/[,、]/).map(s => s.trim()).filter(Boolean).slice(0, 5),
      voice: String(char.reply_style).slice(0, 100), routine: String(char.bio || '').slice(0, 100),
      activity: char.delay_profile,
      // Extract only explicit existing preferences; never invent new biography during upgrade.
      preferences: [...String(char.personality + ' ' + (char.bio || '')).matchAll(/([^。、\s]{2,16})が好き/g)].map(m => m[1]).slice(0, 3),
    };
    await db.execute({ sql: 'INSERT INTO resident_profiles(character_id,user_id,profile) VALUES(?,?,?) ON CONFLICT(character_id) DO UPDATE SET profile=excluded.profile', args: [char.id, userId, JSON.stringify(profile)] });
    row = { profile: JSON.stringify(profile) };
  }
  const recent = (await db.execute({ sql: `SELECT p.id,p.content FROM posts p WHERE p.user_id=? AND p.deleted_at IS NULL AND p.theme_version=? AND
    (p.author_id=? OR p.reply_to IN (SELECT id FROM posts WHERE user_id=? AND author_id=?))
    ORDER BY datetime(p.created_at) DESC,p.id DESC LIMIT 8`, args: [userId, settings?.theme_version || 1, char.id, userId, char.id] })).rows;
  const statements = [{ sql: 'DELETE FROM resident_memory WHERE user_id=? AND character_id=?', args: [userId, char.id] }];
  for (const post of recent) statements.push({ sql: 'INSERT INTO resident_memory(character_id,user_id,post_id) VALUES(?,?,?)', args: [char.id, userId, post.id] });
  await db.batch(statements, 'write');
  return { profile: JSON.parse(row.profile), memory: recent.map(p => p.content) };
}
module.exports = { residentContext };

// Cloudflare: fetch the cast's existing profiles and short memories together,
// rather than issuing several database calls per resident.
async function residentContexts(userId, characters, settings) {
  if (process.env.SOLOVERSE_RUNTIME !== 'cloudflare') {
    return new Map(await Promise.all(characters.map(async c => [c.id, await residentContext(userId,c)])));
  }
  const rows = (await db.execute({sql:`SELECT c.id,r.profile,
    (SELECT json_group_array(content) FROM (SELECT p.content FROM posts p WHERE p.user_id=c.user_id AND p.deleted_at IS NULL AND p.theme_version=? AND (p.author_id=c.id OR p.reply_to IN (SELECT id FROM posts WHERE user_id=c.user_id AND author_id=c.id)) ORDER BY datetime(p.created_at) DESC,p.id DESC LIMIT 8)) AS memory
    FROM ai_characters c LEFT JOIN resident_profiles r ON r.character_id=c.id AND r.user_id=c.user_id WHERE c.user_id=? AND c.id IN (SELECT value FROM json_each(?))`,args:[settings.theme_version,userId,JSON.stringify(characters.map(c=>c.id))]})).rows;
  const contexts = new Map();
  const profiles = [];
  for (const c of characters) {
    const row = rows.find(r=>r.id===c.id);
    const fingerprint = JSON.stringify([settings?.interests,settings?.theme_version,c.personality,c.interests,c.reply_style,c.bio,c.delay_profile,c.participation_role,settings?.mode]);
    let profile; try { profile=JSON.parse(row?.profile || 'null'); } catch {}
    if (profile?.fingerprint !== fingerprint) {
      profile={version:3,fingerprint,mode:settings.mode,participation:c.participation_role||'',theme:settings.interests,traits:String(c.personality).slice(0,100),topics:String(c.interests).split(/[,、]/).map(s=>s.trim()).filter(Boolean).slice(0,5),voice:String(c.reply_style).slice(0,100),routine:String(c.bio||'').slice(0,100),activity:c.delay_profile,preferences:[...String(c.personality+' '+(c.bio||'')).matchAll(/([^。、\s]{2,16})が好き/g)].map(m=>m[1]).slice(0,3)};
      profiles.push([c.id,userId,JSON.stringify(profile)]);
    }
    contexts.set(c.id,{profile,memory:JSON.parse(row?.memory||'[]')});
  }
  if (profiles.length) await db.execute({sql:`INSERT INTO resident_profiles(character_id,user_id,profile) SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?) WHERE true ON CONFLICT(character_id) DO UPDATE SET profile=excluded.profile`,args:[JSON.stringify(profiles)]});
  return contexts;
}
module.exports.residentContexts = residentContexts;
