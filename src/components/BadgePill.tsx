import { UserBadge } from "@/contexts/WalletContext";

type Props = {
  badge: UserBadge;
};

export function BadgePill({ badge }: Props) {
  return (
    <span
      className="px-3 py-1 rounded-full text-xs font-semibold bg-gold-500/15 border border-gold-400/40 text-gold-200 flex items-center gap-1"
      title={badge.description || badge.reason || undefined}
    >
      {badge.icon ? <span aria-hidden>{badge.icon}</span> : null}
      <span>{badge.label || badge.badgeSlug.toUpperCase()}</span>
    </span>
  );
}
