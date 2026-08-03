/** Icônes en trait, dessinées pour rester lisibles à 15 px comme à 26 px. */
type P = { className?: string };

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Svg({ children, className }: P & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const IconSearch = (p: P) => (
  <Svg {...p}><circle cx="10.5" cy="10.5" r="6.5" {...S} /><path d="m15.5 15.5 4.5 4.5" {...S} /></Svg>
);

export const IconAlbum = (p: P) => (
  <Svg {...p}><rect x="4" y="5" width="16" height="14" rx="2.5" {...S} /><path d="M4 15.5l4.2-3.8 3.4 3 3-2.4L20 16" {...S} /></Svg>
);

export const IconHeart = (p: P) => (
  <Svg {...p}><path d="M12 20s-7.2-4.4-7.2-9.3A4 4 0 0 1 12 7.6a4 4 0 0 1 7.2 3.1C19.2 15.6 12 20 12 20Z" {...S} /></Svg>
);

export const IconVideo = (p: P) => (
  <Svg {...p}><rect x="3" y="6.5" width="12.5" height="11" rx="2.4" {...S} /><path d="m15.5 12 5-3v9l-5-3z" {...S} /></Svg>
);

export const IconPlus = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.4" {...S} /><path d="M12 8.6v6.8M8.6 12h6.8" {...S} /></Svg>
);

export const IconGear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.1" {...S} />
    <path d="M12 3.4v2.2M12 18.4v2.2M20.6 12h-2.2M5.6 12H3.4M18.1 5.9l-1.6 1.6M7.5 16.5l-1.6 1.6M18.1 18.1l-1.6-1.6M7.5 7.5 5.9 5.9" {...S} />
  </Svg>
);

export const IconFolder = (p: P) => (
  <Svg {...p}><path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.2h8a1.5 1.5 0 0 1 1.5 1.5v7.8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" {...S} /></Svg>
);

export const IconFont = (p: P) => (
  <Svg {...p}><path d="M3.5 18 8.4 6h1.4L14.7 18M5.6 14h7.4M16 18l3.2-8h.6l3.2 8M17.2 15.4h5" {...S} /></Svg>
);

export const IconVolume = (p: P) => (
  <Svg {...p}><path d="M4 9.6h3.2L11.5 6v12L7.2 14.4H4z" {...S} /><path d="M14.6 9.4a3.7 3.7 0 0 1 0 5.2M17.2 7a7.2 7.2 0 0 1 0 10" {...S} /></Svg>
);

export const IconPalette = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.6a8.4 8.4 0 1 0 0 16.8c1.3 0 1.9-.9 1.9-1.8 0-1.3-1-1.7-1-2.7 0-.8.6-1.4 1.5-1.4h1.5A4.5 4.5 0 0 0 20.4 10c0-3.6-3.7-6.4-8.4-6.4Z" {...S} />
    <circle cx="8" cy="10.6" r="1.1" fill="currentColor" /><circle cx="12" cy="7.8" r="1.1" fill="currentColor" /><circle cx="16" cy="10.2" r="1.1" fill="currentColor" />
  </Svg>
);

export const IconKey = (p: P) => (
  <Svg {...p}><circle cx="8" cy="12" r="3.6" {...S} /><path d="M11.6 12H20M17.4 12v3M14.6 12v2.2" {...S} /></Svg>
);

export const IconGlobe = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="8.4" {...S} /><path d="M3.6 12h16.8M12 3.6c2.2 2.4 3.3 5.3 3.3 8.4S14.2 18 12 20.4c-2.2-2.4-3.3-5.3-3.3-8.4S9.8 6 12 3.6Z" {...S} /></Svg>
);

export const IconCheck = (p: P) => (
  <Svg {...p}><path d="m5 12.6 4.4 4.4L19 7.4" {...S} /></Svg>
);

export const IconX = (p: P) => (
  <Svg {...p}><path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" {...S} /></Svg>
);

/** Œil barré : « cacher », qui a remplacé la suppression. */
export const IconHide = (p: P) => (
  <Svg {...p}>
    <path d="M4 12s3.2-5.2 8-5.2c1.3 0 2.5.4 3.5 1M20 12s-3.2 5.2-8 5.2c-1.4 0-2.6-.4-3.7-1.1" {...S} />
    <circle cx="12" cy="12" r="2.3" {...S} /><path d="M4.5 4.5 19.5 19.5" {...S} />
  </Svg>
);

