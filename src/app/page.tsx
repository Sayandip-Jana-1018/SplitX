'use client';

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ArrowRight,
    BarChart3,
    ChevronDown,
    Cpu,
    PenLine,
    Plane,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Wallet,
    WifiOff,
    Zap,
    type LucideIcon,
} from 'lucide-react';
import { type IconType } from 'react-icons';
import { FaGithub, FaInstagram, FaLinkedin, FaXTwitter } from 'react-icons/fa6';
import Navbar from '@/components/ui/Navbar';
import BrandMark from '@/components/ui/BrandMark';
import styles from './landing.module.css';

const BRANDS = ['Google Pay', 'PhonePe', 'Paytm', 'CRED', 'HDFC', 'SBI', 'ICICI', 'Axis Bank'];

const STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
    { icon: Plane, title: 'Create a Trip', desc: "Set up your trip, add your crew, and you're ready. Takes under 10 seconds." },
    { icon: PenLine, title: 'Log Expenses', desc: 'Auto-capture from UPI alerts, scan receipts with AI, or add manually. Your call.' },
    { icon: Wallet, title: 'Settle Up', desc: 'Our algorithm calculates the fewest transfers needed. One tap to pay via UPI.' },
];

const RECEIPT = [
    { name: 'Garlic Bread', qty: 'Qty: 1', price: '₹250.00' },
    { name: 'Pasta Alfredo', qty: 'Qty: 2', price: '₹680.00' },
    { name: 'CGST (2.5%)', qty: 'Computed', price: '₹23.25' },
];

const ORBIT = [
    { label: 'S', x: 50, y: 14 },
    { label: 'P', x: 14, y: 42 },
    { label: 'A', x: 86, y: 42 },
    { label: 'R', x: 28, y: 86 },
    { label: 'N', x: 72, y: 86 },
];

const STATS = [
    { value: '10,000+', label: 'Happy Users' },
    { value: '50,000+', label: 'Expenses Tracked' },
    { value: '₹200Cr+', label: 'Amount Settled' },
];

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
    { icon: Zap, title: 'Silent Auto-Capture', desc: 'Connect your SMS or UPI notifications. Whenever you make a payment for the trip, SplitX reads the alert and logs the expense instantly.' },
    { icon: BarChart3, title: 'Stunning Analytics', desc: 'Visualize your spending across categories, view historical trends, and see exactly where the budget went.' },
    { icon: WifiOff, title: 'Offline Capable PWA', desc: 'Install SplitX directly to your home screen. It works natively even without an internet connection on a hike.' },
    { icon: ShieldCheck, title: 'Privacy First Infrastructure', desc: 'Your financial data stays yours. SplitX relies on localized Edge networking and strict row-level security. No ads, no trackers.' },
];

const VOICES = [
    { text: "Finally an app that doesn't make me do the math. The receipt OCR read a crumpled, faded bar bill in Goa flawlessly. Saved us hours.", name: 'Aman Verma', role: 'Used for a 7-day trip' },
    { text: 'We used to use Splitwise, but the ads were unbearable. SplitX is fast, gorgeous, and the one-tap UPI payments are game changers.', name: 'Priya Sharma', role: 'Event Organizer' },
    { text: 'The design is incredibly satisfying to use. Dark mode actually looks cohesive, and everything feels instantly responsive.', name: 'Kunal Roy', role: 'UI/UX Designer' },
    { text: 'OCR picked up every line item from a messy handwritten bill. The graph view for settlements is pure genius. 10/10 recommend!', name: 'Sneha Jain', role: 'College trip organizer' },
];

const QUESTIONS = [
    { q: 'Is SplitX really completely free?', a: "Yes. SplitX is a side-project originally built to solve my own friend group's annoyances. There are no paywalls, premium tiers, or hidden fees." },
    { q: 'How does Auto-Capture work?', a: 'AutoCapture parses UPI SMS alerts strictly on your device. We use machine learning to identify the merchant and amount, logging it instantly without needing your bank login.' },
    { q: 'Is my financial data safe?', a: 'Absolutely. All receipt parsing happens on the device where possible, and we do not sell your transaction data to advertisers. Your data remains completely yours.' },
    { q: 'Does it work without the internet?', a: 'Yes! SplitX is a Progressive Web App (PWA). You can install it to your home screen, log expenses offline on a mountain, and it will sync once you reconnect.' },
];

const SOCIALS: { icon: IconType; href: string; label: string }[] = [
    { icon: FaGithub, href: 'https://github.com/Sayandip-Jana-1018', label: 'GitHub' },
    { icon: FaXTwitter, href: 'https://x.com/51Sayandip', label: 'Twitter' },
    { icon: FaInstagram, href: 'https://www.instagram.com/sj_sayandip/', label: 'Instagram' },
    { icon: FaLinkedin, href: 'https://www.linkedin.com/in/jsayandip2003/', label: 'LinkedIn' },
];

