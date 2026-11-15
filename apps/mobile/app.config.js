// The app's config is app.json; this adds what can't live in the public repository.
// google-services.json (Firebase's Android config, for push notifications) is written
// by the APK build from a secret (.github/workflows/app-apk.yml) and is gitignored, so
// it is added only when the file is there: the laptop, Expo Go and the web preview
// work without it.
const { existsSync } = require('node:fs');
const { join } = require('node:path');

module.exports = ({ config }) => {
    if (!existsSync(join(__dirname, 'google-services.json'))) return config;
    return { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } };
};
