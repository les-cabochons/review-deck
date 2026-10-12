// Local dev only: approximations of the CSS variables the Azure DevOps host injects into extension
// iframes (SDK.init({ applyTheme: true })), so light and dark can be checked without installing.

const LIGHT: Record<string, string> = {
  "--background-color": "rgba(255, 255, 255, 1)",
  "--text-primary-color": "rgba(0, 0, 0, .9)",
  "--text-secondary-color": "rgba(0, 0, 0, .55)",
  "--text-disabled-color": "rgba(0, 0, 0, .38)",
  "--communication-background": "rgba(0, 120, 212, 1)",
  "--communication-foreground": "rgba(0, 90, 158, 1)",
  "--focus-border-color": "rgba(0, 120, 212, 1)",
  "--callout-background-color": "rgba(255, 255, 255, 1)",
  "--palette-neutral-2": "248, 248, 248",
  "--palette-neutral-4": "244, 244, 244",
  "--palette-neutral-6": "239, 239, 239",
  "--palette-neutral-8": "234, 234, 234",
  "--palette-neutral-10": "218, 218, 218",
  "--palette-neutral-20": "200, 200, 200",
  "--palette-neutral-30": "166, 166, 166",
  "--palette-neutral-60": "102, 102, 102",
  "--palette-neutral-100": "0, 0, 0",
  "--palette-black-alpha-4": "rgba(0, 0, 0, 0.04)",
  "--palette-black-alpha-6": "rgba(0, 0, 0, 0.06)",
  "--palette-black-alpha-8": "rgba(0, 0, 0, 0.08)",
  "--palette-black-alpha-10": "rgba(0, 0, 0, 0.10)",
  "--palette-black-alpha-20": "rgba(0, 0, 0, 0.20)",
  "--palette-black-alpha-30": "rgba(0, 0, 0, 0.30)",
  "--status-success-foreground": "rgba(16, 124, 16, 1)",
  "--status-error-foreground": "rgba(205, 74, 69, 1)",
  "--status-warning-foreground": "rgba(214, 127, 60, 1)",
};

const DARK: Record<string, string> = {
  "--background-color": "rgba(32, 31, 30, 1)",
  "--text-primary-color": "rgba(255, 255, 255, .87)",
  "--text-secondary-color": "rgba(255, 255, 255, .55)",
  "--text-disabled-color": "rgba(255, 255, 255, .38)",
  "--communication-background": "rgba(0, 120, 212, 1)",
  "--communication-foreground": "rgba(71, 158, 245, 1)",
  "--focus-border-color": "rgba(71, 158, 245, 1)",
  "--callout-background-color": "rgba(37, 36, 35, 1)",
  "--palette-neutral-2": "40, 39, 38",
  "--palette-neutral-4": "44, 43, 42",
  "--palette-neutral-6": "48, 47, 46",
  "--palette-neutral-8": "53, 52, 51",
  "--palette-neutral-10": "60, 59, 58",
  "--palette-neutral-20": "80, 79, 78",
  "--palette-neutral-30": "110, 109, 108",
  "--palette-neutral-60": "170, 170, 170",
  "--palette-neutral-100": "255, 255, 255",
  "--palette-black-alpha-4": "rgba(255, 255, 255, 0.04)",
  "--palette-black-alpha-6": "rgba(255, 255, 255, 0.06)",
  "--palette-black-alpha-8": "rgba(255, 255, 255, 0.08)",
  "--palette-black-alpha-10": "rgba(255, 255, 255, 0.10)",
  "--palette-black-alpha-20": "rgba(255, 255, 255, 0.20)",
  "--palette-black-alpha-30": "rgba(255, 255, 255, 0.30)",
  "--status-success-foreground": "rgba(84, 176, 84, 1)",
  "--status-error-foreground": "rgba(241, 112, 123, 1)",
  "--status-warning-foreground": "rgba(244, 174, 98, 1)",
};

export function applyLocalTheme(name: string | null | undefined): void {
  const vars = name === "dark" ? DARK : LIGHT;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = name === "dark" ? "dark" : "light";
}
