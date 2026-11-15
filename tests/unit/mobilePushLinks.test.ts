import { describe, expect, it } from 'vitest';
import { screenFor } from '../../apps/mobile/src/notifications/links';

describe('where a tapped notification opens in the app', () => {
    it('opens the group a notification is about', () => {
        expect(screenFor('/groups/cm9x1abc')).toBe('/group/cm9x1abc');
        expect(screenFor('/groups/cm9x1abc/settle?from=push')).toBe('/group/cm9x1abc');
    });

    it('opens Settle up for payments, Groups for the list, and Home for anything else', () => {
        expect(screenFor('/settlements')).toBe('/settle');
        expect(screenFor('/groups')).toBe('/groups');
        expect(screenFor('/somewhere-new')).toBe('/home');
        expect(screenFor(undefined)).toBe('/home');
    });

    it('never builds a path from a link it doesn’t recognise', () => {
        expect(screenFor('/groups/../../profile')).toBe('/home');
        expect(screenFor('https://evil.example/groups/x')).toBe('/home');
    });
});
