import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
        environment: 'node',
        coverage: {
            provider: 'v8',
            include: ['src/lib/**/*.ts', 'src/app/api/**/*.ts', 'src/proxy.ts'],
            reporter: ['text-summary', 'lcov'],
            reportsDirectory: 'coverage',
        },
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['tests/unit/**/*.test.ts'],
                },
            },
        ],
    },
});