export const IconEye = (p: P) => (
  <Svg {...p}><path d="M3.6 12S7 6.6 12 6.6 20.4 12 20.4 12 17 17.4 12 17.4 3.6 12 3.6 12Z" {...S} /><circle cx="12" cy="12" r="2.5" {...S} /></Svg>
);

/** Quatre coins : « voir en plein écran ». */
export const IconExpand = (p: P) => (
  <Svg {...p}><path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15" {...S} /></Svg>
);

export const IconPencil = (p: P) => (
  <Svg {...p}><path d="M4.6 19.4h3.2L18.9 8.3a1.9 1.9 0 0 0 0-2.7l-.5-.5a1.9 1.9 0 0 0-2.7 0L4.6 16.2z" {...S} /></Svg>
);

export const IconTag = (p: P) => (
  <Svg {...p}><path d="M4.5 11.2V5.6a1 1 0 0 1 1-1h5.6a1 1 0 0 1 .7.3l7 7a1 1 0 0 1 0 1.4l-5.6 5.6a1 1 0 0 1-1.4 0l-7-7a1 1 0 0 1-.3-.7Z" {...S} /><circle cx="8.4" cy="8.4" r="1.2" fill="currentColor" /></Svg>
);

export const IconTrash = (p: P) => (
  <Svg {...p}><path d="M4.8 6.8h14.4M9.6 6.8V5.2a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1v1.6M6.6 6.8l.8 12a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9l.8-12" {...S} /></Svg>
);

export const IconLeft = (p: P) => (
  <Svg {...p}><path d="M14.5 5.5 8 12l6.5 6.5" {...S} /></Svg>
);

export const IconRight = (p: P) => (
  <Svg {...p}><path d="M9.5 5.5 16 12l-6.5 6.5" {...S} /></Svg>
);

export const IconPlay = (p: P) => (
  <Svg {...p}><path d="M8 5.6 19 12 8 18.4z" {...S} /></Svg>
);

export const IconSelect = (p: P) => (
  <Svg {...p}><rect x="4.4" y="4.4" width="15.2" height="15.2" rx="3" {...S} strokeDasharray="3 3" /><path d="m8.4 12 2.6 2.6 4.6-5" {...S} /></Svg>
);

export const IconHome = (p: P) => (
  <Svg {...p}><path d="M4.2 10.6 12 4.4l7.8 6.2v8a1 1 0 0 1-1 1h-4.2v-5.2H9.4V19.6H5.2a1 1 0 0 1-1-1z" {...S} /></Svg>
);

/** Chronologie groupée : une bande par journée. */
export const IconRows = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.4h9M4 12h16M4 18.6h13" {...S} />
    <rect x="4" y="8.2" width="16" height="1.6" rx="0.8" fill="currentColor" opacity="0.45" />
  </Svg>
);

/** Vue condensée : les journées se suivent en largeur. */
export const IconCompact = (p: P) => (
  <Svg {...p}>
    <rect x="3.6" y="4.6" width="6" height="6" rx="1.2" {...S} />
    <rect x="11.4" y="4.6" width="9" height="6" rx="1.2" {...S} />
    <rect x="3.6" y="13.4" width="9" height="6" rx="1.2" {...S} />
    <rect x="14.4" y="13.4" width="6" height="6" rx="1.2" {...S} />
  </Svg>
);

export const IconImage = (p: P) => (
  <Svg {...p}>
    <rect x="3.6" y="5.4" width="16.8" height="13.2" rx="2.2" {...S} />
    <path d="M3.6 15.4l4.4-4 3.4 3 3.2-2.6 5.8 5" {...S} />
    <circle cx="8.6" cy="9.6" r="1.3" {...S} />
  </Svg>
);

export const IconGamepad = (p: P) => (
  <Svg {...p}>
    <path d="M7.6 8.4h8.8a4.4 4.4 0 0 1 4.3 3.5l.7 3.6a2.3 2.3 0 0 1-4.2 1.7l-1.3-2H8.1l-1.3 2a2.3 2.3 0 0 1-4.2-1.7l.7-3.6a4.4 4.4 0 0 1 4.3-3.5Z" {...S} />
    <path d="M7 11.4v2.4M5.8 12.6h2.4" {...S} /><circle cx="16.4" cy="12.4" r="0.9" fill="currentColor" />
  </Svg>
);
