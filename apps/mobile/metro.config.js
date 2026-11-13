// The app reads the website's pure rules from where they live, src/lib: the glass (colours, the
// liquid's motion, the coins) and the money (splits, balances, the settlement planner). One copy
// of each, so the phone and the web always agree.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../src/lib')];

// A shared file may import a package too: the API contract (src/lib/contract) imports zod. On the
// laptop it would resolve from the website's node_modules; the APK build installs only the app's,
// so the app's own copy is where it falls back to.
config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, zod: path.resolve(__dirname, 'node_modules/zod') };

module.exports = config;
