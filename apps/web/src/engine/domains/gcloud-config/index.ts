import type { ValueOf } from "@/types/ValueOf";
import { Option } from "@/utils/Option";
import { Result } from "@/utils/Result";

/** `gcloud config set` で書けるプロパティ（セクション/名前）。 */
export const ConfigProperties = {
  Account: "core/account",
  Project: "core/project",
  Zone: "compute/zone",
  Region: "compute/region",
  RunRegion: "run/region",
  ContainerCluster: "container/cluster",
} as const;
export type ConfigProperty = ValueOf<typeof ConfigProperties>;

const AllProperties: readonly ConfigProperty[] = Object.values(ConfigProperties);

export const ConfigProperty = {
  /**
   * `project` / `core/project` / `compute/zone` の綴りを正規化する。
   * セクション無しは `core/` とみなす（本物と同じ）。
   *
   * @param value ユーザーが打った綴り
   * @returns 知っているプロパティならその名前。それ以外は `none`
   */
  parse(value: string): Option<ConfigProperty> {
    const normalized = value.includes("/") ? value : `core/${value}`;
    return Option.fromNullable(AllProperties.find((p) => p === normalized));
  },

  all(): readonly ConfigProperty[] {
    return AllProperties;
  },
} as const;

/** 1 つの configuration の中身。設定されていないプロパティはキーが無い。 */
export type ConfigValues = Readonly<Partial<Record<ConfigProperty, string>>>;

export type GcloudConfig = Readonly<{
  configurations: Readonly<Record<string, ConfigValues>>;
  activeConfiguration: string;
}>;

export const ConfigurationName = {
  parse(value: string): Result<string, string> {
    const valid = /^[a-z][a-z0-9-]*$/.test(value);
    return valid
      ? Result.ok(value)
      : Result.err(
          `Invalid name [${value}] for a configuration. Except for special cases (NONE), configuration names start with a lower case letter and contain only lower case letters a-z, digits 0-9, and hyphens '-'.`,
        );
  },
} as const;

export const GcloudConfig = {
  /**
   * `default` 1 つだけを持つ設定。
   *
   * @param values `default` の初期値
   * @returns `default` がアクティブな設定
   */
  create(values: ConfigValues): GcloudConfig {
    return { configurations: { default: values }, activeConfiguration: "default" };
  },

  /**
   * 名前を指定して configuration の中身を読む。
   *
   * @param config 設定
   * @param name configuration の名前
   * @returns あればその中身。無ければ `none`
   */
  valuesOf(config: GcloudConfig, name: string): Option<ConfigValues> {
    return GcloudConfig.hasConfiguration(config, name)
      ? Option.fromNullable(config.configurations[name])
      : Option.none;
  },

  /** アクティブな configuration の中身。無いことは `World.validate` が弾いている。 */
  active(config: GcloudConfig): ConfigValues {
    return Option.unwrapOr(GcloudConfig.valuesOf(config, config.activeConfiguration), {});
  },

  /**
   * アクティブな configuration のプロパティを読む。
   *
   * @param config 設定
   * @param property プロパティ
   * @returns 設定されていればその値。無ければ `none`
   */
  get(config: GcloudConfig, property: ConfigProperty): Option<string> {
    return Option.fromNullable(GcloudConfig.active(config)[property]);
  },

  set(config: GcloudConfig, property: ConfigProperty, value: string): GcloudConfig {
    const current = GcloudConfig.active(config);
    return {
      ...config,
      configurations: {
        ...config.configurations,
        [config.activeConfiguration]: { ...current, [property]: value },
      },
    };
  },

  unset(config: GcloudConfig, property: ConfigProperty): GcloudConfig {
    const { [property]: _removed, ...rest } = GcloudConfig.active(config);
    return {
      ...config,
      configurations: { ...config.configurations, [config.activeConfiguration]: rest },
    };
  },

  /** `in` だとプロトタイプの `toString` 等も「ある」になるので、自前のキーだけを見る。 */
  hasConfiguration(config: GcloudConfig, name: string): boolean {
    return Object.hasOwn(config.configurations, name);
  },

  /**
   * configuration を追加する。
   *
   * @param config 設定
   * @param name 新しい名前
   * @param activate 追加後にアクティブにするか
   * @returns 追加後の設定。同名があれば `none`
   */
  withConfiguration(config: GcloudConfig, name: string, activate: boolean): Option<GcloudConfig> {
    if (GcloudConfig.hasConfiguration(config, name)) return Option.none;
    return Option.some({
      configurations: { ...config.configurations, [name]: {} },
      activeConfiguration: activate ? name : config.activeConfiguration,
    });
  },

  /**
   * アクティブな configuration を切り替える。
   *
   * @param config 設定
   * @param name 切り替え先
   * @returns 切り替え後の設定。無い名前なら `none`
   */
  activate(config: GcloudConfig, name: string): Option<GcloudConfig> {
    return GcloudConfig.hasConfiguration(config, name)
      ? Option.some({ ...config, activeConfiguration: name })
      : Option.none;
  },

  /**
   * configuration を消す。アクティブなものは消せない（本物と同じ）。
   *
   * @param config 設定
   * @param name 消す名前
   * @returns 消した後の設定。無い名前・アクティブな名前なら `none`
   */
  withoutConfiguration(config: GcloudConfig, name: string): Option<GcloudConfig> {
    const removable =
      GcloudConfig.hasConfiguration(config, name) && name !== config.activeConfiguration;
    if (!removable) return Option.none;
    const { [name]: _removed, ...rest } = config.configurations;
    return Option.some({ ...config, configurations: rest });
  },

  names(config: GcloudConfig): readonly string[] {
    return Object.keys(config.configurations);
  },
} as const;
