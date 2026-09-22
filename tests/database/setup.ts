// The database tests empty the database they are given before each test. They
// run only against a local database whose name ends in _test, and fail rather
// than skip without one, so CI can't pass without running them.
const url = process.env.DATABASE_URL;
if (!url) {
    throw new Error(
        'Database tests need DATABASE_URL: a local Postgres database named *_test with the migrations applied, ' +
        'e.g. postgresql://postgres@127.0.0.1:5432/splitx_test after `npx prisma migrate deploy`.'
    );
}
const { hostname, pathname } = new URL(url);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname) || !pathname.endsWith('_test')) {
    throw new Error('Database tests delete every row: DATABASE_URL must point at a local database whose name ends in _test.');
}
