# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.


## Точки по зададените правила

- Провален договор: **10 т.** при боя / „Всичко коз“.
- Провален договор „Без коз“: **20 т.**
- **Контра** удвоява санкцията: 20 т. / 40 т.
- **Реконтра** учетворява санкцията: 40 т. / 80 т.
- **Капо**: отборът, взел всичките 8 взятки, получава **-10 т.** вместо стандартния бонус +90.
- При успешен договор нормалното точкуване на взятките, белотът и анонсите се запазват.

> Забележка: текущият MVP е локална игра срещу ботове. Онлайн играта с приятели изисква отделен сървър/room система; тази промяна подготвя точкуването, но не добавя мрежова инфраструктура.
