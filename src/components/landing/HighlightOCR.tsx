'use client';

import { useRef } from 'react';
import { motion, useInView, Variants } from 'framer-motion';
import { Cpu, Sparkles } from 'lucide-react';
import styles from '@/app/landing.module.css';

const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

const stagger: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.15 } },
};

const itemReveal: Variants = {
    hidden: { opacity: 0, x: -20 },
    visible: (i: number) => ({
        opacity: 1, x: 0,
        transition: { duration: 0.5, delay: 0.8 + i * 0.2, ease: 'easeOut' },
    }),
};

export default function HighlightOCR() {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-10% 0px' });

    return (
        <motion.section
            ref={ref}
            className={styles.highlightSection}
            initial="hidden"
            animate={inView ? 'visible' : 'hidden'}
            variants={stagger}
        >
            <div className={styles.highlightGrid}>
                <motion.div className={styles.highlightText} variants={fadeInUp}>
                    <div className={styles.highlightTag}><Cpu size={16} /> Advanced AI</div>
                    <h2 className={styles.sectionTitle}>
                        Never type a long restaurant bill again.
                    </h2>
                    <p className={styles.sectionSubtitle}>
                        Drop an image of any paper receipt. SplitX&apos;s OCR instantly recognizes line-items, prices, and even obscure tax brackets.
                    </p>
                    <ul className={styles.highlightList}>
                        <li><span className={styles.highlightEmoji}>📊</span> Splits line items accurately including percentages</li>
                        <li><span className={styles.highlightEmoji}>🧾</span> Proportionally distributes tax &amp; exact service charges</li>
                        <li><span className={styles.highlightEmoji}>🔍</span> Detects blurry texts in poor lighting conditions with OpenAi</li>
                    </ul>

                    {/* Scan engine badges */}
                    <div className={styles.scanEngineBadges}>
                        <div className={styles.scanEngineBadge}>
                            <div className={styles.scanEngineBadgeIcon} style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
                                <Cpu size={18} color="#fff" />
                            </div>
                            <div>
                                <span className={styles.scanEngineBadgeTitle}>Basic Scan</span>
                                <span className={styles.scanEngineBadgeSub}>Powered by Tesseract OCR</span>
                            </div>
                        </div>
                        <div className={styles.scanEngineBadge}>
                            <div className={styles.scanEngineBadgeIcon} style={{ background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' }}>
                                <Sparkles size={18} color="#fff" />
                            </div>
                            <div>
                                <span className={styles.scanEngineBadgeTitle}>Advanced Scan</span>
                                <span className={styles.scanEngineBadgeSub}>Powered by OpenAI GPT-4o</span>
                            </div>
                        </div>
                    </div>
                </motion.div>

                <motion.div className={styles.highlightVisualOuter} variants={fadeInUp}>
                    <div className={styles.highlightVisual}>
                        <div className={styles.visualMockup3D}>
                            {[
                                { name: 'Garlic Bread', qty: 'Qty: 1', price: '₹250.00' },
                                { name: 'Pasta Alfredo', qty: 'Qty: 2', price: '₹680.00' },
                                { name: 'CGST (2.5%)', qty: 'Computed', price: '₹23.25' },
                            ].map((item, i) => (
                                <motion.div key={i} className={styles.visualItem} custom={i} variants={itemReveal}>
                                    <div className={styles.vItemInfo}>
                                        <span style={{ fontWeight: 600 }}>{item.name}</span>
                                        <span style={{ fontSize: 12, color: i === 2 ? 'var(--color-warning)' : 'var(--fg-tertiary)' }}>{item.qty}</span>
                                    </div>
                                    <div style={{ fontWeight: 700 }}>{item.price}</div>
                                </motion.div>
                            ))}
                            <div className={styles.visualScannerBar} />
                            <div className={styles.scannerGlow} />
                        </div>
                    </div>
                </motion.div>
            </div>
        </motion.section>
    );
}
