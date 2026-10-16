const { db } = require('../db/schema');
const { describeSettings } = require('./worldModes');
function currentVersion(alias) {
  return `${alias}.theme_version=COALESCE((SELECT version FROM world_theme_state WHERE user_id=${alias}.user_id),1)`;
}
async function themeState(userId) {
  await db.execute({ sql: `INSERT OR IGNORE INTO world_theme_state(user_id,theme,version,changed_at,position)
    SELECT user_id,interests,1,?,position FROM world_settings WHERE user_id=?`, args: [new Date().toISOString(), userId] });
  // Also protect against settings edited outside the normal theme-switch API.
  await db.execute({ sql: `UPDATE world_theme_state SET theme=(SELECT interests FROM world_settings WHERE user_id=?),
    position=(SELECT position FROM world_settings WHERE user_id=?),version=version+1,changed_at=?
    WHERE user_id=? AND (theme!=(SELECT interests FROM world_settings WHERE user_id=?) OR position!=(SELECT position FROM world_settings WHERE user_id=?))`, args: [userId,userId, new Date().toISOString(), userId,userId,userId] });
  const row = (await db.execute({ sql: 'SELECT w.*,s.version AS theme_version,s.changed_at AS theme_changed_at FROM world_settings w JOIN world_theme_state s ON s.user_id=w.user_id WHERE w.user_id=?', args: [userId] })).rows[0];
  return describeSettings(row);
}
module.exports = { themeState, currentVersion };
