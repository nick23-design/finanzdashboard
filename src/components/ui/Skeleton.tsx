interface SkeletonProps {
  className?: string;
  height?: string;
}

export function Skeleton({ className = "", height = "h-4" }: SkeletonProps) {
  return <div className={`skeleton ${height} ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div
      className="rounded-2xl border p-4 space-y-3"
      style={{ background: "var(--card)", borderColor: "var(--card-border)" }}>
      <div className="flex justify-between items-start">
        <Skeleton className="w-16" height="h-5" />
        <Skeleton className="w-20" height="h-6" />
      </div>
      <Skeleton className="w-32" height="h-4" />
      <Skeleton className="w-full" height="h-2" />
      <div className="flex gap-3">
        <Skeleton className="flex-1" height="h-8" />
        <Skeleton className="flex-1" height="h-8" />
      </div>
    </div>
  );
}
