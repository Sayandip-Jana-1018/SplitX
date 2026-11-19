/** When something happened, said the way people say it: "Today · 9:40 pm", "Yesterday", "Mon". */
export function when(at: Date, now = new Date()): string {
    const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((day(now) - day(at)) / 86_400_000);
    if (days <= 0) {
        const time = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
        return `Today · ${time}`;
    }
    if (days === 1) return 'Yesterday';
    if (days < 7) return at.toLocaleDateString('en-IN', { weekday: 'short' });
    return at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** A day as a heading: "Today", "Yesterday", "Wednesday", "12 Nov", or "12 Nov 2025" in another year. */
export function dayHeading(at: Date, now = new Date()): string {
    const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const days = Math.round((day(now) - day(at)) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return at.toLocaleDateString('en-IN', { weekday: 'long' });
    return at.toLocaleDateString('en-IN', at.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Just the time: "9:40 pm". */
export function clock(at: Date): string {
    return at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}
