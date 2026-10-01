import { useReducer } from "react";

import {
  type CreateFormOps,
  FieldErrors,
} from "@/features/simulator/features/console/domains/equivalent-command";
import { Option } from "@/utils/Option";

/** 作成フォームの状態。閉じているか、編集中（送信を試みたかどうか）か。 */
type FormState<F extends object> =
  | Readonly<{ kind: "closed" }>
  | Readonly<{ kind: "editing"; form: F; submitted: boolean }>;

type FormAction<F extends object> =
  | Readonly<{ type: "opened"; form: F }>
  | Readonly<{ type: "changed"; key: keyof F; value: F[keyof F] }>
  | Readonly<{ type: "submitted" }>
  | Readonly<{ type: "closed" }>;

const reduce = <F extends object>(state: FormState<F>, action: FormAction<F>): FormState<F> => {
  switch (action.type) {
    case "opened":
      return { kind: "editing", form: action.form, submitted: false };
    case "changed":
      return state.kind === "editing"
        ? { ...state, form: { ...state.form, [action.key]: action.value } }
        : state;
    case "submitted":
      return state.kind === "editing" ? { ...state, submitted: true } : state;
    case "closed":
      return { kind: "closed" };
  }
};

export type CreateForm<F extends object> = Readonly<{
  /** 編集中のフォーム。閉じていれば `none` */
  form: Option<F>;
  /** 送信を試みた後だけ出す項目のエラー */
  errors: FieldErrors<F>;
  open: () => void;
  close: () => void;
  set: <K extends keyof F>(key: K, value: F[K]) => void;
  /**
   * 送信を試みる。エラーが無ければその値を返し、あれば項目に出す。
   * 画面を閉じるかどうかは呼び出し側が決める（一覧へ戻る画面と、画面を移る画面がある）。
   */
  submit: () => Option<F>;
}>;

const initialState = <F extends object>(open: boolean, create: () => F): FormState<F> =>
  open ? { kind: "editing", form: create(), submitted: false } : { kind: "closed" };

/**
 * Console の作成フォーム 1 つ分の状態（UC-008）。開く・値を変える・送信を試みる・閉じる。
 *
 * @param ops フォームの検証
 * @param create 開いたときの初期値
 * @param startOpen 画面そのものがフォームなら真（閉じる操作は無い）
 */
export const useCreateForm = <F extends object>(
  ops: CreateFormOps<F>,
  create: () => F,
  startOpen = false,
): CreateForm<F> => {
  const [state, dispatch] = useReducer(reduce<F>, startOpen, (open) => initialState(open, create));
  const form: Option<F> = state.kind === "editing" ? Option.some(state.form) : Option.none;
  const errors =
    state.kind === "editing" && state.submitted
      ? ops.collectErrors(state.form)
      : FieldErrors.none<F>();
  return {
    form,
    errors,
    open: () => dispatch({ type: "opened", form: create() }),
    close: () => dispatch({ type: "closed" }),
    set: (key, value) => dispatch({ type: "changed", key, value }),
    submit: () => {
      dispatch({ type: "submitted" });
      return Option.filter(form, (f) => FieldErrors.isEmpty(ops.collectErrors(f)));
    },
  };
};
