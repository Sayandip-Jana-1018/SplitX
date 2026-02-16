'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { motion, useInView } from 'framer-motion';
import {
  Zap, Receipt, Users, ArrowRightLeft, BarChart3, Camera,
  Wifi, Shield, Smartphone, CheckCircle, ArrowRight, Sparkles,
  Globe, TrendingUp,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import Navbar from '@/components/ui/Navbar';
import ScrollProgress from '@/components/ui/ScrollProgress';
import AnimatedGradient from '@/components/ui/AnimatedGradient';
import TiltCard from '@/components/ui/TiltCard';
import styles from './landing.module.css';

/* ── Animation variants ── */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } },
};

const stagger = {
  visible: {
    transition: { staggerChildren: 0.12 },
  },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.85 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const } },
};

/* ── Animated section wrapper ── */
function AnimatedSection({ children, className, delay = 0 }: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.15 });

  return (
    <motion.section
      ref={ref}
      className={className}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      variants={stagger}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </motion.section>
  );
}

/* ── Feature data ── */
const FEATURES = [
  {
    icon: <Zap size={24} />,
    title: 'Auto-Capture',
    desc: 'Automatically track expenses from UPI notifications and SMS — zero manual entry.',
    gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
  },
  {
    icon: <Camera size={24} />,
    title: 'Receipt OCR',
    desc: 'Snap a photo of any receipt and we extract items, amounts, and tax instantly.',
    gradient: 'linear-gradient(135deg, #3b82f6, #6366f1)',
  },
  {
    icon: <ArrowRightLeft size={24} />,
    title: 'Smart Splits',
    desc: 'Equal, percentage, or item-based splits. Our algorithm finds minimum transfers.',
    gradient: 'linear-gradient(135deg, #10b981, #06b6d4)',
  },
  {
    icon: <BarChart3 size={24} />,
    title: 'Rich Analytics',
    desc: 'Spending trends, category breakdowns, and group comparisons with beautiful charts.',
    gradient: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
  },
  {
    icon: <Smartphone size={24} />,
    title: 'Installable PWA',
    desc: 'Works offline, installs like a native app. Lightning fast on any device.',
    gradient: 'linear-gradient(135deg, #6366f1, #3b82f6)',
  },
  {
    icon: <Shield size={24} />,
    title: 'Privacy First',
    desc: 'Everything parsed on-device. Your financial data never touches our servers.',
    gradient: 'linear-gradient(135deg, #14b8a6, #10b981)',
  },
];

const STEPS = [
  { num: '01', title: 'Create a Trip', desc: 'Start a group and invite friends via QR code or link.' },
  { num: '02', title: 'Log Expenses', desc: 'Auto-capture, scan receipts, or add manually in 3 seconds.' },
  { num: '03', title: 'Settle Up', desc: 'One tap UPI deep-links. Minimum transfers calculated automatically.' },
];

const STATS = [
  { label: 'Expenses Tracked', value: '10K+', icon: <Receipt size={18} /> },
  { label: 'Groups Created', value: '500+', icon: <Users size={18} /> },
  { label: 'Countries', value: '12+', icon: <Globe size={18} /> },
  { label: 'Time Saved', value: '95%', icon: <TrendingUp size={18} /> },
];

