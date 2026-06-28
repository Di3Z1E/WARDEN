interface SparklineProps {
  events: { state: string; latency_ms?: number | null }[];
  bars?: number;
  width?: number;
  height?: number;
}

export default function Sparkline({ events, bars = 20, height = 18 }: SparklineProps) {
  const barW = 3;
  const gap = 1;
  const totalW = bars * (barW + gap) - gap;

  const padded: ({ state: string; latency_ms?: number | null } | null)[] = [
    ...Array(Math.max(0, bars - events.length)).fill(null),
    ...events.slice(-bars),
  ];

  return (
    <svg width={totalW} height={height} className="flex-shrink-0" aria-hidden>
      {padded.map((e, i) => {
        const x = i * (barW + gap);
        const fill =
          e === null ? "#1e293b" :
          e.state === "up" ? "#22c55e" : "#ef4444";
        return <rect key={i} x={x} y={0} width={barW} height={height} fill={fill} rx={1} />;
      })}
    </svg>
  );
}
