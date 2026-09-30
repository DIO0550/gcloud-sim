/**
 * オブジェクトが取りうる値の union。
 * 値の集合を定数のオブジェクトで持ち、そこから型を導出するために使う（集合と union を二重管理しない）。
 */
export type ValueOf<T> = T[keyof T];
