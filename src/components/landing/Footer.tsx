'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Github, Twitter, Instagram, Linkedin } from 'lucide-react';
import styles from '@/app/landing.module.css';

const socials = [
    { icon: Github, href: 'https://github.com/Sayandip-Jana-1018', label: 'GitHub' },
    { icon: Twitter, href: 'https://x.com/51Sayandip', label: 'Twitter' },
    { icon: Instagram, href: 'https://www.instagram.com/sj_sayandip/', label: 'Instagram' },
    { icon: Linkedin, href: 'https://www.linkedin.com/in/jsayandip2003/', label: 'LinkedIn' },
];

export default function Footer() {
    return (
        <footer className={styles.footer}>
            <div className={styles.footerInner}>


                <div className={styles.footerColumns}>
                    <div className={styles.footerCol}>
                        <h4 className={styles.footerColTitle}>Product</h4>
                        <Link href="#features">Features</Link>
                        <Link href="#how-it-works">How it Works</Link>
                        <Link href="#faq">FAQ</Link>
                    </div>
                    <div className={styles.footerCol}>
                        <h4 className={styles.footerColTitle}>Connect</h4>
                        <div className={styles.socialIcons}>
                            {socials.map((s) => (
                                <motion.a
                                    key={s.label}
                                    href={s.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.socialIcon}
                                    whileHover={{ y: -3, scale: 1.15 }}
                                    whileTap={{ scale: 0.9 }}
                                    title={s.label}
                                >
                                    <s.icon size={18} />
                                </motion.a>
                            ))}
                        </div>
                    </div>
                    <div className={styles.footerCol}>
                        <h4 className={styles.footerColTitle}>Legal</h4>
                        <Link href="#">Privacy Policy</Link>
                        <Link href="#">Terms of Service</Link>
                        <Link href="#">Contact</Link>
                    </div>
                </div>
            </div>

            <div className={styles.footerBottom}>
                <p>© 2026 SplitX. Built for friends who hate Math.</p>
            </div>
        </footer>
    );
}
