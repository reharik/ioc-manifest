import type DefaultWidget from "@test/lib-foo/default";

type DefaultDeps = {
  widget: DefaultWidget;
};

export type DefaultService = { readonly ok: boolean };

export const buildDefaultService = ({
  widget: _widget,
}: DefaultDeps): DefaultService => ({ ok: true });
