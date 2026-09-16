#!/usr/bin/env node
/**
 * Builds the production image with its provenance baked in.
 *
 *   GIT_SHA      the commit, with "-dirty" when tracked files have uncommitted changes
 *   APP_VERSION  package.json version plus that commit
 *   BUILD_DATE   UTC time of the build
 *
 * They become OCI labels on the image and splitx_app_info{version, git_sha}
 * in Prometheus, so any running container or pod can be traced to the exact
 * commit it was built from — including in the middle of a rolling update.
 *
 *   npm run image:build              splitx:<sha> and splitx:local
 *   npm run image:build -- release   plus SBOM and provenance attestations
 *   npm run image:build -- naive     the comparison exhibit (Dockerfile.naive)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function provenance() {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const sha = git('rev-parse', '--short=12', 'HEAD');
    const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
    const gitSha = dirty ? `${sha}-dirty` : sha;
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    return { GIT_SHA: gitSha, APP_VERSION: `${version}+${gitSha}`, BUILD_DATE: new Date().toISOString() };
}

export function bake(target, { env = {}, extraArgs = [] } = {}) {
    // Only the bake file: compose files would otherwise be merged in, and their required variables would fail the build.
    return spawnSync('docker', ['buildx', 'bake', '-f', 'docker-bake.hcl', target, ...extraArgs], {
        stdio: 'inherit',
        env: { ...process.env, ...env },
    });
}

// Run directly (npm run image:build), not when imported by image-report.mjs.
if (process.argv[1]?.endsWith('image-build.mjs')) {
    const target = process.argv[2] ?? 'app';
    const values = provenance();
    console.log(`Building ${target}: git_sha=${values.GIT_SHA} version=${values.APP_VERSION}`);
    const result = bake(target, { env: values });
    process.exit(result.status ?? 1);
}
