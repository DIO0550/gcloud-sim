const enable = { type: "gcloud services enable monitoring.googleapis.com logging.googleapis.com" };
export const OBSERVABILITY_SCENARIOS = [
  {
    name: "observe-channel-unverified",
    label: "監視: 通知チャネルの有効/検証状態",
    steps: [
      { wait: 800 },
      enable,
      {
        type: "gcloud monitoring channels create --display-name=oncall --type=email --channel-labels=email_address=oncall@example.com",
      },
      { click: "channels: oncall" },
      { wait: 300 },
    ],
  },
  {
    name: "observe-slo-budget",
    label: "監視: SLIと消費済みエラーバジェット",
    steps: [
      { wait: 800 },
      enable,
      { type: "sim monitoring slos create availability --goal=0.99 --rolling-days=1" },
      { type: "sim monitoring slos record availability --good=98 --total=100" },
      { click: "objectives: availability" },
      { wait: 300 },
    ],
  },
  {
    name: "observe-analytics-bucket",
    label: "Logging: 保持とAnalyticsアップグレード",
    steps: [
      { wait: 800 },
      enable,
      {
        type: "gcloud logging buckets create archive --location=us-central1 --retention-days=7 --enable-analytics",
      },
      { click: "buckets: us-central1/archive" },
      { wait: 300 },
    ],
  },
];
