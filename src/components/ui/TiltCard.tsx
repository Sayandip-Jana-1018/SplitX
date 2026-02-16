'use client';

import { useRef, useState, ReactNode, CSSProperties } from 'react';

interface TiltCardProps {
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
    maxTilt?: number;
}

/**
 * 3D tilt card — tracks mouse position to apply subtle rotateX/Y.
 * Uses CSS perspective transform, resets on mouse leave with smooth transition.
 */
export default function TiltCard({ children, className, style, maxTilt = 4 }: TiltCardProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [transform, setTransform] = useState('perspective(800px) rotateX(0deg) rotateY(0deg)');

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -maxTilt;
        const rotateY = ((x - centerX) / centerX) * maxTilt;
        setTransform(`perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`);
    };

    const handleMouseLeave = () => {
        setTransform('perspective(800px) rotateX(0deg) rotateY(0deg)');
    };

    return (
        <div
            ref={ref}
            className={className}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            style={{
                ...style,
                transform,
                transition: 'transform 0.15s ease-out',
                willChange: 'transform',
            }}
        >
            {children}
        </div>
    );
}
