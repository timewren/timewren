// Type-shim: web's pdf-svg.tsx (takumi-PDF) type-tjekkes med web's React-DOM-typer og
// fejler under appens React Native-typer. Appen bruger den aldrig — kun AppRouter-typen
// trækker den ind transitivt — så den erstattes her via `paths` i tsconfig.
type AnyComponent = (props: Record<string, unknown>) => null;

export const Svg: AnyComponent = () => null;
export const Rect: AnyComponent = () => null;
export const Circle: AnyComponent = () => null;
export const G: AnyComponent = () => null;
export const Line: AnyComponent = () => null;
export const Path: AnyComponent = () => null;
export const SvgText: AnyComponent = () => null;
