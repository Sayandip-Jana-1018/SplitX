// The phone app's own lint rules, Expo's. The website's config (../../eslint.config.mjs) skips apps/.
const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
    globalIgnores(['dist/*', '.expo/*', 'public/canvaskit.wasm']),
    expoConfig,
    // app.config.js runs in Node, as CommonJS.
    { files: ['*.config.js'], languageOptions: { globals: { __dirname: 'readonly' } } },
    {
        // Reanimated's layout animations can leave a native view behind when something above it
        // changes height (Home, 15 Nov 2026: the coin and totals stayed 236 points low after the
        // notifications card went away). Content in the page's flow fades in with <Appear>.
        files: ['src/**/*.tsx'],
        ignores: ['src/ui/Toast.tsx', 'src/app/onboarding.tsx'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector: "JSXAttribute[name.name=/^(entering|exiting|layout)$/]",
                    message: 'Use <Appear> from ~/ui/Appear: layout animations can strand a view when the content above it changes height.',
                },
            ],
        },
    },
]);
