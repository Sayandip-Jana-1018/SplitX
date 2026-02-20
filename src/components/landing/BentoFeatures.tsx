'use client';

import { useRef } from 'react';
import { motion, useInView, Variants } from 'framer-motion';
import { Zap, BarChart3, Smartphone, Shield } from 'lucide-react';
import styles from '@/app/landing.module.css';

const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

const stagger: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

const features = [
    {
        icon: Zap,
        title: 'Silent Auto-Capture',
        desc: 'Connect your SMS or UPI notifications. Whenever you make a payment for the trip, SplitX reads the alert and logs the expense instantly.',
        gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
        span: true,
    },
    {
        icon: BarChart3,
        title: 'Stunning Analytics',
        desc: 'Visualize your spending across categories, view historical trends, and see exactly where the budget went.',
        gradient: 'linear-gradient(135deg, #a855f7, #ec4899)',
        span: false,
    },
    {
        icon: Smartphone,
        title: 'Offline Capable PWA',
        desc: 'Install SplitX directly to your home screen. It works natively even without an internet connection on a hike.',
        gradient: 'linear-gradient(135deg, #64748b, #334155)',
        span: false,
    },
    {
        icon: Shield,
        title: 'Privacy First Infrastructure',
        desc: 'Your financial data stays yours. SplitX relies on localized Edge networking and strict row-level security. No ads, no trackers.',
        gradient: 'linear-gradient(135deg, #10b981, #06b6d4)',
        span: true,
    },
];

export default function BentoFeatures() {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-10% 0px' });

    return (
        <motion.section
            ref={ref}
            id="features"
            className={styles.featuresSection}
            initial="hidden"
            animate={inView ? 'visible' : 'hidden'}
            variants={stagger}
        >
            <div className={styles.sectionHeader}>
                <motion.div className={styles.heroBadge} variants={fadeInUp} style={{ margin: '0 auto 16px' }}>
                    Power user features
                </motion.div>
                <motion.h2 className={styles.sectionTitle} variants={fadeInUp}>
                    Everything you need.<br />Nothing you don&apos;t.
                </motion.h2>
            </div>

            <motion.div className={styles.bentoGrid} variants={stagger}>
                {features.map((f, i) => (
                    <motion.div
                        key={i}
                        className={`${styles.bentoCard} ${f.span ? styles.colSpan2 : ''}`}
                        variants={fadeInUp}
                        whileHover={{ y: -8, transition: { duration: 0.3 } }}
                    >
                        <div className={styles.bentoCardInner}>
                            <div className={styles.bentoGradientBorder} />
                            <motion.div
                                className={styles.bentoIcon}
                                style={{ background: f.gradient }}
                                whileHover={{ rotate: [0, -10, 10, 0], scale: 1.1 }}
                                transition={{ duration: 0.5 }}
                            >
                                <f.icon size={24} color="#fff" />
                            </motion.div>
                            <h3 className={styles.bentoTitle}>{f.title}</h3>
                            <p className={styles.bentoDesc}>{f.desc}</p>
                        </div>
                    </motion.div>
                ))}
            </motion.div>
        </motion.section>
    );
}