/** Content rises and fades in once, the first time it enters the screen. */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
    return (
        <motion.div
            className={className}
            data-fade
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-70px' }}
            transition={{ type: 'spring', stiffness: 170, damping: 22, delay }}
        >
            {children}
        </motion.div>
    );
}

function SectionHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
    return (
        <Reveal className={styles.head}>
            {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
            <h2 className={styles.title}>{title}</h2>
            {children && <p className={styles.subtitle}>{children}</p>}
        </Reveal>
    );
}

function Question({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    const id = useId();
    return (
        <div className={styles.question} data-glass="reg">
            <button type="button" className={styles.questionHead} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
                <h3 className={styles.questionText}>{q}</h3>
                <ChevronDown size={18} className={open ? styles.chevronOpen : styles.chevron} aria-hidden="true" />
            </button>
            <AnimatePresence initial={false}>
                {open && (
                    <motion.div
                        id={id}
                        className={styles.answerWrap}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 34 }}
                    >
                        <p className={styles.answer}>{a}</p>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function LandingPage() {
    return (
        <div className={styles.page}>
            <Navbar />

            <main className={styles.main}>
                {/* ── One coin that splits and comes back whole, with the promise on it ── */}
                <section className={styles.hero}>
                    <i aria-hidden data-coin="split" className={styles.heartCoin} />
                    <i aria-hidden data-coin="coin" className={styles.coinA} />
                    <i aria-hidden data-coin="note" className={styles.noteB} />
                    <i aria-hidden data-coin="coin" className={styles.coinC} />
                    <i aria-hidden data-coin="bill" className={styles.billD} />
                    <i aria-hidden data-coin="coin" className={styles.coinE} />
                    <i aria-hidden data-coin="coin" className={styles.coinF} />
                    <motion.div
                        className={styles.heroCopy}
                        initial={{ opacity: 0, y: 24, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 150, damping: 20 }}
                    >
                        <p className={styles.heroBadge} data-glass="thin"><Sparkles size={14} />V-1.0 is here - Experience next-gen tracking</p>
                        <h1 className={styles.heroTitle}>
                            <span className={styles.heroBrand}>SplitX</span>
                            Split expenses
                            <span className={styles.heroAccent}>Keep the Vibe.</span>
                        </h1>
                        <p className={styles.heroLead}>One shared memory deserves one calm money story.</p>
                        <div className={styles.heroActions}>
                            <Link href="/register" className={styles.btnPrimary} data-glass="accent">
                                Start Splitting - Free
                                <ArrowRight size={18} />
                            </Link>
                            <a href="#features" className={styles.btn} data-glass="thin">See Features</a>
                        </div>
                        <p className={styles.heroNote}>
                            The smartest way to track group expenses on trips. Auto-capture from UPI, scan receipts instantly with AI, and settle up with one tap.
                        </p>
                    </motion.div>
                </section>

                {/* ── Payment alerts ── */}
                <Reveal className={styles.brands}>
                    <p className={styles.eyebrow}>Seamlessly integrates with payment alerts from</p>
                    <div className={styles.brandRow}>
                        {BRANDS.map((brand) => <span key={brand} className={styles.brand} data-glass="clear">{brand}</span>)}
                    </div>
                </Reveal>

                {/* ── How it works ── */}
                <section id="how-it-works" className={styles.section}>
                    <SectionHead eyebrow="How it works" title="Three steps. Zero friction." />
                    <div className={styles.grid3}>
                        {STEPS.map((step, index) => {
                            const Icon = step.icon;
                            return (
                                <Reveal key={step.title} delay={index * 0.06}>
                                    <article className={styles.card} data-glass="reg">
                                        <span className={styles.stepNumber}>0{index + 1}</span>
                                        <span className={styles.cardIcon}><Icon size={22} /></span>
                                        <h3 className={styles.cardTitle}>{step.title}</h3>
                                        <p className={styles.cardText}>{step.desc}</p>
                                    </article>
                                </Reveal>
                            );
                        })}
                    </div>
                </section>

                {/* ── Receipts ── */}
                <section className={styles.section}>
                    <SectionHead eyebrow="Advanced AI" title="Never type a long restaurant bill again.">
                        Drop an image of any paper receipt. SplitX&apos;s OCR instantly recognizes line-items, prices, and even obscure taxes.
                    </SectionHead>
                    <div className={styles.grid2}>
                        <Reveal>
                            <div className={styles.receipt} data-glass="reg">
                                <span className={styles.cardIcon}><Cpu size={22} /></span>
                                {RECEIPT.map((item) => (
                                    <div key={item.name} className={styles.receiptRow}>
                                        <span>{item.name}<small>{item.qty}</small></span>
                                        <strong>{item.price}</strong>
                                    </div>
                                ))}
                            </div>
                        </Reveal>
                        <Reveal delay={0.06}>
                            <ul className={styles.list}>
                                <li data-glass="thin">Splits line items accurately including percentages</li>
                                <li data-glass="thin">Proportionally distributes tax &amp; exact service charge</li>
                                <li data-glass="thin">Detects blurry texts in poor lighting conditions</li>
                            </ul>
                        </Reveal>
                    </div>
                </section>

                {/* ── Settling ── */}
                <section className={styles.section}>
                    <SectionHead eyebrow="Smart Math" title="Settle debts in one tap, not fifty.">
                        5 friends. 12 transactions. Our graph algorithm reduces it all to just 2 transfers. Minimum hassle, maximum clarity.
                    </SectionHead>
                    <Reveal>
                        <div className={styles.orbit} data-glass="reg">
                            <svg className={styles.orbitLines} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                                <path d="M14 42 L50 14" />
                                <path d="M72 86 L86 42" />
                            </svg>
                            {ORBIT.map((node) => (
                                <span key={node.label} className={styles.orbitNode} style={{ left: `${node.x}%`, top: `${node.y}%` }}>{node.label}</span>
                            ))}
                            <span className={styles.orbitCentre}><RefreshCw size={16} />2 transfers</span>
                        </div>
                    </Reveal>
                </section>

                {/* ── Numbers ── */}
                <Reveal className={styles.grid3}>
                    {STATS.map((stat) => (
                        <div key={stat.label} className={styles.stat} data-glass="thin">
                            <strong>{stat.value}</strong>
                            <span>{stat.label}</span>
                        </div>
                    ))}
                </Reveal>

                {/* ── Features ── */}
                <section id="features" className={styles.section}>
                    <SectionHead eyebrow="Features" title="Everything your trip needs." />
                    <div className={styles.grid2}>
                        {FEATURES.map((feature, index) => {
                            const Icon = feature.icon;
                            return (
                                <Reveal key={feature.title} delay={index * 0.05}>
                                    <article className={styles.card} data-glass="reg">
                                        <span className={styles.cardIcon}><Icon size={22} /></span>
                                        <h3 className={styles.cardTitle}>{feature.title}</h3>
                                        <p className={styles.cardText}>{feature.desc}</p>
                                    </article>
                                </Reveal>
                            );
                        })}
                    </div>
                </section>

                {/* ── Voices ── */}
                <section className={styles.section}>
                    <SectionHead eyebrow="Loved by friends" title="People who stopped doing the math." />
                    <div className={styles.grid2}>
                        {VOICES.map((voice, index) => (
                            <Reveal key={voice.name} delay={index * 0.05}>
                                <figure className={styles.card} data-glass="thin">
                                    <blockquote className={styles.cardText}>&ldquo;{voice.text}&rdquo;</blockquote>
                                    <figcaption className={styles.voice}><strong>{voice.name}</strong>{voice.role}</figcaption>
                                </figure>
                            </Reveal>
                        ))}
                    </div>
                </section>

                {/* ── Questions ── */}
                <section id="faq" className={styles.section}>
                    <SectionHead eyebrow="FAQ" title="Common questions." />
                    <Reveal className={styles.questions}>
                        {QUESTIONS.map((item) => <Question key={item.q} q={item.q} a={item.a} />)}
                    </Reveal>
                </section>

                {/* ── The last word ── */}
                <Reveal>
                    <section className={styles.cta} data-glass="accent">
                        <Sparkles size={32} />
                        <h2 className={styles.ctaTitle}>Ready to split smarter?</h2>
                        <p className={styles.ctaText}>Join thousands who have permanently eliminated the awkward &ldquo;you owe me&rdquo; conversation.</p>
                        <Link href="/register" className={styles.btn} data-glass="clear">
                            Get Started Free
                            <ArrowRight size={18} />
                        </Link>
                        <p className={styles.ctaNotes}><span>Free forever</span><span>Works offline</span><span>Install as PWA</span></p>
                    </section>
                </Reveal>
            </main>

            <footer className={styles.footer}>
                <BrandMark size={30} />
                <nav className={styles.footerLinks} aria-label="Footer">
                    <a href="#features">Features</a>
                    <a href="#how-it-works">How it Works</a>
                    <a href="#faq">FAQ</a>
                </nav>
                <div className={styles.socials}>
                    {SOCIALS.map((social) => {
                        const Icon = social.icon;
                        return (
                            <a key={social.label} href={social.href} target="_blank" rel="noreferrer" aria-label={social.label} className={styles.social} data-glass="thin">
                                <Icon size={18} />
                            </a>
                        );
                    })}
                </div>
                <p className={styles.footerNote}>© 2026 SplitX. Built for friends who hate Math.</p>
            </footer>
        </div>
    );
}
