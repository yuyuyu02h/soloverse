const { authMiddleware } = require('./auth');

function isAdminUser(userId) {
  return String(process.env.ADMIN_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean).includes(userId);
}
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.tokenScope !== 'admin' || !isAdminUser(req.userId)) return res.status(403).json({ error: '管理者権限が必要です' });
    next();
  });
}
module.exports = { isAdminUser, adminMiddleware };
