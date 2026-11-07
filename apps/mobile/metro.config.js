// The app reads the website's glass rules (colours, the liquid's motion, the coins) from where
// they live, src/lib/glass, so the phone and the web always look alike. They import nothing.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../../src/lib/glass')];

module.exports = config;
