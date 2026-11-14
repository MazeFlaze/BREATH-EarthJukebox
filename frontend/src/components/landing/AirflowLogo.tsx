import React from 'react';

interface AirflowLogoProps {
  size?: 32 | 80;
  animate?: boolean;
  className?: string;
}

export const AirflowLogo: React.FC<AirflowLogoProps> = ({
  size = 32,
  animate = false,
  className = '',
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={`${animate ? 'animate-breathe' : ''} ${className}`}
    >
      {/* Outer breath halo */}
      <circle
        cx="40"
        cy="40"
        r="34"
        stroke="white"
        strokeOpacity="0.22"
        strokeWidth="1.2"
      />
      {/* Mid resonant ring */}
      <circle
        cx="40"
        cy="40"
        r="24"
        stroke="white"
        strokeOpacity="0.45"
        strokeWidth="1.2"
        strokeDasharray="4 6"
      />
      {/* Flowing airflow waveform curves */}
      <path
        d="M12 40C20 26 28 26 40 40C52 54 60 54 68 40"
        stroke="white"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d="M16 40C24 50 31 50 40 40C49 30 56 30 64 40"
        stroke="white"
        strokeOpacity="0.7"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M22 40C29 33 34 33 40 40C46 47 51 47 58 40"
        stroke="white"
        strokeOpacity="0.45"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
      <circle cx="40" cy="40" r="2.2" fill="white" />
    </svg>
  );
};
