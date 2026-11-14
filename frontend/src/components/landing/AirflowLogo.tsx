import React from 'react';
import Image from 'next/image';

interface AirflowLogoProps {
  size?: number;
  animate?: boolean;
  className?: string;
}

export const AirflowLogo: React.FC<AirflowLogoProps> = ({
  size = 32,
  animate = false,
  className = '',
}) => {
  return (
    <div
      style={{ width: size, height: size }}
      className={`relative inline-flex items-center justify-center shrink-0 ${
        animate ? 'animate-breathe' : ''
      } ${className}`}
    >
      <Image
        src="/landing-assets/planet_logo.png"
        alt="BREATHE Logo"
        width={size}
        height={size}
        className="w-full h-full object-contain filter drop-shadow-[0_0_12px_rgba(255,255,255,0.25)]"
        priority
      />
    </div>
  );
};
