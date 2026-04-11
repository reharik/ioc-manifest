/** Base type used in group `baseType` resolution tests. */
export interface WidgetBase {
  kind: string;
}

export interface WidgetA extends WidgetBase {
  kind: "a";
}

/** Contract type written as an optional union (common after migrating from `null`). */
export type NullableWidgetContract = WidgetA | undefined;

export type NullWidgetContract = WidgetA | null;
