export default function Logo({ className = "h-10 w-10" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
    >
      <rect width="100" height="100" fill="transparent"/>
      <rect x="10" y="10" width="80" height="80" fill="none" stroke="currentColor" strokeWidth="3"/>
      <text x="50" y="70" fontFamily="monospace" fontSize="50" fontWeight="bold" fill="currentColor" textAnchor="middle">Z</text>
    </svg>
  );
}
