import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    languageOptions: { globals: globals.browser },
    rules: {
      "max-len": ["error", { code: 100 }],
      "max-lines": ["error", { max: 500 }],
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
];
