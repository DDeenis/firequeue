import { type Serializer } from "./types.js";

export const removeTrailingSlash = (str: string) => str.replace(/\/+$/, "");

const VAL_UNDEFINED = () => "@__FIREQUEUE_VAL_UNDEFINED__" as const;
const VAL_NULL = () => "@__FIREQUEUE_VAL_NULL__" as const;
const VAL_NAN = () => "@__FIREQUEUE_VAL_NAN__" as const;

export const defaultSerializer: Serializer = {
  stringify: (data: unknown): string => {
    if (data === undefined) {
      return VAL_UNDEFINED();
    } else if (data === null) {
      return VAL_NULL();
    } else if (Number.isNaN(data)) {
      return VAL_NAN();
    }

    return JSON.stringify(data);
  },

  parse: (str: string): unknown => {
    if (str === VAL_UNDEFINED()) {
      return undefined;
    } else if (str === VAL_NULL()) {
      return null;
    } else if (str === VAL_NAN()) {
      return NaN;
    }

    return JSON.parse(str);
  },
};
