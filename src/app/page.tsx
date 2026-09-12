'use client';

import HeroSection from '@/components/landing/HeroSection';
import LogoMarquee from '@/components/landing/LogoMarquee';
import HowItWorks from '@/components/landing/HowItWorks';
import HighlightOCR from '@/components/landing/HighlightOCR';
import HighlightGraph from '@/components/landing/HighlightGraph';
import StatsCounter from '@/components/landing/StatsCounter';
import BentoFeatures from '@/components/landing/BentoFeatures';
import Testimonials from '@/components/landing/Testimonials';
import FAQ from '@/components/landing/FAQ';
import BottomCTA from '@/components/landing/BottomCTA';
import Footer from '@/components/landing/Footer';
import Navbar from '@/components/ui/Navbar';
import Ambient from '@/components/ui/Ambient';
import Reveal from '@/components/landing/Reveal';
import styles from './landing.module.css';

export default function LandingPage() {
  return (
    <div className={styles.landingPage}>
      {/* Ambient colour fields + floating expense glyphs */}
      <Ambient variant="hero" orbits />

      <Navbar />

      <main className={styles.mainContent}>
        <HeroSection />
        <Reveal><LogoMarquee /></Reveal>
        <Reveal><HowItWorks /></Reveal>
        <Reveal><HighlightOCR /></Reveal>
        <Reveal><HighlightGraph /></Reveal>
        <Reveal><StatsCounter /></Reveal>
        <Reveal><BentoFeatures /></Reveal>
        <Reveal><Testimonials /></Reveal>
        <Reveal><FAQ /></Reveal>
        <Reveal><BottomCTA /></Reveal>
      </main>

      <Footer />
    </div>
  );
}
