'use client';

import { useRef, useState } from 'react';
import { motion, useInView, AnimatePresence, Variants } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import styles from '@/app/landing.module.css';

const fadeInUp: Variants = {
    hidden: { opacity: 0, y: 40 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } },
};

const stagger: Variants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const FAQS = [
    {
        q: "Is SplitX really completely free?",
        a: "Yes. SplitX is a side-project originally built to solve my own friend group's annoyances. There are no paywalls, premium tiers, or hidden fees.",
    },
    {
        q: "How does Auto-Capture work?",
        a: "AutoCapture parses UPI SMS alerts strictly on your device. We use machine learning to identify the merchant and amount, logging it instantly without needing manual entry.",
    },
    {
        q: "Is my financial data safe?",
        a: "Absolutely. All receipt parsing happens on the device where possible, and we do not sell your transaction data to advertisers. Your data remains completely private.",
    },
    {
        q: "Does it work without the internet?",
        a: "Yes! SplitX is a Progressive Web App (PWA). You can install it to your home screen, log expenses offline on a mountain, and it will sync once you reconnect.",
    },
];

export default function FAQ() {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-10% 0px' });
    const [openIdx, setOpenIdx] = useState<number | null>(0);

    return (
        <motion.section
            ref={ref}
            className={styles.faqSection}
            initial="hidden"
            animate={inView ? 'visible' : 'hidden'}
            variants={stagger}
        >
            <div className={styles.sectionHeader}>
                <motion.h2 className={styles.sectionTitle} variants={fadeInUp}>
                    Common questions.
                </motion.h2>
            </div>

            <motion.div className={styles.faqContainer} variants={stagger}>
                {FAQS.map((faq, idx) => (
                    <motion.div
                        key={idx}
                        className={`${styles.faqItem} ${openIdx === idx ? styles.faqOpen : ''}`}
                        variants={fadeInUp}
                        onClick={() => setOpenIdx(idx === openIdx ? null : idx)}
                        layout
                    >
                        <div className={styles.faqHeader}>
                            <h3 className={styles.faqQuestion}>{faq.q}</h3>
                            <motion.div
                                animate={{ rotate: openIdx === idx ? 180 : 0 }}
                                transition={{ duration: 0.3, ease: 'easeInOut' }}
                            >
                                <ChevronDown size={20} className={styles.faqIcon} />
                            </motion.div>
                        </div>
                        <AnimatePresence initial={false}>
                            {openIdx === idx && (
                                <motion.div
                                    className={styles.faqBody}
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                                    style={{ overflow: 'hidden' }}
                                >
                                    <p className={styles.faqAnswer}>{faq.a}</p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                ))}
            </motion.div>
        </motion.section>
    );
}