export default function LandingPage() {
  return (
    <div className={styles.landingPage}>
      {/* ── Scroll Progress Bar ── */}
      <ScrollProgress />

      {/* ── Ambient Orbs ── */}
      <div className={styles.orbContainer} aria-hidden>
        <div className={styles.orb1} />
        <div className={styles.orb2} />
        <div className={styles.orb3} />
      </div>

      {/* ══════════════════════════════════════════════
               Navigation
               ══════════════════════════════════════════════ */}
      <Navbar />

      {/* ══════════════════════════════════════════════
               Hero Section
               ══════════════════════════════════════════════ */}
      <section className={styles.hero} style={{ position: 'relative', overflow: 'hidden' }}>
        <AnimatedGradient />
        <div className={styles.heroContent} style={{ position: 'relative', zIndex: 1 }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={styles.heroBadge}
          >
            <Sparkles size={14} />
            <span>Powered by AI &amp; OCR</span>
          </motion.div>

          <motion.h1
            className={styles.heroTitle}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            Split expenses
            <br />
            <span className={styles.heroGradient}>without the drama.</span>
          </motion.h1>

          <motion.p
            className={styles.heroSubtitle}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            The smartest way to track group expenses on trips.
            Auto-capture from UPI, scan receipts, and settle with one tap.
          </motion.p>

          <motion.div
            className={styles.heroCTAs}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.55 }}
          >
            <Link href="/register">
              <Button variant="primary" size="lg" rightIcon={<ArrowRight size={18} />}>
                Start Splitting — Free
              </Button>
            </Link>
            <Link href="#features">
              <Button variant="outline" size="lg">
                See Features
              </Button>
            </Link>
          </motion.div>

          {/* ── Floating Demo Cards ── */}
          <motion.div
            className={styles.demoCards}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              className={styles.demoCard}
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <div className={styles.demoCardIcon}>🍕</div>
              <div className={styles.demoCardContent}>
                <span className={styles.demoCardTitle}>Dinner at Barbeque Nation</span>
                <span className={styles.demoCardMeta}>Sayan paid · ₹4,500</span>
              </div>
              <div className={styles.demoCardBadge}>GPay</div>
            </motion.div>

            <motion.div
              className={styles.demoCard}
              animate={{ y: [0, 8, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
            >
              <div className={styles.demoCardIcon}>🚗</div>
              <div className={styles.demoCardContent}>
                <span className={styles.demoCardTitle}>Cab to Airport</span>
                <span className={styles.demoCardMeta}>Aman paid · ₹1,200</span>
              </div>
              <div className={styles.demoCardBadge}>Cash</div>
            </motion.div>

            <motion.div
              className={styles.demoCard}
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
            >
              <div className={styles.demoCardIcon}>🏨</div>
              <div className={styles.demoCardContent}>
                <span className={styles.demoCardTitle}>Hotel Room — 2 nights</span>
                <span className={styles.demoCardMeta}>Priya paid · ₹8,900</span>
              </div>
              <div className={styles.demoCardBadge}>PhonePe</div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
               Social Proof Stats
               ══════════════════════════════════════════════ */}
      <AnimatedSection className={styles.statsSection}>
        <div className={styles.statsGrid}>
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              className={styles.statItem}
              variants={fadeUp}
              transition={{ delay: i * 0.1 }}
            >
              <div className={styles.statIcon}>{stat.icon}</div>
              <span className={styles.statValue}>{stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
            </motion.div>
          ))}
        </div>
      </AnimatedSection>

      {/* ══════════════════════════════════════════════
               Features Section
               ══════════════════════════════════════════════ */}
      <AnimatedSection className={styles.featuresSection} delay={100}>
        <motion.div className={styles.sectionHeader} variants={fadeUp}>
          <span className={styles.sectionBadge}>Features</span>
          <h2 className={styles.sectionTitle}>
            Everything you need to
            <br />
            <span className={styles.heroGradient}>split expenses effortlessly.</span>
          </h2>
          <p className={styles.sectionSubtitle}>
            From auto-capture to smart settlements — we handle the math so you can enjoy the trip.
          </p>
        </motion.div>

        <div className={styles.featuresGrid} id="features">
          {FEATURES.map((f, i) => (
            <TiltCard key={f.title}>
              <motion.div
                className={styles.featureCard}
                variants={scaleIn}
                transition={{ delay: i * 0.08 }}
                whileHover={{ y: -4, transition: { duration: 0.2 } }}
              >
                <div
                  className={styles.featureIcon}
                  style={{ background: f.gradient }}
                >
                  {f.icon}
                </div>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureDesc}>{f.desc}</p>
              </motion.div>
            </TiltCard>
          ))}
        </div>
      </AnimatedSection>

      {/* ══════════════════════════════════════════════
               How It Works
               ══════════════════════════════════════════════ */}
      <AnimatedSection className={styles.howSection} delay={150}>
        <motion.div className={styles.sectionHeader} variants={fadeUp}>
          <span className={styles.sectionBadge}>How It Works</span>
          <h2 className={styles.sectionTitle}>Three steps. Zero stress.</h2>
          <p className={styles.sectionSubtitle}>
            Get from group trip to settled up in under a minute.
          </p>
        </motion.div>

        <div className={styles.stepsGrid}>
          {STEPS.map((step, i) => (
            <motion.div
              key={step.num}
              className={styles.stepCard}
              variants={fadeUp}
              transition={{ delay: i * 0.15 }}
            >
              <div className={styles.stepNum}>{step.num}</div>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepDesc}>{step.desc}</p>
              {i < STEPS.length - 1 && (
                <div className={styles.stepConnector}>
                  <ArrowRight size={16} />
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </AnimatedSection>

      {/* ══════════════════════════════════════════════
               Bottom CTA Section
               ══════════════════════════════════════════════ */}
      <AnimatedSection className={styles.ctaSection}>
        <motion.div className={styles.ctaContent} variants={fadeUp}>
          <h2 className={styles.ctaTitle}>
            Ready to split smarter?
          </h2>
          <p className={styles.ctaSubtitle}>
            Join thousands of groups who settled expenses without awkward conversations.
          </p>
          <div className={styles.ctaCTAs}>
            <Link href="/register">
              <Button variant="primary" size="lg" rightIcon={<ArrowRight size={18} />}>
                Get Started — It&apos;s Free
              </Button>
            </Link>
          </div>
          <div className={styles.ctaFeatures}>
            <span><CheckCircle size={14} /> Free forever</span>
            <span><CheckCircle size={14} /> No credit card</span>
            <span><CheckCircle size={14} /> Works offline</span>
          </div>
        </motion.div>
      </AnimatedSection>

      {/* ══════════════════════════════════════════════
               Footer
               ══════════════════════════════════════════════ */}
      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <div className={styles.logoIcon}>⚡</div>
            <span>AutoSplit</span>
          </div>
          <p className={styles.footerCopy}>
            © {new Date().getFullYear()} AutoSplit. Built with ❤️ by Sayandip.
          </p>
        </div>
      </footer>
    </div>
  );
}
