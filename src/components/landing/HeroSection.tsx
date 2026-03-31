'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, Variants } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Sparkles } from 'lucide-react';
import Button from '@/components/ui/Button';
import styles from '@/app/landing.module.css';

const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

const stagger: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

const scaleIn: Variants = {
    hidden: { opacity: 0, scale: 0.9, y: 28 },
    visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] } },
};

const PARTICLES = [
    { left: 5, top: 12, delay: 0.0, dur: 4.2, size: 3 },
    { left: 15, top: 78, delay: 2.1, dur: 5.1, size: 2 },
    { left: 25, top: 35, delay: 0.8, dur: 3.8, size: 4 },
    { left: 35, top: 90, delay: 3.5, dur: 6.0, size: 3 },
    { left: 45, top: 22, delay: 1.2, dur: 4.5, size: 5 },
    { left: 55, top: 65, delay: 4.0, dur: 3.2, size: 2 },
    { left: 65, top: 8, delay: 0.5, dur: 5.5, size: 4 },
    { left: 75, top: 52, delay: 2.8, dur: 4.0, size: 3 },
    { left: 85, top: 40, delay: 1.6, dur: 6.2, size: 2 },
    { left: 92, top: 72, delay: 3.2, dur: 3.5, size: 5 },
    { left: 10, top: 55, delay: 4.5, dur: 4.8, size: 3 },
    { left: 30, top: 18, delay: 0.3, dur: 5.3, size: 4 },
    { left: 50, top: 85, delay: 2.5, dur: 3.6, size: 2 },
    { left: 70, top: 30, delay: 1.8, dur: 6.5, size: 3 },
    { left: 88, top: 15, delay: 3.8, dur: 4.1, size: 5 },
    { left: 20, top: 62, delay: 0.9, dur: 5.8, size: 2 },
    { left: 40, top: 5, delay: 4.2, dur: 3.4, size: 4 },
    { left: 60, top: 48, delay: 1.4, dur: 4.6, size: 3 },
    { left: 78, top: 88, delay: 2.3, dur: 5.0, size: 2 },
    { left: 95, top: 25, delay: 3.0, dur: 6.8, size: 4 },
];

export default function HeroSection() {
    const ref = useRef(null);
    const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
    const heroY = useTransform(scrollYProgress, [0, 1], [0, 140]);
    const heroOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
    const heroMediaRotateX = useTransform(scrollYProgress, [0, 0.5], [6, 0]);
    const heroMediaRotateY = useTransform(scrollYProgress, [0, 0.5], [-3, 0]);
    const heroMediaScale = useTransform(scrollYProgress, [0, 0.3], [1, 0.97]);

    return (
        <section ref={ref} className={styles.heroSection} style={{ position: 'relative' }}>
            <div className={styles.heroParticles}>
                {PARTICLES.map((p, i) => (
                    <div
                        key={i}
                        className={styles.particle}
                        style={{
                            left: `${p.left}%`,
                            top: `${p.top}%`,
                            animationDelay: `${p.delay}s`,
                            animationDuration: `${p.dur}s`,
                            width: `${p.size}px`,
                            height: `${p.size}px`,
                        }}
                    />
                ))}
            </div>

            <motion.div
                className={styles.heroContent}
                style={{ y: heroY, opacity: heroOpacity }}
                initial="hidden"
                animate="visible"
                variants={stagger}
            >
                <motion.div className={styles.heroBadge} variants={fadeInUp}>
                    <span className={styles.heroBadgePulse} />
                    <Sparkles size={14} className={styles.heroBadgeIcon} />
                    <span>V-1.0 is here - Experience next-gen tracking</span>
                </motion.div>

                <motion.h1 className={styles.heroTitle} variants={fadeInUp}>
                    Split expenses, <span className={styles.heroGradient}>keep the vibe.</span>
                </motion.h1>

                <motion.p className={styles.heroLead} variants={fadeInUp}>
                    One shared memory deserves one calm money story.
                </motion.p>

                <motion.div className={styles.heroCTAs} variants={fadeInUp}>
                    <Link href="/register">
                        <Button size="lg" className={styles.primaryCtaBtn}>
                            <span className={styles.ctaBtnShine} />
                            Start Splitting - Free
                            <ArrowRight size={18} style={{ marginLeft: '8px' }} />
                        </Button>
                    </Link>
                    <Link href="#features">
                        <Button size="lg" variant="outline" className={styles.secondaryCtaBtn}>
                            See Features
                        </Button>
                    </Link>
                </motion.div>

                <motion.div
                    className={styles.heroVideoShell}
                    variants={scaleIn}
                    style={{
                        rotateX: heroMediaRotateX,
                        rotateY: heroMediaRotateY,
                        scale: heroMediaScale,
                    }}
                >
                    <div className={styles.heroVideoAura} />
                    <div className={styles.heroVideoFrame}>
                        <div className={styles.heroVideoBrand}>
                            <Image
                                src="/icons/icon-192.png"
                                alt="SplitX"
                                width={26}
                                height={26}
                                className={styles.heroVideoBrandIcon}
                            />
                            <span className={styles.heroVideoBrandText}>SplitX</span>
                        </div>
                        <video
                            className={styles.heroVideo}
                            src="/video.mp4"
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="metadata"
                        />
                        <div className={styles.heroVideoOverlay} />
                    </div>
                    <div className={styles.heroVideoTags} aria-hidden="true">
                        <span className={styles.heroVideoTag}>Friends argue less</span>
                        <span className={styles.heroVideoTag}>Balances stay clear</span>
                        <span className={styles.heroVideoTag}>Settlements feel instant</span>
                    </div>
                </motion.div>

                <motion.p className={styles.heroSubtitle} variants={fadeInUp}>
                    The smartest way to track group expenses on trips. Auto-capture from UPI,
                    scan receipts instantly with AI, and settle up with one tap.
                </motion.p>
            </motion.div>
        </section>
    );
}
