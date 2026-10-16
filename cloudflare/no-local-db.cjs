// Local SQLite's native driver must never be bundled into Workers.
exports.createClient = () => { throw new Error('Cloudflare requires its D1 binding'); };
