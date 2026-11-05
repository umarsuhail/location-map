const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// server/ is the Cloudflare Worker: its node_modules (wrangler, workerd
// binaries) must never be crawled or bundled into the app. The app only
// imports the shared protocol, which lives in shared/.
config.resolver.blockList = [/\/server\/node_modules\/.*/, /\/server\/\.wrangler\/.*/];

module.exports = config;
