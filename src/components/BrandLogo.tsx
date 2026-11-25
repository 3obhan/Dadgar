import React from 'react';

interface BrandLogoProps {
  className?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({ className = 'w-8 h-10' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 250 326"
    fill="none"
    aria-hidden="true"
    className={className}
  >
    <polygon points="2,92 54,116 54,198 2,174" fill="#FFC400" />
    <polygon points="62,116 114,92 114,174 62,198" fill="#111111" />
    <polygon points="122,4 180,30 180,112 122,86" fill="#111111" />
    <polygon points="122,182 180,208 180,290 122,264" fill="#111111" />
    <polygon points="188,33 246,59 246,141 188,115" fill="#111111" />
    <polygon points="188,125 246,151 246,233 188,207" fill="#111111" />
    <polygon points="188,217 246,243 246,325 188,299" fill="#111111" />
  </svg>
);
