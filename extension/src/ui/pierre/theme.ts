import * as React from "react";

function hostTheme(): "light" | "dark" {
  const color = getComputedStyle(document.body).backgroundColor;
  const values = color.match(/[\d.]+/g)?.map(Number);
  return values && values.length >= 3 && values[0] * .2126 + values[1] * .7152 + values[2] * .0722 < 128 ? "dark" : "light";
}

/** Azure DevOps SDK and the local shell both update the host's theme variables. */
export function usePierreTheme(): "light" | "dark" {
  const [theme, setTheme] = React.useState(hostTheme);
  React.useEffect(() => {
    const update = () => setTheme(hostTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    window.addEventListener("themeChanged", update);
    update();
    return () => { observer.disconnect(); window.removeEventListener("themeChanged", update); };
  }, []);
  return theme;
}
