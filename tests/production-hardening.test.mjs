import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check('trip creation route verifies the caller can access the target group', () => {
  const source = read('src/app/api/trips/route.ts');

  assert.match(source, /const group = await prisma\.group\.findFirst\(/);
  assert.match(source, /id:\s*parsed\.data\.groupId/);
  assert.match(source, /\{ ownerId: user\.id \}/);
  assert.match(source, /\{ members: \{ some: \{ userId: user\.id \} \} \}/);
  assert.match(source, /Group not found or access denied/);
});

check('trip-scoped transaction reads verify the caller can access the trip group', () => {
  const source = read('src/app/api/transactions/route.ts');

  assert.match(source, /const accessibleTrip = await prisma\.trip\.findFirst\(/);
  assert.match(source, /id:\s*tripId/);
  assert.match(source, /deletedAt:\s*null/);
  assert.match(source, /Trip not found or access denied/);
});

check('trip-scoped settlement reads verify the caller can access the trip group', () => {
  const source = read('src/app/api/settlements/route.ts');

  assert.match(source, /const accessibleTrip = await prisma\.trip\.findFirst\(/);
  assert.match(source, /id:\s*tripId/);
  assert.match(source, /deletedAt:\s*null/);
  assert.match(source, /Trip not found or access denied/);
});

check('invite notifications carry a resolvable invitation link and the panel parses it safely', () => {
  const inviteRoute = read('src/app/api/invitations/route.ts');
  const panel = read('src/components/features/NotificationPanel.tsx');

  assert.match(inviteRoute, /link:\s*`\/invitations\/\$\{invitation\.id\}`/);
  assert.match(panel, /const match = notif\.link\.match\(\/\\\/invitations\\\/\(\[\^\/\?\#\]\+\)\/\)/);
  assert.match(panel, /if \(notif\.type === 'group_invite'\)/);
});

check('payment reminders only allow targets who belong to the current group', () => {
  const source = read('src/app/api/groups/[groupId]/messages/route.ts');

  assert.match(source, /if \(type === 'payment_reminder'\)/);
  assert.match(source, /A target user is required for payment reminders/);
  assert.match(source, /const allowedTargetIds = new Set<string>\(/);
  assert.match(source, /Target user is not a member of this group/);
});
