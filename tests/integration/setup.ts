// Integration tests need real infrastructure. A missing variable fails the run
// loudly instead of skipping, so CI can never pass without actually testing.
if (!process.env.REDIS_URL) {
    throw new Error(
        'Integration tests require REDIS_URL, e.g. redis://:PASSWORD@127.0.0.1:6380/15 for the compose Redis ' +
        '(database 15 keeps test keys away from the app).'
    );
}
