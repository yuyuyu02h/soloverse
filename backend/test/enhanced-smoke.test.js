// Run the same real HTTP/auth/regeneration checks in the new default mode.
process.env.CONTENT_PIPELINE = 'enhanced';
require('./smoke.test');
