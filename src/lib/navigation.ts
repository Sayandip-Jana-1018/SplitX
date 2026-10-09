/** Whether a navigation entry is the current page: its own path or anything beneath it. */
export function isNavActive(href: string, pathname: string) {
    if (href === '/transactions') return pathname === '/transactions' || pathname.startsWith('/transactions/receipts');
    return pathname === href || pathname.startsWith(`${href}/`);
}
