import nextConfig from "eslint-config-next";

export default [
  ...nextConfig,
  {
    rules: {
      // React Compiler plugin rules are too strict for a non-compiler-transpiled codebase.
      // setState-in-effect and Date.now()-in-render are valid intentional patterns here.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
    },
  },
];
