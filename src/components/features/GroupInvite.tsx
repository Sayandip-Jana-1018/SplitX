'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'framer-motion';
import { Copy, Check, Share2, QrCode } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';

interface GroupInviteProps {
    groupName: string;
    inviteCode: string;
    emoji?: string;
}

export default function GroupInvite({ groupName, inviteCode, emoji = '✈️' }: GroupInviteProps) {
    const [copied, setCopied] = useState(false);
    const [showQR, setShowQR] = useState(false);

    const inviteUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/invite/${inviteCode}`
        : `/invite/${inviteCode}`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = inviteUrl;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Join ${groupName} on SplitX`,
                    text: `${emoji} You've been invited to "${groupName}" on SplitX! Track expenses together.`,
                    url: inviteUrl,
                });
            } catch {
                // User cancelled share
            }
        } else {
            handleCopy();
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Invite link */}
            <Card padding="normal">
                <div style={{ marginBottom: 'var(--space-3)' }}>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', fontWeight: 500, marginBottom: 4 }}>
                        Invite Link
                    </p>
                    <div style={{
                        display: 'flex',
                        gap: 'var(--space-2)',
                        alignItems: 'center',
                    }}>
                        <div style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: 'var(--text-sm)',
                            color: 'var(--fg-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontFamily: 'var(--font-mono)',
                        }}>
                            {inviteUrl}
                        </div>
                        <Button
                            size="sm"
                            variant={copied ? 'primary' : 'outline'}
                            iconOnly
                            onClick={handleCopy}
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                        </Button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <Button
                        fullWidth
                        variant="outline"
                        leftIcon={<Share2 size={14} />}
                        onClick={handleShare}
                    >
                        Share
                    </Button>
                    <Button
                        fullWidth
                        variant="outline"
                        leftIcon={<QrCode size={14} />}
                        onClick={() => setShowQR(!showQR)}
                    >
                        {showQR ? 'Hide QR' : 'Show QR'}
                    </Button>
                </div>
            </Card>

            {/* QR Code */}
            {showQR && (
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    style={{ overflow: 'hidden' }}
                >
                    <Card padding="normal" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <div style={{
                            background: 'white',
                            padding: 16,
                            borderRadius: 'var(--radius-lg)',
                        }}>
                            <QRCodeSVG
                                value={inviteUrl}
                                size={180}
                                level="M"
                                includeMargin={false}
                                fgColor="#1a1a2e"
                                bgColor="#ffffff"
                            />
                        </div>
                        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--fg-tertiary)', textAlign: 'center' }}>
                            Scan to join <strong>{groupName}</strong>
                        </p>
                    </Card>
                </motion.div>
            )}
        </div>
    );
}
