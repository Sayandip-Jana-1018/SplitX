'use client';

import { motion } from 'framer-motion';
import { Ghost, Home, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function NotFound() {
    const router = useRouter();

    return (
        <div style={{
            minHeight: '100vh', minBlockSize: '100dvh',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-primary)',
            padding: 'var(--space-4)',
            position: 'relative', overflow: 'hidden',
        }}>
            {/* Ambient background */}
            <div style={{
                position: 'absolute', inset: 0,
                background: `
                    radial-gradient(ellipse 60% 40% at 50% 20%, rgba(var(--accent-500-rgb), 0.08) 0%, transparent 60%),
                    radial-gradient(ellipse 40% 30% at 80% 70%, rgba(var(--accent-500-rgb), 0.04) 0%, transparent 50%)
                `,
                pointerEvents: 'none',
            }} />

            <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                style={{
                    maxWidth: 400, width: '100%', textAlign: 'center',
                    background: 'var(--bg-glass)',
                    backdropFilter: 'blur(24px) saturate(1.5)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 'var(--radius-2xl)',
                    boxShadow: 'var(--shadow-lg), 0 0 40px rgba(var(--accent-500-rgb), 0.06)',
                    padding: 'var(--space-8) var(--space-6)',
                    position: 'relative', overflow: 'hidden',
                }}
            >
                {/* Top light */}
                <div style={{
                    position: 'absolute', top: 0, left: '15%', right: '15%', height: 1,
                    background: 'linear-gradient(90deg, transparent, rgba(var(--accent-500-rgb), 0.2), transparent)',
                    pointerEvents: 'none',
                }} />

                {/* Ghost icon with glow */}
                <motion.div
                    animate={{ y: [0, -8, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    style={{
                        width: 72, height: 72, borderRadius: 'var(--radius-2xl)',
                        background: 'linear-gradient(135deg, rgba(var(--accent-500-rgb), 0.12), rgba(var(--accent-500-rgb), 0.04))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto var(--space-5)',
                        boxShadow: '0 8px 32px rgba(var(--accent-500-rgb), 0.12)',
                    }}
                >
                    <Ghost size={32} style={{ color: 'var(--accent-400)' }} />
                </motion.div>

                {/* 404 number */}
                <div style={{
                    fontSize: '4rem', fontWeight: 900, lineHeight: 1,
                    background: 'linear-gradient(135deg, var(--accent-400), var(--accent-500), var(--accent-600))',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                    marginBottom: 'var(--space-2)',
                }}>
                    404
                </div>

                <h1 style={{
                    fontSize: 'var(--text-lg)', fontWeight: 700,
                    color: 'var(--fg-primary)', marginBottom: 'var(--space-2)',
                }}>
                    Page Not Found
                </h1>
                <p style={{
                    fontSize: 'var(--text-sm)', color: 'var(--fg-tertiary)',
                    marginBottom: 'var(--space-6)', lineHeight: 1.6,
                }}>
                    The page you&apos;re looking for doesn&apos;t exist or has been moved.
                </p>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
                    <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => router.back()}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '10px 18px', borderRadius: 'var(--radius-full)',
                            background: 'rgba(var(--accent-500-rgb), 0.08)',
                            border: '1px solid rgba(var(--accent-500-rgb), 0.12)',
                            color: 'var(--accent-400)', fontSize: 'var(--text-sm)', fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        <ArrowLeft size={15} /> Go Back
                    </motion.button>
                    <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => router.push('/dashboard')}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '10px 18px', borderRadius: 'var(--radius-full)',
                            background: 'linear-gradient(135deg, var(--accent-500), var(--accent-600))',
                            border: 'none', color: 'white',
                            fontSize: 'var(--text-sm)', fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: '0 4px 16px rgba(var(--accent-500-rgb), 0.3)',
                        }}
                    >
                        <Home size={15} /> Dashboard
                    </motion.button>
                </div>
            </motion.div>
        </div>
    );
}
