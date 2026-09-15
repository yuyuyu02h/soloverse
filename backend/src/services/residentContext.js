const { db } = require('../db/schema');
async function residentContext(userId, char) {
  if (char.user_id !== userId) throw new Error('Resident ownership mismatch');
  let row = (await db.execute({ sql: 'SELECT profile FROM resident_profiles WHERE user_id=? AND character_id=?', args: [userId, char.id] })).rows[0];
  if (!row) {
    const profile = {
      version: 1, traits: String(char.personality).slice(0, 100),
      topics: String(char.interests).split(/[,、]/).map(s => s.trim()).filter(Boolean).slice(0, 5),
      voice: String(char.reply_style).slice(0, 100), routine: String(char.bio || '').slice(0, 100),
      activity: char.delay_profile,
      // Extract only explicit existing preferences; never invent new biography during upgrade.
      preferences: [...String(char.personality + ' ' + (char.bio || '')).matchAll(/([^。、\s]{2,16})が好き/g)].map(m => m[1]).slice(0, 3),
    };
    await db.execute({ sql: 'INSERT OR IGNORE INTO resident_profiles(character_id,user_id,profile) VALUES(?,?,?)', args: [char.id, userId, JSON.stringify(profile)] });
    row = { profile: JSON.stringify(profile) };
  }
  const recent = (await db.execute({ sql: `SELECT p.id,p.content FROM posts p WHERE p.user_id=? AND
    (p.author_id=? OR p.reply_to IN (SELECT id FROM posts WHERE user_id=? AND author_id=?))
    ORDER BY datetime(p.created_at) DESC,p.id DESC LIMIT 8`, args: [userId, char.id, userId, char.id] })).rows;
  const statements = [{ sql: 'DELETE FROM resident_memory WHERE user_id=? AND character_id=?', args: [userId, char.id] }];
  for (const post of recent) statements.push({ sql: 'INSERT INTO resident_memory(character_id,user_id,post_id) VALUES(?,?,?)', args: [char.id, userId, post.id] });
  await db.batch(statements, 'write');
  return { profile: JSON.parse(row.profile), memory: recent.map(p => p.content) };
}
module.exports = { residentContext };
