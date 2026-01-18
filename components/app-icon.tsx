export function AppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect width="24" height="24" rx="4.5" fill="var(--primary)" />
      <path d="M8 5v14l11-7z" fill="white" />
    </svg>
  )
}
