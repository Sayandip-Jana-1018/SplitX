// The app reads the website's pure rules from where they live, src/lib: the glass (colours, the
// liquid's motion, the coins) and the money (splits, balances, the settlement planner). One copy
// of each, so the phone and the web always agree. They import nothing outside src/lib.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../src/lib')];

module.exports = config;
