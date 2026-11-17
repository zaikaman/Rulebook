export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
        aria-hidden
      >
        <path
          d="M4 19.5V4.5C4 3.67157 4.67157 3 5.5 3H10.5C11.3284 3 12 3.67157 12 4.5V19.5C12 18.6716 11.3284 18 10.5 18H5.5C4.67157 18 4 18.6716 4 19.5Z"
          fill="url(#rulebook-gradient-left)"
          stroke="#7C5CFF"
          strokeWidth="1.2"
        />
        <path
          d="M20 19.5V4.5C20 3.67157 19.3284 3 18.5 3H13.5C12.6716 3 12 3.67157 12 4.5V19.5C12 18.6716 12.6716 18 13.5 18H18.5C19.3284 18 20 18.6716 20 19.5Z"
          fill="url(#rulebook-gradient-right)"
          stroke="#3B82F6"
          strokeWidth="1.2"
        />
        <path
          d="M7 8L9 10L7 12M17 8L15 10L17 12"
          stroke="#FFFFFF"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <defs>
          <linearGradient
            id="rulebook-gradient-left"
            x1="4"
            y1="3"
            x2="12"
            y2="19.5"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#7C5CFF" stopOpacity="0.4" />
            <stop stopColor="#7C5CFF" stopOpacity="0.05" />
          </linearGradient>
          <linearGradient
            id="rulebook-gradient-right"
            x1="12"
            y1="3"
            x2="20"
            y2="19.5"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#3B82F6" stopOpacity="0.4" />
            <stop stopColor="#3B82F6" stopOpacity="0.05" />
          </linearGradient>
        </defs>
      </svg>
      <span className="font-heading font-bold text-white tracking-tight">Rulebook</span>
    </span>
  );
}
