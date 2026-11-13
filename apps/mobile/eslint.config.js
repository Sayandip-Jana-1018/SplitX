// The phone app's own lint rules, Expo's. The website's config (../../eslint.config.mjs) skips apps/.
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([globalIgnores(['dist/*', '.expo/*', 'public/canvaskit.wasm']), expoConfig]);
