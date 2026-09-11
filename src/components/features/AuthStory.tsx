import { ArrowUpRight, Users, CheckCheck, Receipt } from 'lucide-react';

export default function AuthStory() {
    return (
        <aside className="auth-story" aria-label="About SplitX">
            <span className="auth-story-label">Good times. Clear balances.</span>
            <h2>For the things<br />you do together.</h2>
            <p>The weekend away. Your everyday coffee. A place to keep shared expenses simple, so friendship never comes with a spreadsheet.</p>
            <div className="auth-story-art">
                <div><Users size={22} /><span>Bring your people together.</span><ArrowUpRight size={18} /></div>
                <div><Receipt size={22} /><span>One bill. Everyone&apos;s fair share.</span></div>
                <div><CheckCheck size={22} /><span>Settle up. Get back to living.</span></div>
            </div>
        </aside>
    );
}
