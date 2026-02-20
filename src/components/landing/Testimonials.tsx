'use client';

import { useRef } from 'react';
import { motion, useInView, Variants } from 'framer-motion';
import { Star, Quote } from 'lucide-react';
import styles from '@/app/landing.module.css';

const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

const stagger: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.12 } },
};

const testimonials = [
    {
        text: "Finally an app that doesn't make me do the math. The receipt OCR read a crumpled, faded bar bill in Goa flawlessly. Saved us hours.",
        name: 'Aman Verma',
        role: 'Used for a 7-day trip',
        color: '#8b5cf6',
        initial: 'A',
    },
    {
        text: "We used to use Splitwise, but the ads were unbearable. SplitX is fast, gorgeous, and the one-tap UPI payments are game changers.",
        name: 'Priya Sharma',
        role: 'Event Organizer',
        color: '#ec4899',
        initial: 'P',
    },
    {
        text: "The design is incredibly satisfying to use. Dark mode actually looks cohesive, and everything feels instantly responsive.",
        name: 'Kunal Roy',
        role: 'UI/UX Designer',
        color: '#10b981',
        initial: 'K',
    },
    {
        text: "OCR picked up every line item from a messy handwritten bill. The graph view for settlements is pure genius. 10/10 recommend!",
        name: 'Sneha Jain',
        role: 'College trip organizer',
        color: '#f59e0b',
        initial: 'S',
    },
];

export default function Testimonials() {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-10% 0px' });

    return (
        <motion.section
            ref={ref}
            className={styles.testimonialSection}
            initial="hidden"
            animate={inView ? 'visible' : 'hidden'}
            variants={stagger}
        >
            <div className={styles.sectionHeader}>
                <motion.h2 className={styles.sectionTitle} variants={fadeInUp}>
                    Groups love SplitX.
                </motion.h2>
                <motion.p className={styles.sectionSubtitle} variants={fadeInUp}>
                    Hear what real users have to say.
                </motion.p>
            </div>

            <motion.div className={styles.testimonialGrid} variants={stagger}>
                {testimonials.map((t, i) => (
                    <motion.div
                        key={i}
                        className={styles.testimonialCard}
                        variants={fadeInUp}
                        whileHover={{ y: -6, transition: { duration: 0.3 } }}
                    >
                        <div className={styles.testimonialCardGlow} />
                        <div className={styles.testimonialQuoteIcon}>
                            <Quote size={18} />
                        </div>
                        <div className={styles.stars}>
                            {Array(5).fill(0).map((_, j) => <Star key={j} size={14} fill="#fbbf24" stroke="#fbbf24" />)}
                        </div>
                        <p className={styles.testimonialText}>&ldquo;{t.text}&rdquo;</p>
                        <div className={styles.testimonialAuthor}>
                            <div className={styles.authorAvatar} style={{ background: t.color }}>{t.initial}</div>
                            <div>
                                <span className={styles.authorName}>{t.name}</span>
                                <span className={styles.authorRole}>{t.role}</span>
                            </div>
                        </div>
                    </motion.div>
                ))}
            </motion.div>
        </motion.section>
    );
}
