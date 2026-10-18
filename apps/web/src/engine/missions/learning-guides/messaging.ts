import { CommonSteps } from "./common";
import type { MissionGuide } from "./model";

export const MessagingGuides = {
  "m-data-003": {
    introduction:
      "トピック、購読、送信、受信、ACKの順で、1つのメッセージが処理済みになるまでを体験します。",
    steps: [
      CommonSteps.preparePubsub,
      {
        title: "送信先と受信窓口を作る",
        explanation: "送信前に購読を用意して、この購読がメッセージを受け取れるようにします。",
        actions: [
          {
            kind: "command",
            text: "gcloud pubsub topics create ack-events",
          },
          {
            kind: "command",
            text: "gcloud pubsub subscriptions create ack-events --topic=ack-events",
          },
        ],
        points: [
          {
            term: "同名でも別リソース",
            description:
              "トピックとサブスクリプションは同じ名前を使えますが、役割と保存される状態は異なります。",
          },
        ],
        expected: "ack-events購読がack-eventsトピックを参照します。",
      },
      {
        title: "JSONのメッセージを送信する",
        explanation: "送信者として、顧客名と金額を持つ1件のデータを送ります。",
        actions: [
          {
            kind: "command",
            text: 'gcloud pubsub topics publish ack-events --message=\'{"customer":"alice","amount":10}\'',
          },
        ],
        points: [
          {
            term: "--message",
            description: "配送する本文です。引用符で囲み、JSONを1つの引数として渡します。",
          },
        ],
        expected: "メッセージIDが表示され、購読側から取り出せる状態になります。",
      },
      {
        title: "受信時にACKして再度取り出す",
        explanation: "自動ACKで受信済みにし、同じ未確認メッセージが残っていないことを確かめます。",
        actions: [
          {
            kind: "command",
            text: "gcloud pubsub subscriptions pull ack-events --auto-ack",
          },
          {
            kind: "command",
            text: "gcloud pubsub subscriptions pull ack-events --auto-ack",
          },
        ],
        points: [
          {
            term: "--auto-ack",
            description:
              "取り出したメッセージをその場でACKします。手動ACKでは処理成功後にACK IDを使って応答します。",
          },
        ],
        expected: "最初のpullでaliceの本文が出て、2回目には配送待ちの同じメッセージがありません。",
      },
    ],
    takeaway:
      "ACKは受信者が処理完了を知らせる操作です。--auto-ackは取り出すと同時にACKするので、実アプリでは処理成功後にACKする設計と区別します。",
  },
} satisfies Readonly<Record<string, MissionGuide>>;
